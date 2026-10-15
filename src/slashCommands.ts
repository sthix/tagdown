// The `/` command menu, after Notion and Logseq: type `/` at the start of a line
// or after a space, keep typing to filter, then ↑ ↓ and ↩ (or Tab) to apply.
//
// Commands come in three kinds:
// - `line` turns the current line into a heading, list item or task (Notion's
//   "turn into"), keeping its text;
// - `block` inserts a component on its own lines: in place of an empty line,
//   or below the current one;
// - `inline` inserts text at the caret (links, dates, inline formatting).
//
// In templates, `{{text}}` marks what gets selected after inserting, so typing
// replaces it; `{{}}` marks where the caret goes.
//
// A `pick` command only removes the `/query` and asks the editor to do the
// rest (choose image files, say) with a `tagdown:pick` event.

import { applyEdit, type Edit } from './listEditing';
import { caretPosition } from './wikilinks';
import { shiftDay, todayKey } from './journal';

export type SlashGroup = 'Basic blocks' | 'Callouts' | 'Layout' | 'Media' | 'Code & math' | 'Links & dates' | 'Inline';

export type SlashCommand = {
  id: string;
  label: string;
  description: string;
  group: SlashGroup;
  icon: string;
  /** Extra words the filter matches, e.g. `h1`, `todo`. */
  keywords?: string[];
  /** The Markdown you could type instead, shown on the right. */
  shortcut?: string;
} & ({ line: string } | { block: string } | { inline: string | (() => string) } | { pick: 'image' | 'block-link' | 'block-embed' });

const day = (offset: number) => () => `[[${shiftDay(todayKey(), offset)}]]`;

