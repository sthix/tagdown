// Editable source for the explanatory SVGs used in docs/. No image tools needed.
// Run `node scripts/gen-doc-visuals.mjs` after changing an illustration.
import { mkdirSync, writeFileSync } from 'node:fs';

const output = new URL('../docs/images/guides/', import.meta.url);
mkdirSync(output, { recursive: true });
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const colors = { ink: '#30342f', muted: '#62685e', line: '#dce0d5', purple: '#6854aa', green: '#286548', amber: '#865616' };
const text = (x, y, value, { size = 20, color = colors.ink, weight = 400, mono = false } = {}) =>
  `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}"${mono ? ' font-family="ui-monospace, SFMono-Regular, Consolas, monospace"' : ''}>${esc(value)}</text>`;
const lines = (x, y, values, options = {}) => values.map((value, i) => text(x, y + i * 32, value, options)).join('');
const label = (x, y, value) => text(x, y, value, { size: 16, weight: 700, color: colors.muted });
const box = (x, y, w, h, fill = '#fff', stroke = colors.line) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}"/>`;
const arrow = (x1, y1, x2, y2, { dashed = false, color = colors.purple } = {}) =>
  `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2.5"${dashed ? ' stroke-dasharray="6 6"' : ''} marker-end="url(#arrow)"/>`;
