// Outliner-style list editing for the source and block editors, the way
// Notion and Logseq handle it:
//
// - Enter on a list item starts the next item of the same kind (bullet,
//   number + 1, or an unticked task). Enter on an empty item outdents it, or
//   ends the list at the top level so the next line is ordinary text.
// - Shift+Enter adds a line inside the item (an indented continuation).
// - Tab nests the item, with its children, under the item above it; Shift+Tab
//   moves it back out. Nesting is plain Markdown indentation.
// - Backspace right after a marker turns a task into a bullet, and a bullet
//   into plain text.
//
// The edits are pure functions over (text, selection) so they can be tested
// without a DOM; `attachListEditing` wires them to a textarea.

export type Edit = {
  /** Range of the original text to replace. */
  from: number;
  to: number;
  text: string;
  /** Selection in the resulting text. */
  selStart: number;
  selEnd: number;
};

/** Handled, but nothing to change (e.g. Tab on an item that can't nest). */
export const NOOP = 'noop' as const;
type Result = Edit | typeof NOOP | null;

type ListLine = {
  indent: number;
  marker: string; // `-`, `*`, `+`, `1.`, `2)`
  ordered: boolean;
  number: number;
  task: string | null; // `[ ]` / `[x]`
  /** Column where the item's text starts. */
  contentStart: number;
  /** Column where the marker's text starts, without the task box. */
  markerEnd: number;
};

