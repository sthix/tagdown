// Block references: a paragraph, list item, task or heading that ends in
// ` ^ab12cd` can be linked as `[[Note#^ab12cd]]` and embedded as
// `![[Note#^ab12cd]]` (the format Obsidian uses). The marker is plain text on
// the block's line, so it moves and survives edits with the block. Ids are only
// written when someone copies a reference to a block; notes are never rewritten
// in bulk. The vault finds blocks by id in `links.rs`.
//
// Blocks that can't end in a marker (tables, callouts, code, components) get
// it on a line of their own after them, also as in Obsidian.

import { splitBlocks } from './tagdown/blocks';

const MARKER = /(^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^#{1,6}\s/;
const FENCE = /^\s*(```|~~~)/;
// Lines that aren't paragraph text: tables, callouts, tags, math, rules.
const NOT_TEXT = /^\s*(?:\||:::|<|\$\$|---)/;
const STANDALONE = /^\s*\^[A-Za-z0-9-]+\s*$/;
const TABLE_ROW = /^\s*\|/;

/** The id a line's `^id` marker gives it, or null. */
export function blockIdOf(line: string): string | null {
  return line.match(MARKER)?.[2] ?? null;
}

/** Every block id in `source`. */
export function blockIds(source: string): Set<string> {
  const ids = new Set<string>();
  for (const line of source.split('\n')) {
    const id = blockIdOf(line);
    if (id) ids.add(id.toLowerCase());
  }
  return ids;
}

/** The block id of a link target like `Note#^ab12cd`, or null. */
export function blockIdOfTarget(target: string): string | null {
  return target.match(/#\^([A-Za-z0-9-]+)\s*$/)?.[1] ?? null;
}

/** A fresh six-character id that isn't in `taken`. */
export function newBlockId(taken: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    let id = '';
    for (let i = 0; i < 6; i++) id += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)];
    // Starting with a letter keeps it from reading as a number.
    if (/^[a-z]/.test(id) && !taken.has(id)) return id;
  }
}

/**
 * The line that holds the marker for the block at `line` in `lines`: a list
 * item, task or heading is its own line; a paragraph is marked on its last
 * line. Null for blank lines and blocks that can't carry a marker (code, tables,
 * callouts, components).
 */
export function markerLine(lines: string[], line: number): number | null {
  let inFence = false;
  for (let i = 0; i <= line && i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = i < line ? !inFence : true;
  }
  const text = lines[line];
  if (inFence || text === undefined || !text.trim() || NOT_TEXT.test(text)) return null;
  if (LIST_ITEM.test(text) || HEADING.test(text) || /^\s/.test(text)) return line;
  let last = line;
  while (last + 1 < lines.length) {
    const next = lines[last + 1];
    if (!next.trim() || LIST_ITEM.test(next) || HEADING.test(next) || FENCE.test(next) || NOT_TEXT.test(next) || /^\s/.test(next)) break;
    last++;
  }
  return last;
}

/**
 * Make sure the block under the caret in `text` has an id. Returns the text
 * (with ` ^id` appended to the block's marker line when it had none, or a
 * `^id` line added below a table, callout or code block), the id, and whether
 * anything changed; null when the caret is on a blank line or in the
 * frontmatter. `taken` holds the ids already used in the note.
 */
export function ensureBlockId(text: string, caret: number, taken: Set<string>, random?: () => number): { text: string; id: string; changed: boolean } | null {
  const lines = text.split('\n');
  const line = text.slice(0, caret).split('\n').length - 1;
  // The frontmatter is the note's metadata, not a block.
  const frontmatterEnd = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  if (line <= frontmatterEnd) return null;
  const at = markerLine(lines, line);
  if (at === null) return ensureStandaloneId(text, lines, line, taken, random);
  const existing = blockIdOf(lines[at]);
  if (existing) return { text, id: existing, changed: false };
  const id = newBlockId(taken, random);
  lines[at] = `${lines[at].replace(/[ \t]+$/, '')} ^${id}`;
  return { text: lines.join('\n'), id, changed: true };
}

function ensureStandaloneId(text: string, lines: string[], line: number, taken: Set<string>, random?: () => number) {
  if (!lines[line]?.trim()) return null;
  const block = splitBlocks(text).find((b) => line >= b.start && line < b.end);
  if (!block) return null;
  // A pipe table ends at its last row, even with text right below it.
  let end = block.end;
  if (TABLE_ROW.test(lines[line])) {
    end = line;
    while (end < lines.length && TABLE_ROW.test(lines[end])) end++;
  }
  const marker = [end - 1, end, lines[end]?.trim() ? -1 : end + 1].find((i) => i >= 0 && STANDALONE.test(lines[i] ?? ''));
  if (marker !== undefined) return { text, id: blockIdOf(lines[marker])!, changed: false };
  const id = newBlockId(taken, random);
  const next = lines[end];
  lines.splice(end, 0, '', `^${id}`, ...(next?.trim() ? [''] : []));
  return { text: lines.join('\n'), id, changed: true };
}

/** `[[Title#^id]]`, or the `![[…]]` embed of it. */
export function blockReference(title: string, id: string, embed = false): string {
  return `${embed ? '!' : ''}[[${title.trim()}#^${id}]]`;
}
