import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

execFileSync('npx', [
  'tsc',
  'src/slashCommands.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM',
  '--outDir',
  'dist-test/slash',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

// The app is bundled by Vite, so its imports have no extensions; Node needs them.
const outDir = new URL('../dist-test/slash/', import.meta.url);
for (const file of readdirSync(outDir).filter((name) => name.endsWith('.js'))) {
  const path = new URL(file, outDir);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/(from '\.\/[\w]+)'/g, "$1.js'"));
}

const { slashQuery, filterCommands, applyCommand, SLASH_COMMANDS } = await import(new URL('../dist-test/slash/slashCommands.js', import.meta.url).href);

const command = (id) => SLASH_COMMANDS.find((c) => c.id === id);

// Type `marked` (with `|` as the caret right after the query), run the command,
// and show the result with `|` for the caret or `[[`…`]]` for a selection.
function apply(id, marked) {
  const caret = marked.indexOf('|');
  const text = marked.replace('|', '');
  const { at } = slashQuery(text, caret);
  const edit = applyCommand(text, at, caret, command(id));
  const out = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  if (edit.selStart === edit.selEnd) return out.slice(0, edit.selStart) + '|' + out.slice(edit.selStart);
  return out.slice(0, edit.selStart) + '[[' + out.slice(edit.selStart, edit.selEnd) + ']]' + out.slice(edit.selEnd);
}

test('the menu opens on / at a line start or after a space only', () => {
  assert.deepEqual(slashQuery('/', 1), { at: 0, query: '' });
  assert.deepEqual(slashQuery('Hello /hea', 10), { at: 6, query: 'hea' });
  assert.deepEqual(slashQuery('- /todo', 7), { at: 2, query: 'todo' });
  assert.equal(slashQuery('https://example.com', 8), null);
  assert.equal(slashQuery('and/or', 4), null);
  assert.equal(slashQuery('</grid', 2), null);
  assert.equal(slashQuery('/ head', 6), null);
  assert.equal(slashQuery('```\n/', 5), null);
});

test('filtering ranks names, aliases and loose matches', () => {
  assert.equal(filterCommands('h1')[0].id, 'h1');
  assert.equal(filterCommands('todo')[0].id, 'todo');
  assert.equal(filterCommands('tod')[0].id, 'todo');
  assert.equal(filterCommands('check')[0].id, 'todo');
  assert.equal(filterCommands('bul')[0].id, 'bullet');
  assert.equal(filterCommands('heading 2')[0].id, 'h2');
  assert.equal(filterCommands('zzzz').length, 0);
  assert.equal(filterCommands('').length, SLASH_COMMANDS.length);
});

test('line commands turn the current line into another kind, keeping its text', () => {
  assert.equal(apply('h1', '/h1|'), '# |');
  assert.equal(apply('h2', 'Some text /h2|'), '## Some text |');
  assert.equal(apply('todo', '- groceries /todo|'), '- [ ] groceries |');
  assert.equal(apply('text', '## Title /text|'), 'Title |');
  assert.equal(apply('numbered', '  - nested /num|'), '  1. nested |');
});

test('block commands replace an empty line or go below the current one', () => {
  assert.equal(apply('info', '/info|'), '::: info\n[[Your message]]\n:::');
  assert.equal(apply('info', 'Para\n/info|'), 'Para\n\n::: info\n[[Your message]]\n:::');
  assert.equal(apply('divider', 'Para /div|\nNext'), 'Para\n\n---\n|\n\nNext');
  assert.equal(apply('code', '/code|'), '```js\n|\n```');
});

test('inline commands insert at the caret', () => {
  assert.equal(apply('link', 'See /link|'), 'See [[|]]');
  assert.equal(apply('highlight', 'A /high| b'), 'A ==[[highlighted]]== b');
  assert.match(apply('today', 'Due /today|'), /^Due \[\[\d{4}-\d{2}-\d{2}\]\]\|$/);
});