const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(\[[ xX]\](?:[ \t]+|$))?/;
const FENCE = /^\s*(`{3,}|~{3,})/;

export function parseListLine(line: string): ListLine | null {
  const m = line.match(ITEM);
  if (!m) return null;
  // `---`, `***` and `- - -` are rules, not items.
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return null;
  const indent = m[1].replace(/\t/g, '  ').length;
  const ordered = /\d/.test(m[2]);
  const markerEnd = m[1].length + m[2].length + m[3].length;
  return {
    indent,
    marker: m[2],
    ordered,
    number: ordered ? parseInt(m[2], 10) : 0,
    task: m[4] ? m[4].trim() : null,
    contentStart: m[0].length,
    markerEnd,
  };
}

const lineStartAt = (text: string, i: number) => text.lastIndexOf('\n', i - 1) + 1;
const lineEndAt = (text: string, i: number) => {
  const end = text.indexOf('\n', i);
  return end < 0 ? text.length : end;
};

const indentOf = (line: string) => (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '  ').length;
const isBlank = (line: string) => line.trim() === '';

/** True when `index` sits inside a fenced code block. */
function inFence(text: string, index: number) {
  let open = false;
  for (const line of text.slice(0, lineStartAt(text, index)).split('\n')) if (FENCE.test(line)) open = !open;
  return open;
}

/** Line range [first, last] of the list around line `at`: items and their continuation lines. */
function listBounds(lines: string[], at: number): [number, number] {
  const inList = (i: number) => !isBlank(lines[i]) && (parseListLine(lines[i]) !== null || indentOf(lines[i]) > 0);
  let first = at;
  while (first > 0 && inList(first - 1)) first--;
  let last = at;
  while (last < lines.length - 1 && inList(last + 1)) last++;
  return [first, last];
}

/**
 * Number every ordered sequence in lines[first..last] consecutively, so items
 * stay in order after one is added, moved or removed.
 */
function renumber(lines: string[], first: number, last: number) {
  // Per indent: the next number of the ordered sequence open at that depth.
  let open: { indent: number; next: number | null }[] = [];
  for (let i = first; i <= last; i++) {
    const item = parseListLine(lines[i]);
    if (!item) continue;
    open = open.filter((level) => level.indent <= item.indent);
    let level = open.find((entry) => entry.indent === item.indent);
    if (!level) {
      level = { indent: item.indent, next: null };
      open.push(level);
    }
    if (!item.ordered) { level.next = null; continue; }
    // A top-level list keeps the number it starts at; a nested one counts from 1.
    if (level.next === null && open.length === 1) { level.next = item.number + 1; continue; }
    level.next ??= 1;
    const at = lines[i].indexOf(item.marker);
    lines[i] = lines[i].slice(0, at) + `${level.next}${item.marker.slice(-1)}` + lines[i].slice(at + item.marker.length);
    level.next++;
  }
}

/**
 * Replace lines[first..last] of `text` with `next`, renumbering ordered lists,
 * and put the caret on line `caretLine` at `caretFromEnd` characters before the
 * line's end (marker renumbering only changes the start of a line).
 */
function replaceLines(text: string, lines: string[], first: number, last: number, next: string[], caretLine: number, caretFromEnd: number, selection?: { line: number; fromEnd: number }): Edit {
  const all = [...lines.slice(0, first), ...next, ...lines.slice(last + 1)];
  const [lo, hi] = listBounds(all, Math.min(caretLine, all.length - 1));
  const from0 = Math.min(first, lo);
  const to0 = Math.max(first + next.length - 1, hi);
  renumber(all, from0, to0);
  const offset = (line: number, fromEnd: number) => {
    let at = 0;
    for (let i = 0; i < line; i++) at += all[i].length + 1;
    return at + Math.max(0, all[line].length - fromEnd);
  };
  // Replace the smallest span that covers both the old and the new lines.
  const oldStart = lines.slice(0, from0).reduce((sum, line) => sum + line.length + 1, 0);
  // The old line that maps to new line `to0`.
  const oldLast = to0 >= first + next.length ? to0 - next.length + (last - first + 1) : last;
  const oldEnd = lines.slice(0, oldLast + 1).reduce((sum, line) => sum + line.length + 1, 0) - 1;
  const replacement = all.slice(from0, to0 + 1).join('\n');
  const caret = offset(caretLine, caretFromEnd);
  const anchor = selection ? offset(selection.line, selection.fromEnd) : caret;
  return {
    from: oldStart,
    to: Math.min(oldEnd, text.length),
    text: replacement,
    selStart: Math.min(caret, anchor),
    selEnd: Math.max(caret, anchor),
  };
}

function lineIndexAt(text: string, index: number) {
  let count = 0;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}

/** Last line of the subtree under lines[at]: following lines indented deeper. */
function subtreeEnd(lines: string[], at: number) {
  const base = indentOf(lines[at]);
  let end = at;
  for (let i = at + 1; i < lines.length; i++) {
    if (isBlank(lines[i])) break;
    if (indentOf(lines[i]) <= base) break;
    end = i;
  }
  return end;
}

function shiftLine(line: string, delta: number) {
  const current = line.match(/^[ \t]*/)![0];
  const width = indentOf(line);
  return ' '.repeat(Math.max(0, width + delta)) + line.slice(current.length);
}

/** Enter: continue the list, or step out of it on an empty item. */
export function enterInList(text: string, start: number, end: number): Result {
  if (start !== end || inFence(text, start)) return null;
  const ls = lineStartAt(text, start);
  const le = lineEndAt(text, start);
  const line = text.slice(ls, le);
  const item = parseListLine(line);
  if (!item || start - ls < item.markerEnd) return null;
  const lines = text.split('\n');
  const at = lineIndexAt(text, start);

  if (line.slice(item.contentStart).trim() === '') {
    // An empty nested item steps out a level, like Shift+Tab.
    if (item.indent > 0) return outdent(text, start, end);
    // An empty top-level item ends the list: the line becomes ordinary text,
    // with the blank line Markdown needs between a list and a paragraph.
    const separate = at > 0 && !isBlank(lines[at - 1]);
    const next = separate ? ['', ''] : [''];
    if (lines[at + 1] !== undefined && !isBlank(lines[at + 1])) next.push('');
    return replaceLines(text, lines, at, at, next, at + (separate ? 1 : 0), 0);
  }

  // Splitting: text after the caret moves into the new item.
  const before = text.slice(ls, start).replace(/[ \t]+$/, '');
  const moved = text.slice(start, le).replace(/^[ \t]+/, '');
  let indent = ' '.repeat(item.indent);
  let marker = item.ordered ? `${item.number + 1}${item.marker.slice(-1)}` : item.marker;
  let task = item.task ? '[ ] ' : '';
  // At the end of an item with children, the new item becomes the first child (Logseq).
  const child = !moved && lines[at + 1] !== undefined ? parseListLine(lines[at + 1]) : null;
  if (child && child.indent > item.indent) {
    indent = ' '.repeat(child.indent);
    marker = child.ordered ? `${child.number}${child.marker.slice(-1)}` : child.marker;
    task = child.task ? '[ ] ' : '';
  }
  const newLine = `${indent}${marker} ${task}${moved}`;
  return replaceLines(text, lines, at, at, [before, newLine], at + 1, moved.length);
}

/** Shift+Enter in a list item: a new line inside the item, aligned with its text. */
export function softBreakInList(text: string, start: number, end: number): Result {
  if (inFence(text, start)) return null;
  const ls = lineStartAt(text, start);
  const item = parseListLine(text.slice(ls, lineEndAt(text, start)));
  if (!item || start - ls < item.markerEnd) return null;
  const lead = text.slice(ls).match(/^[ \t]*/)![0].length;
  const insert = '\n' + ' '.repeat(item.indent + item.markerEnd - lead);
  return { from: start, to: end, text: insert, selStart: start + insert.length, selEnd: start + insert.length };
}

/** Selected line range, ignoring a final line the selection only touches at its start. */
function selectedLines(text: string, start: number, end: number): [number, number] {
  const first = lineIndexAt(text, start);
  let last = lineIndexAt(text, end);
  if (end > start && text[end - 1] === '\n') last--;
  return [first, Math.max(first, last)];
}

/** The selection as (line, characters before the line's end), which survives re-indenting. */
function caretMemo(text: string, start: number, end: number) {
  return {
    caretLine: lineIndexAt(text, end),
    caretFromEnd: lineEndAt(text, end) - end,
    anchor: { line: lineIndexAt(text, start), fromEnd: lineEndAt(text, start) - start },
  };
}

/** Tab: nest the selected lines (and their children) under the line above. */
export function indent(text: string, start: number, end: number): Result {
  if (inFence(text, start)) return null;
  const lines = text.split('\n');
  const [first, lastSelected] = selectedLines(text, start, end);
  const item = parseListLine(lines[first]);
  const depth = item ? item.indent : indentOf(lines[first]);
  // The line above at the same depth becomes the parent: an item nests under
  // its text, plain text (a [[link]], say) two spaces in. Without one there is
  // nothing to nest under.
  let delta = 0;
  for (let i = first - 1; i >= 0 && !isBlank(lines[i]); i--) {
    const above = indentOf(lines[i]);
    if (above < depth) break;
    if (above > depth) continue;
    const sibling = parseListLine(lines[i]);
    delta = sibling ? sibling.markerEnd - sibling.indent : 2;
    break;
  }
  if (!delta) return NOOP;
  return shiftLines(text, start, end, lines, first, lastSelected, delta);
}

/** Shift+Tab: move the selected lines (and their children) out one level. */
export function outdent(text: string, start: number, end: number): Result {
  if (inFence(text, start)) return null;
  const lines = text.split('\n');
  const [first, lastSelected] = selectedLines(text, start, end);
  const item = parseListLine(lines[first]);
  const depth = item ? item.indent : indentOf(lines[first]);
  if (depth === 0) return NOOP;
  // Step back to the parent's depth: the item above it, or for plain text any
  // line above it.
  let parentIndent = 0;
  for (let i = first - 1; i >= 0 && !isBlank(lines[i]); i--) {
    const above = indentOf(lines[i]);
    if (above < depth && (!item || parseListLine(lines[i]))) { parentIndent = above; break; }
  }
  return shiftLines(text, start, end, lines, first, lastSelected, parentIndent - depth);
}

/**
 * Shift lines[first..lastSelected] and the subtree under them by `delta`
 * columns. Blank lines stay as they are, except an empty line being indented
 * on its own, which gets the indentation to type into.
 */
function shiftLines(text: string, start: number, end: number, lines: string[], first: number, lastSelected: number, delta: number): Edit {
  const lone = first === lastSelected && isBlank(lines[first]);
  const last = lone ? first : Math.max(lastSelected, subtreeEnd(lines, lastSelected));
  const next = lines.slice(first, last + 1).map((line) => (isBlank(line) && !lone ? line : shiftLine(line, delta)));
  const memo = caretMemo(text, start, end);
  return replaceLines(text, lines, first, last, next, memo.caretLine, memo.caretFromEnd, memo.anchor);
}

/** Backspace right after a marker: task → bullet, bullet → plain text. */
export function backspaceInList(text: string, start: number, end: number): Result {
  if (start !== end || inFence(text, start)) return null;
  const ls = lineStartAt(text, start);
  const line = text.slice(ls, lineEndAt(text, start));
  const item = parseListLine(line);
  if (!item || start - ls !== item.contentStart) return null;
  const lead = line.match(/^[ \t]*/)![0].length;
  const keep = item.task ? line.slice(0, item.markerEnd) : line.slice(0, lead);
  const lines = text.split('\n');
  const at = lineIndexAt(text, start);
  const rest = line.slice(item.contentStart);
  return replaceLines(text, lines, at, at, [keep + rest], at, rest.length);
}

/**
 * Apply an edit through the browser's editing commands, so ⌘Z undoes it in one
 * step and the textarea fires its usual `input` event.
 */
export function applyEdit(textarea: HTMLTextAreaElement, edit: Edit) {
  textarea.focus();
  textarea.setSelectionRange(edit.from, edit.to);
  const ok = edit.text ? document.execCommand('insertText', false, edit.text) : edit.from === edit.to || document.execCommand('delete');
  if (!ok || textarea.value.slice(edit.from, edit.from + edit.text.length) !== edit.text) {
    textarea.setRangeText(edit.text, edit.from, edit.to);
    textarea.dispatchEvent(new Event('input'));
  }
  textarea.setSelectionRange(edit.selStart, edit.selEnd);
}

export function attachListEditing(textarea: HTMLTextAreaElement) {
  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const { value, selectionStart: start, selectionEnd: end } = textarea;
    let result: Result = null;
    if (event.key === 'Enter') result = event.shiftKey ? softBreakInList(value, start, end) : enterInList(value, start, end);
    else if (event.key === 'Tab') result = event.shiftKey ? outdent(value, start, end) : indent(value, start, end);
    else if (event.key === 'Backspace' && !event.shiftKey) result = backspaceInList(value, start, end);
    if (!result) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (result !== NOOP) applyEdit(textarea, result);
  });
}