// Listed in menu order, grouped.
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'text', label: 'Text', description: 'Plain paragraph text', group: 'Basic blocks', icon: 'T', keywords: ['paragraph', 'plain', 'normal'], line: '' },
  { id: 'h1', label: 'Heading 1', description: 'Big section heading', group: 'Basic blocks', icon: 'H1', keywords: ['h1', 'title'], shortcut: '#', line: '# ' },
  { id: 'h2', label: 'Heading 2', description: 'Medium section heading', group: 'Basic blocks', icon: 'H2', keywords: ['h2', 'subtitle'], shortcut: '##', line: '## ' },
  { id: 'h3', label: 'Heading 3', description: 'Small section heading', group: 'Basic blocks', icon: 'H3', keywords: ['h3'], shortcut: '###', line: '### ' },
  { id: 'bullet', label: 'Bullet list', description: 'A simple bulleted list', group: 'Basic blocks', icon: '•', keywords: ['ul', 'unordered', 'list', 'outline'], shortcut: '-', line: '- ' },
  { id: 'numbered', label: 'Numbered list', description: 'A list with numbering', group: 'Basic blocks', icon: '1.', keywords: ['ol', 'ordered', 'list'], shortcut: '1.', line: '1. ' },
  { id: 'todo', label: 'To-do list', description: 'Track tasks with a checkbox', group: 'Basic blocks', icon: '☐', keywords: ['task', 'todo', 'checkbox', 'check', 'checklist'], shortcut: '[]', line: '- [ ] ' },
  { id: 'toggle', label: 'Toggle', description: 'Collapsible section', group: 'Basic blocks', icon: '▸', keywords: ['details', 'collapse', 'disclosure', 'fold'], block: '<details "{{Summary}}">\nHidden content\n</details>' },
  { id: 'quote', label: 'Quote', description: 'Quotation with a citation', group: 'Basic blocks', icon: '❝', keywords: ['blockquote', 'citation', 'cite'], block: '<quote "Author">\n{{Quotation}}\n</quote>' },
  { id: 'divider', label: 'Divider', description: 'Separate sections with a line', group: 'Basic blocks', icon: '—', keywords: ['hr', 'rule', 'line', 'separator'], shortcut: '---', block: '---\n{{}}' },
  { id: 'table', label: 'Table', description: 'Rows and columns', group: 'Basic blocks', icon: '⊞', keywords: ['grid', 'pipe', 'spreadsheet'], block: '| {{Header}} | Header |\n| ------ | ------ |\n| Cell | Cell |' },

  { id: 'info', label: 'Info callout', description: 'Note box for context', group: 'Callouts', icon: 'i', keywords: ['callout', 'note', 'admonition'], shortcut: ':::', block: '::: info\n{{Your message}}\n:::' },
  { id: 'tip', label: 'Tip callout', description: 'Helpful hint', group: 'Callouts', icon: '✦', keywords: ['callout', 'hint', 'important'], block: '::: tip\n{{Your tip}}\n:::' },
  { id: 'warn', label: 'Warning callout', description: 'Something to watch out for', group: 'Callouts', icon: '!', keywords: ['callout', 'warning', 'caution'], block: '::: warn\n{{Heads up}}\n:::' },
  { id: 'error', label: 'Error callout', description: 'Danger or a hard stop', group: 'Callouts', icon: '×', keywords: ['callout', 'danger', 'stop'], block: '::: error\n{{What went wrong}}\n:::' },
  { id: 'ok', label: 'Success callout', description: 'Done, approved, all good', group: 'Callouts', icon: '✓', keywords: ['callout', 'ok', 'done', 'check'], block: '::: ok\n{{All good}}\n:::' },

  { id: 'columns', label: 'Columns', description: 'Side-by-side columns', group: 'Layout', icon: '▥', keywords: ['grid', 'layout', 'split', 'two'], block: '<grid 2>\n{{Left column}}\n|||\nRight column\n</grid>' },
  { id: 'tabs', label: 'Tabs', description: 'Switchable tab panels', group: 'Layout', icon: '⧉', keywords: ['tab', 'panels'], block: '<tabs>\n<tab "First">\n{{First panel}}\n</tab>\n<tab "Second">\nSecond panel\n</tab>\n</tabs>' },
  { id: 'aside', label: 'Aside', description: 'Sidenote in the margin', group: 'Layout', icon: '◧', keywords: ['sidenote', 'margin', 'pullquote'], block: '<aside right>\n{{Sidenote}}\n</aside>' },
  { id: 'center', label: 'Center', description: 'Center-aligned block', group: 'Layout', icon: '≡', keywords: ['align', 'middle'], block: '<center>\n{{Centered text}}\n</center>' },
  { id: 'toc', label: 'Table of contents', description: 'List of this note’s headings', group: 'Layout', icon: '☰', keywords: ['toc', 'contents', 'outline'], block: '<toc />\n{{}}' },

  { id: 'image', label: 'Image', description: 'Add a photo or image from your Mac', group: 'Media', icon: '▣', keywords: ['figure', 'picture', 'photo', 'img', 'upload', 'file'], pick: 'image' },
  { id: 'figure', label: 'Figure', description: 'Image by path or URL, with a caption', group: 'Media', icon: '▢', keywords: ['image', 'picture', 'caption', 'img', 'url'], block: '<figure src={{image.png}} caption="Caption" />' },
  { id: 'video', label: 'Video embed', description: 'YouTube or Vimeo link', group: 'Media', icon: '▶', keywords: ['embed', 'youtube', 'vimeo', 'url'], block: '<embed url={{https://youtu.be/...}} />' },

  { id: 'code', label: 'Code block', description: 'Code with syntax highlighting', group: 'Code & math', icon: '{}', keywords: ['snippet', 'pre', 'src', 'fence'], shortcut: '```', block: '```js\n{{}}\n```' },
  { id: 'math', label: 'Math block', description: 'KaTeX formula on its own line', group: 'Code & math', icon: '∑', keywords: ['katex', 'latex', 'equation', 'formula', 'tex'], shortcut: '$$', block: '$$\n{{E = mc^2}}\n$$' },
  { id: 'mermaid', label: 'Diagram', description: 'Mermaid flowchart or sequence', group: 'Code & math', icon: '⇄', keywords: ['mermaid', 'flowchart', 'chart', 'graph'], block: '```mermaid\ngraph LR\n  {{A}} --> B --> C\n```' },
  { id: 'query', label: 'Query', description: 'Live list of matching notes or tasks', group: 'Code & math', icon: '?', keywords: ['search', 'filter', 'tasks', 'live'], block: '<query {{tag:project}} show:tasks />' },
  { id: 'defs', label: 'Definition list', description: 'Term :: definition pairs', group: 'Code & math', icon: '::', keywords: ['glossary', 'terms', 'key value'], block: '{{Term}} :: Definition' },

  { id: 'link', label: 'Link to note', description: 'Wikilink to another note', group: 'Links & dates', icon: '[[', keywords: ['wikilink', 'page', 'reference', 'ref'], shortcut: '[[', inline: '[[{{}}]]' },
  { id: 'block-link', label: 'Copy link to block', description: 'Copy a [[link]] to this block for another note', group: 'Links & dates', icon: '¶', keywords: ['block', 'reference', 'anchor', 'copy'], pick: 'block-link' },
  { id: 'block-embed', label: 'Copy block embed', description: 'Copy an embed that shows this block elsewhere', group: 'Links & dates', icon: '❐', keywords: ['block', 'reference', 'transclude', 'quote', 'copy'], pick: 'block-embed' },
  { id: 'today', label: 'Today', description: `Link to today’s journal page`, group: 'Links & dates', icon: '☀', keywords: ['date', 'journal', 'now'], inline: day(0) },
  { id: 'tomorrow', label: 'Tomorrow', description: 'Link to tomorrow’s journal page', group: 'Links & dates', icon: '→', keywords: ['date', 'journal', 'next'], inline: day(1) },
  { id: 'yesterday', label: 'Yesterday', description: 'Link to yesterday’s journal page', group: 'Links & dates', icon: '←', keywords: ['date', 'journal', 'previous'], inline: day(-1) },
  { id: 'time', label: 'Current time', description: 'Insert the time, like 14:05', group: 'Links & dates', icon: '◷', keywords: ['now', 'clock', 'timestamp'], inline: () => new Date().toTimeString().slice(0, 5) },
  { id: 'tag', label: 'Tag', description: 'Tag this note', group: 'Links & dates', icon: '#', keywords: ['label', 'hashtag'], shortcut: '#', inline: '#{{tag}}' },

  { id: 'highlight', label: 'Highlight', description: 'Marked text', group: 'Inline', icon: '✎', keywords: ['mark', 'marker', 'color'], shortcut: '==', inline: '=={{highlighted}}==' },
  { id: 'strike', label: 'Strikethrough', description: 'Crossed-out text', group: 'Inline', icon: 'S', keywords: ['strike', 'delete', 'cross'], shortcut: '~~', inline: '~~{{text}}~~' },
  { id: 'inline-math', label: 'Inline math', description: 'Formula inside a sentence', group: 'Inline', icon: 'x²', keywords: ['katex', 'latex', 'equation'], shortcut: '$', inline: '${{x^2}}$' },
  { id: 'keys', label: 'Keyboard keys', description: 'Shortcut like ⌘K', group: 'Inline', icon: '⌘', keywords: ['kbd', 'shortcut', 'keys'], inline: '<keys>{{Cmd+K}}</keys>' },
  { id: 'footnote', label: 'Footnote', description: 'Reference to a footnote', group: 'Inline', icon: '¹', keywords: ['note', 'reference', 'citation'], shortcut: '[^1]', inline: '[^{{1}}]' },
];

