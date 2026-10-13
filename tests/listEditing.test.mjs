import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/listEditing.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM',
  '--outDir',
  'dist-test',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { enterInList, softBreakInList, indent, outdent, backspaceInList, NOOP } = await import(new URL('../dist-test/listEditing.js', import.meta.url).href);

// `|` marks the caret (or `[`…`]` a selection) in both input and expected text.
function run(fn, marked) {
  let text = marked;
  let start;
  let end;
  if (text.includes('|')) {
    start = end = text.indexOf('|');
    text = text.replace('|', '');
  } else {
    start = text.indexOf('[[');
    text = text.replace('[[', '');
    end = text.indexOf(']]');
    text = text.replace(']]', '');
  }
  const edit = fn(text, start, end);
  if (edit === null || edit === NOOP) return edit;
  const out = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  if (edit.selStart === edit.selEnd) return out.slice(0, edit.selStart) + '|' + out.slice(edit.selStart);
  return out.slice(0, edit.selStart) + '[[' + out.slice(edit.selStart, edit.selEnd) + ']]' + out.slice(edit.selEnd);
}

test('Enter continues bullets, numbers and tasks', () => {
  assert.equal(run(enterInList, '- one|'), '- one\n- |');
  assert.equal(run(enterInList, '* one|'), '* one\n* |');
  assert.equal(run(enterInList, '1. one|\n2. two'), '1. one\n2. |\n3. two');
  assert.equal(run(enterInList, '- [x] done|'), '- [x] done\n- [ ] |');
  assert.equal(run(enterInList, '  - nested|'), '  - nested\n  - |');
});

test('Enter in the middle of an item moves the rest into the new item', () => {
  assert.equal(run(enterInList, '- one |two'), '- one\n- |two');
});

test('Enter on an empty item ends the list, a second Enter is a plain newline', () => {
  assert.equal(run(enterInList, '- one\n- |'), '- one\n\n|');
  assert.equal(run(enterInList, '- |'), '|');
  assert.equal(run(enterInList, '1. a\n2. |\n3. c'), '1. a\n\n|\n\n3. c');
  assert.equal(run(enterInList, '- one\n\n|'), null);
});

test('Enter on an empty nested item steps out a level', () => {
  assert.equal(run(enterInList, '- one\n  - |'), '- one\n- |');
});

test('Enter at the end of a parent adds its first child', () => {
  assert.equal(run(enterInList, '- parent|\n  - child'), '- parent\n  - |\n  - child');
});

test('Enter outside lists and inside code fences is left alone', () => {
  assert.equal(run(enterInList, 'Just text|'), null);
  assert.equal(run(enterInList, '```\n- code|\n```'), null);
  assert.equal(run(enterInList, '---|'), null);
});

test('Shift+Enter continues the item on a new line', () => {
  assert.equal(run(softBreakInList, '- one|'), '- one\n  |');
  assert.equal(run(softBreakInList, '1. one|'), '1. one\n   |');
});

test('Tab nests an item and its children under the item above', () => {
  assert.equal(run(indent, '- a\n- b|\n  - c\n- d'), '- a\n  - b|\n    - c\n- d');
  assert.equal(run(indent, '1. a\n2. b|\n3. c'), '1. a\n   1. b|\n2. c');
  assert.equal(run(indent, '- a|'), NOOP);
  assert.equal(run(indent, 'text|'), null);
});

test('Tab and Shift+Tab move every selected item', () => {
  assert.equal(run(indent, '- a\n- [[b\n- c]]'), '- a\n  - [[b\n  - c]]');
  assert.equal(run(outdent, '- a\n  - [[b\n  - c]]'), '- a\n- [[b\n- c]]');
});

test('Shift+Tab moves an item out to its parent level', () => {
  assert.equal(run(outdent, '- a\n  - b|\n    - c'), '- a\n- b|\n  - c');
  assert.equal(run(outdent, '- a|'), NOOP);
  assert.equal(run(outdent, '1. a\n   1. b|\n2. c'), '1. a\n2. b|\n3. c');
});

test('Backspace after a marker unwraps it a step at a time', () => {
  assert.equal(run(backspaceInList, '- [ ] |task'), '- |task');
  assert.equal(run(backspaceInList, '- |item'), '|item');
  assert.equal(run(backspaceInList, '- it|em'), null);
});