const chip = (x, y, w, value, fill = '#eee9fa', color = colors.purple) => box(x, y, w, 34, fill, fill) + text(x + 12, y + 23, value, { size: 17, weight: 600, color });
const heading = (title, subtitle) => label(32, 35, 'TAGDOWN / VISUAL GUIDE') + text(32, 76, title, { size: 30, weight: 650 }) + text(32, 109, subtitle, { size: 19, color: colors.muted });
function save(name, height, title, description, content) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title><desc id="desc">${esc(description)}</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${colors.purple}" stroke-width="1.5"/></marker></defs>
<rect width="960" height="${height}" rx="16" fill="#f8f9f5"/>
<g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">${content}</g>
</svg>\n`;
  writeFileSync(new URL(name + '.svg', output), svg);
}

save('syntax-callout', 372, 'From callout source to preview', 'A tip block becomes a titled callout. The opening line sets its type and title; the closing line ends it.',
  heading('A little structure, written as text', 'Callout example: the markers describe the block; the body stays Markdown.') +
  label(32, 153, 'SOURCE') + label(510, 153, 'PREVIEW / ILLUSTRATION') +
  box(32, 172, 418, 160) + lines(52, 210, ['::: tip Pro tip', 'Keep **one idea** per note.', ':::'], { size: 20, mono: true }) +
  arrow(464, 251, 494, 251) + box(510, 172, 418, 160, '#eee9fa', '#d5cceb') +
  `<path d="M 511 184 V 320" stroke="#6854aa" stroke-width="4"/>` +
  text(534, 212, 'PRO TIP', { size: 17, weight: 700, color: colors.purple }) +
  `<text x="534" y="255" fill="${colors.ink}" font-size="23">Keep <tspan font-weight="700">one idea</tspan> per note.</text>` +
  text(534, 294, 'A titled tip, with a Markdown body.', { size: 18, color: colors.muted }));

save('syntax-layout', 560, 'Columns and tabs from plain text', 'A grid separates two columns with three vertical bars. A tabs block names each tab and holds its content.',
  heading('Turn a long note into smaller spaces', 'These sketches show the structure of the rendered components.') +
  label(32, 151, 'SOURCE') + label(510, 151, 'PREVIEW / ILLUSTRATION') +
  box(32, 170, 418, 176) + lines(52, 201, ['<grid 2>', 'Left column.', '|||', 'Right column.', '</grid>'], { size: 18, mono: true }) +
  arrow(464, 258, 494, 258) + box(510, 170, 418, 176) +
  box(530, 194, 179, 126, '#f3f5ee') + box(729, 194, 179, 126, '#f3f5ee') +
  text(546, 248, 'Left column.', { size: 20 }) + text(745, 248, 'Right column.', { size: 20 }) +
  box(32, 366, 418, 160) + lines(52, 400, ['<tabs>', '<tab "Source">The raw text.</tab>', '<tab "Preview">Rendered.</tab>', '</tabs>'], { size: 17, mono: true }) +
  arrow(464, 446, 494, 446) + box(510, 366, 418, 160) +
  chip(532, 387, 98, 'Source') + text(653, 411, 'Preview', { color: colors.muted }) +
  `<path d="M 532 430 H 906" stroke="${colors.line}"/>` + text(534, 473, 'The raw text.') + text(534, 506, 'Choose a tab to show its content.', { size: 18, color: colors.muted }));

save('note-types', 530, 'A template creates a typed note and a link connects its author', 'The Book Template supplies fields to a new Dune note. Choosing Frank Herbert for its author creates a wikilink, and Dune appears in the author note’s linked mentions.',
  heading('Templates give new notes a starting point', 'Example: a Book has an author field that links to a Person.') +
  label(32, 154, '1 / DEFINE THE TEMPLATE') + label(510, 154, '2 / CREATE A BOOK') +
  box(32, 172, 418, 182) + text(52, 207, 'Book Template', { size: 24, weight: 650 }) +
  lines(52, 244, ['author: "[[Person]]"', 'rating: 0', 'started: "{{date}}"'], { mono: true }) +
  arrow(464, 263, 494, 263) + box(510, 172, 418, 182) + text(530, 207, 'Dune', { size: 24, weight: 650 }) +
  lines(530, 244, ['type: Book', 'author: "[[Frank Herbert]]"', 'started: 2026-10-18'], { mono: true }) +
  arrow(719, 362, 719, 399) + box(510, 410, 418, 88, '#edf5ee') + text(530, 443, 'Frank Herbert', { size: 23, weight: 650 }) + text(530, 478, 'Linked mentions → Book → Dune', { size: 19, color: colors.green }) +
  text(52, 409, 'The template asks for a Person.', { size: 20 }) + text(52, 443, 'Choose or create one in the field.', { size: 20 }) + text(52, 477, 'The saved value is an ordinary link.', { size: 19, color: colors.muted }));

save('live-query', 540, 'A live query gathers tasks from tagged notes', 'Atlas and Beacon have a project tag and contribute their open tasks. An untagged Shopping note is excluded. Ticking a result updates the task in its original note.',
  heading('One query, tasks from several notes', 'The dashboard gathers results. Each task still belongs to its original note.') +
  label(32, 153, 'NOTES IN THE VAULT') + label(510, 153, 'DASHBOARD NOTE') +
  box(32, 173, 360, 97) + text(52, 204, 'Atlas', { weight: 650, size: 23 }) + chip(146, 183, 139, '#project/atlas') + text(52, 246, '☐ Publish the docs') +
  box(32, 286, 360, 97) + text(52, 317, 'Beacon', { weight: 650, size: 23 }) + chip(146, 296, 157, '#project/beacon') + text(52, 359, '☐ Send the recap') +
  box(32, 399, 360, 97, '#f0f1ed') + text(52, 433, 'Shopping', { weight: 650, size: 23, color: colors.muted }) + text(52, 473, 'No project tag: excluded', { color: colors.muted }) +
  arrow(402, 222, 498, 281) + arrow(402, 335, 498, 310) +
  box(510, 173, 418, 323) + label(532, 206, 'QUERY SOURCE') +
  lines(532, 244, ['<query tag:project', '       show:tasks />'], { size: 20, mono: true }) +
  `<path d="M 532 299 H 906" stroke="${colors.line}"/>` + label(532, 335, 'MATCHING OPEN TASKS') +
  text(532, 375, '☐ Publish the docs', { size: 22 }) + text(558, 402, 'from Atlas', { size: 17, color: colors.muted }) +
  text(532, 444, '☐ Send the recap', { size: 22 }) + text(558, 471, 'from Beacon', { size: 17, color: colors.muted }) +
  text(32, 526, 'Tick a result here → the checkbox in the original note changes too.', { size: 19, color: colors.purple }));

save('board-update', 488, 'Moving a board card changes the note’s status', 'A Project board has planned, active, and done lanes. Dragging Atlas from planned to active writes status: active into the Atlas note.',
  heading('A board is a view of your note properties', 'Illustration: drag Atlas from planned to active to change its status.') +
  box(32, 139, 896, 55) + text(50, 174, '<query type:Project show:board lanes:planned,active,done />', { mono: true, size: 21 }) +
  box(32, 218, 280, 153, '#f0f1ed') + box(340, 218, 280, 153, '#eee9fa', '#d5cceb') + box(648, 218, 280, 153, '#edf5ee') +
  label(50, 249, 'PLANNED') + label(358, 249, 'ACTIVE') + label(666, 249, 'DONE') +
  box(50, 270, 244, 75, '#f8f9f5') + text(68, 313, 'Atlas', { color: colors.muted, size: 22 }) +
  box(358, 270, 244, 75) + text(376, 313, 'Atlas', { weight: 650, size: 22 }) + arrow(230, 302, 344, 302) +
  box(666, 270, 244, 75) + text(684, 313, 'Beacon', { size: 22 }) +
  arrow(480, 380, 480, 405) + box(242, 417, 476, 44) + text(262, 447, 'Atlas note → status: active', { mono: true, size: 21 }));

save('task-repeat', 428, 'Completing a weekly task keeps a record and adds the next occurrence', 'An open weekly task for October 18 becomes a completed task. A new open task dated October 25 is inserted above it.',
  heading('Finish a repeating task, keep its history', 'A weekly example with an explicit date, so the next day is easy to see.') +
  label(32, 154, 'BEFORE / IN THE NOTE') + box(32, 173, 896, 58) +
  text(52, 209, '- [ ] Water plants [[2026-10-18]] every:week', { mono: true, size: 22 }) +
  arrow(480, 242, 480, 280) + chip(518, 245, 222, 'Tick the checkbox') +
  label(32, 308, 'AFTER / IN THE SAME NOTE') + box(32, 326, 896, 77) +
  text(52, 354, '- [ ] Water plants [[2026-10-25]] every:week', { mono: true, size: 22, color: colors.green }) +
  text(52, 386, '- [x] Water plants [[2026-10-18]] every:week', { mono: true, size: 22, color: colors.muted }));

save('slide-breaks', 560, 'Slide breaks map a note to three slides', 'The quarterly review example contains two standalone lines of three hyphens. They divide the title, highlights, and next steps into three slides.',
  heading('A line of three hyphens starts a new slide', 'The note stays one file. Presenting it turns each section into a slide.') +
  label(32, 154, 'ONE NOTE / SOURCE') + label(510, 154, 'THREE SLIDES / ILLUSTRATION') +
  box(32, 173, 418, 352) + lines(52, 207, ['# Quarterly review', 'Where we are'], { mono: true, size: 20 }) +
  chip(52, 255, 67, '---') + lines(52, 315, ['## Highlights', '- Shipped search', '- Doubled users'], { mono: true, size: 20 }) +
  chip(52, 395, 67, '---') + lines(52, 455, ['## Next', '<query tag:roadmap', '       show:tasks />'], { mono: true, size: 20 }) +
  arrow(464, 221, 494, 221) + arrow(464, 349, 494, 349) + arrow(464, 477, 494, 477) +
  box(510, 173, 418, 104, '#eee9fa') + label(528, 200, '1') + text(557, 229, 'Quarterly review', { size: 27, weight: 650 }) + text(557, 257, 'Where we are', { size: 18 }) +
  box(510, 297, 418, 104) + label(528, 324, '2') + text(557, 333, 'Highlights', { size: 25, weight: 650 }) + text(557, 360, '• Shipped search', { size: 18 }) + text(557, 387, '• Doubled users', { size: 18 }) +
  box(510, 421, 418, 104) + label(528, 448, '3') + text(557, 462, 'Next', { size: 25, weight: 650 }) + text(557, 498, 'Query results at presentation time', { size: 18, color: colors.muted }));

save('publishing', 540, 'Publishing turns a chosen set of notes into a static site', 'Choose all notes, a folder, or a tag, then choose an output folder. Tagdown writes an index, note pages, and assets. Links between published notes remain links; links outside the selection become plain text.',
  heading('From a selected set of notes to a website', 'Publishing writes a folder of static files. Upload that folder to your host.') +
  label(32, 153, '1 / CHOOSE NOTES') + label(510, 153, '2 / WRITE THE SITE FOLDER') +
  box(32, 173, 418, 137) + text(52, 211, 'All notes, a folder, or a tag', { size: 23, weight: 650 }) +
  text(52, 251, 'Example: the Projects folder') + text(52, 285, 'Atlas + Beacon', { color: colors.purple, weight: 600 }) +
  arrow(464, 240, 494, 240) + box(510, 173, 418, 137) +
  lines(530, 208, ['index.html', 'notes/atlas.html, beacon.html', 'assets/'], { mono: true, size: 20 }) +
  label(32, 357, '3 / LINKS FOLLOW THE PUBLISHED SELECTION') +
  box(32, 378, 418, 125, '#edf5ee') + text(52, 415, 'Atlas → Beacon', { size: 24, weight: 650, color: colors.green }) + text(52, 451, 'Both published: a working page link.') + text(52, 480, 'Queries include published notes only.', { size: 18, color: colors.muted }) +
  box(510, 378, 418, 125) + text(530, 415, 'Atlas → Weekly planning', { size: 24, weight: 650 }) + text(530, 451, 'Weekly planning is outside the selection.', { size: 19 }) + text(530, 480, 'The link becomes plain text.', { size: 18, color: colors.muted }));

save('version-restore', 478, 'Restoring an earlier version preserves the current one', 'Select an earlier snapshot and restore it. That content becomes current, while the version being replaced is saved to history first and can be restored later.',
  heading('Restore an earlier version without losing this one', 'The version being replaced goes into history before the selected version returns.') +
  label(32, 154, 'BEFORE RESTORE') + label(510, 154, 'AFTER RESTORE') +
  box(32, 173, 418, 97) + text(52, 207, 'Current note', { weight: 650, size: 23 }) + text(52, 244, 'The latest edits') +
  box(32, 295, 418, 105, '#eee9fa', '#d5cceb') + text(52, 332, 'Selected snapshot', { weight: 650, size: 23, color: colors.purple }) + text(52, 372, 'An earlier draft you want back') +
  box(510, 173, 418, 97, '#eee9fa', '#d5cceb') + text(530, 207, 'Current note', { weight: 650, size: 23, color: colors.purple }) + text(530, 244, 'The earlier draft, restored') +
  box(510, 295, 418, 105) + text(530, 332, 'History snapshot', { weight: 650, size: 23 }) + text(530, 372, 'The latest edits, kept for you') +
  arrow(450, 331, 510, 235) + arrow(450, 235, 510, 331, { dashed: true }) +
  text(32, 448, 'To undo a restore, open history again and restore the snapshot of the latest edits.', { size: 20, color: colors.muted }));

save('shared-vault', 540, 'The desktop app, command line, and MCP server share one local vault', 'The app uses Tauri commands and an AI assistant uses tagdown mcp. These and the CLI use tagdown-core to read and write the same Markdown files, with version history.',
  heading('Three ways into the same local vault', 'Use the app, a terminal, or a connected assistant. Your notes stay Markdown files.') +
  box(32, 149, 280, 115) + text(52, 188, 'Desktop app', { weight: 650, size: 24 }) + text(52, 228, 'via Tauri commands', { size: 19, color: colors.muted }) +
  box(340, 149, 280, 115) + text(360, 188, 'Terminal / scripts', { weight: 650, size: 24 }) + text(360, 228, 'tagdown <command>', { mono: true, size: 18 }) +
  box(648, 149, 280, 115) + text(668, 188, 'AI assistant', { weight: 650, size: 24 }) + text(668, 228, 'via tagdown mcp', { mono: true, size: 18 }) +
  arrow(172, 273, 320, 317) + arrow(480, 273, 480, 317) + arrow(788, 273, 640, 317) +
  box(222, 328, 516, 77, '#eee9fa', '#d5cceb') + text(244, 361, 'tagdown-core', { mono: true, size: 24, weight: 650, color: colors.purple }) + text(244, 390, 'Shared read, write, query, and history logic', { size: 19 }) +
  arrow(480, 415, 480, 444) + box(222, 455, 516, 61) + text(244, 494, 'Vault folder: .md notes + .tagdown/history/', { mono: true, size: 18 }));

console.log('Generated 10 documentation illustrations in docs/images/guides/');