// ---- Pure helpers (tested) ----

/** The `/query` right before the caret, if the menu should be open. */
export function slashQuery(text: string, caret: number): { at: number; query: string } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const before = text.slice(lineStart, caret);
  // `/` opens at the start of a line or after a space, so URLs, paths and
  // closing tags never do.
  const m = before.match(/(?:^|\s)\/([^/\n]*)$/);
  if (!m) return null;
  const query = m[1];
  if (query.startsWith(' ') || query.includes('  ') || query.length > 32) return null;
  // Not inside fenced code.
  let fenced = false;
  for (const line of text.slice(0, lineStart).split('\n')) if (/^\s*(`{3,}|~{3,})/.test(line)) fenced = !fenced;
  if (fenced) return null;
  return { at: caret - query.length - 1, query };
}

export function filterCommands(query: string, commands: SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const score = (command: SlashCommand) => {
    // "To-do" also matches as "todo".
    const label = command.label.toLowerCase();
    const plain = label.replace(/-/g, '');
    if (label === q || command.id === q || command.keywords?.includes(q)) return 6;
    if (label.startsWith(q) || plain.startsWith(q)) return 5;
    const words = [...label.split(/[\s-]+/), ...(command.keywords ?? []), command.shortcut ?? ''].map((word) => word.toLowerCase());
    if (words.some((word) => word && word.startsWith(q))) return 4;
    if (label.includes(q)) return 3;
    if (command.description.toLowerCase().includes(q)) return 2;
    // Loose match: the query's letters appear in order in the label ("bl" → Bullet list).
    let i = 0;
    for (const char of label) if (char === q[i]) i++;
    return i === q.length ? 1 : 0;
  };
  return commands
    .map((command, order) => ({ command, order, score: score(command) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.command);
}

/** Expand a template's `{{…}}` markers into text plus the selection inside it. */
function expand(template: string): { text: string; sel: [number, number] } {
  const m = template.match(/\{\{([^}]*)\}\}/);
  if (!m || m.index === undefined) return { text: template, sel: [template.length, template.length] };
  const text = template.replace(/\{\{([^}]*)\}\}/g, '$1');
  return { text, sel: [m.index, m.index + m[1].length] };
}

/** Smallest edit that turns `before` into `after`, selecting [selStart, selEnd] of `after`. */
function diff(before: string, after: string, selStart: number, selEnd: number): Edit {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { from: head, to: before.length - tail, text: after.slice(head, after.length - tail), selStart, selEnd };
}

const LINE_PREFIX = /^([ \t]*)(#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\](?:[ \t]+|$))?)?/;

/** Apply `command` to `text`, replacing the `/query` typed from `at` to `caret`. */
export function applyCommand(text: string, at: number, caret: number, command: SlashCommand): Edit {
  const rest = text.slice(0, at) + text.slice(caret);
  const lineStart = rest.lastIndexOf('\n', at - 1) + 1;
  const nextBreak = rest.indexOf('\n', at);
  const lineEnd = nextBreak < 0 ? rest.length : nextBreak;
  const line = rest.slice(lineStart, lineEnd);

  if ('line' in command) {
    const m = line.match(LINE_PREFIX)!;
    // Headings can't be indented; list items keep their depth.
    const indent = command.line.startsWith('#') ? '' : m[1];
    const body = line.slice(m[0].length);
    const caretInBody = Math.max(0, at - lineStart - m[0].length);
    const next = rest.slice(0, lineStart) + indent + command.line + body + rest.slice(lineEnd);
    const sel = lineStart + indent.length + command.line.length + caretInBody;
    return diff(text, next, sel, sel);
  }

  if ('pick' in command) return diff(text, rest, at, at);

  if ('inline' in command) {
    const { text: insert, sel } = expand(typeof command.inline === 'function' ? command.inline() : command.inline);
    const next = rest.slice(0, at) + insert + rest.slice(at);
    return diff(text, next, at + sel[0], at + sel[1]);
  }

  // Blocks sit on their own lines, with the blank lines Markdown needs around them.
  const { text: block, sel } = expand(command.block);
  const prevBlank = lineStart === 0 || rest.slice(rest.lastIndexOf('\n', lineStart - 2) + 1, lineStart - 1).trim() === '';
  const nextLineEnd = rest.indexOf('\n', lineEnd + 1);
  const nextLine = lineEnd >= rest.length ? '' : rest.slice(lineEnd + 1, nextLineEnd < 0 ? rest.length : nextLineEnd);
  const after = nextLine.trim() ? '\n' : '';
  let from: number;
  let to: number;
  let before: string;
  if (line.trim() === '') {
    from = lineStart;
    to = lineEnd;
    before = prevBlank ? '' : '\n';
  } else {
    // Below the current line, dropping the space the `/` was typed after.
    from = lineStart + line.replace(/[ \t]+$/, '').length;
    to = lineEnd;
    before = '\n\n';
  }
  const next = rest.slice(0, from) + before + block + after + rest.slice(to);
  const base = from + before.length;
  return diff(text, next, base + sel[0], base + sel[1]);
}

// ---- Menu ----

let menu: HTMLDivElement | null = null;

export function attachSlashCommands(textarea: HTMLTextAreaElement) {
  let matches: SlashCommand[] = [];
  let active = 0;
  let open: { at: number; query: string } | null = null;
  let dismissedAt = -1;

  const close = () => {
    open = null;
    matches = [];
    menu?.remove();
    menu = null;
  };

  const accept = (command: SlashCommand | undefined) => {
    if (!command || !open) return;
    const edit = applyCommand(textarea.value, open.at, textarea.selectionStart, command);
    close();
    applyEdit(textarea, edit);
    // Let the `[[` autocomplete pick up the new link right away.
    if (command.id === 'link') textarea.dispatchEvent(new Event('input'));
    if ('pick' in command) textarea.dispatchEvent(new CustomEvent('tagdown:pick', { detail: command.pick }));
  };

  const render = () => {
    if (!open) return;
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'slash-menu';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', 'Commands');
      // Keep focus (and the caret) in the textarea while choosing.
      menu.addEventListener('mousedown', (event) => event.preventDefault());
      document.body.append(menu);
    }
    const grouped = !open.query.trim();
    let html = '';
    let group: SlashGroup | null = null;
    matches.forEach((command, i) => {
      if (grouped && command.group !== group) {
        group = command.group;
        html += `<div class="slash-menu-group" role="presentation">${escapeHtml(group)}</div>`;
      }
      html += `
        <div class="slash-menu-row ${i === active ? 'active' : ''}" role="option" aria-selected="${i === active}" data-index="${i}">
          <span class="slash-menu-icon" aria-hidden="true">${escapeHtml(command.icon)}</span>
          <span class="slash-menu-text"><strong>${escapeHtml(command.label)}</strong><small>${escapeHtml(command.description)}</small></span>
          ${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ''}
        </div>`;
    });
    menu.innerHTML = html;
    menu.querySelectorAll<HTMLElement>('.slash-menu-row').forEach((row) => {
      const index = Number(row.dataset.index);
      row.addEventListener('click', () => accept(matches[index]));
      row.addEventListener('mousemove', () => {
        if (active === index) return;
        active = index;
        menu?.querySelectorAll('.slash-menu-row').forEach((other) => {
          const on = Number((other as HTMLElement).dataset.index) === active;
          other.classList.toggle('active', on);
          other.setAttribute('aria-selected', String(on));
        });
      });
    });
    const caret = caretPosition(textarea, open.at);
    const width = Math.min(300, window.innerWidth - 16);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(8, Math.min(caret.left - 8, window.innerWidth - width - 8))}px`;
    const height = menu.offsetHeight;
    const below = caret.top + caret.height + 6;
    menu.style.top = `${below + height > window.innerHeight - 8 && caret.top - height - 6 > 8 ? caret.top - height - 6 : below}px`;
    menu.querySelector('.slash-menu-row.active')?.scrollIntoView({ block: 'nearest' });
  };

  const update = () => {
    const caret = textarea.selectionStart;
    const found = caret === textarea.selectionEnd ? slashQuery(textarea.value, caret) : null;
    if (!found) { dismissedAt = -1; return close(); }
    if (found.at === dismissedAt) return close();
    const sameQuery = open?.at === found.at && open.query === found.query;
    open = found;
    if (!sameQuery) {
      matches = filterCommands(found.query);
      active = 0;
    }
    if (!matches.length) {
      // Nothing matches: get out of the way until the query matches again.
      menu?.remove();
      menu = null;
      return;
    }
    render();
  };

  textarea.addEventListener('input', update);
  textarea.addEventListener('click', update);
  textarea.addEventListener('blur', close);
  textarea.addEventListener('scroll', () => { if (menu) render(); });
  // Registered before the list and editor key handlers, so the menu gets
  // ↩, Tab and Escape first while it's open.
  textarea.addEventListener('keydown', (event) => {
    if (!menu || !open || !matches.length) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'ArrowDown') { active = (active + 1) % matches.length; render(); }
    else if (event.key === 'ArrowUp') { active = (active - 1 + matches.length) % matches.length; render(); }
    else if (event.key === 'Escape') { dismissedAt = open.at; close(); }
    else accept(matches[active]);
  });
}

/** Shown in empty editors. */
export const SLASH_HINT = 'Type / for commands';

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
