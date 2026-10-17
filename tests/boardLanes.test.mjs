import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execFileSync('npx', [
  'tsc',
  'src/boardLanes.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM',
  '--outDir',
  'dist-test/board',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

// The app is bundled by Vite, so its imports have no extensions; Node needs them.
const built = new URL('../dist-test/board/boardLanes.js', import.meta.url);
writeFileSync(built, readFileSync(built, 'utf8').replace(/(from '\.\/[\w/]+)'/g, "$1.js'"));

const { boardLanes, laneKey, laneLabel, movedValue } = await import(built.href);

const note = (id, value) => ({ id, properties: value === undefined ? [] : [{ key: 'Status', ...value }] });
const text = (value) => ({ type: 'text', value });

test('lanes follow lanes: first, then the values notes use, links by title', () => {
  const notes = [
    note('a', text('Doing')),
    note('b', text('blocked')),
    note('c'),
    note('d', text('doing')),
    note('e', { type: 'list', value: ['[[Sam Rivera|Sam]]', 'todo'] }),
    note('f', text('[[sam rivera]]')),
    note('g', text('  ')),
  ];
  const { lanes, none } = boardLanes(notes, 'status', ['todo', 'doing', 'done']);
  assert.deepEqual(lanes.map((l) => [l.key, l.label, l.ids]), [
    ['todo', 'todo', ['e']],
    ['doing', 'doing', ['a', 'd']],
    ['done', 'done', []],
    ['blocked', 'blocked', ['b']],
    ['sam rivera', 'Sam', ['e', 'f']],
  ]);
  assert.deepEqual(none, ['c', 'g'], 'no value or a blank one');
});

test('checkbox lanes read as Yes and No', () => {
  const { lanes } = boardLanes([note('a', { type: 'checkbox', value: true }), note('b', { type: 'checkbox', value: false })], 'status', [], 'checkbox');
  assert.deepEqual(lanes.map((l) => [l.value, l.label]), [['true', 'Yes'], ['false', 'No']]);
  assert.equal(laneKey('[[Atlas#Plan|the plan]]'), 'atlas');
  assert.equal(laneLabel('[[Atlas#Plan]]'), 'Atlas');
});

test('moving a card sets, swaps or clears the value', () => {
  assert.deepEqual(movedValue({ key: 'status', ...text('todo') }, 'todo', 'doing', 'text'), text('doing'));
  assert.equal(movedValue({ key: 'status', ...text('todo') }, 'todo', null, 'text'), null, 'the none lane clears it');
  assert.deepEqual(movedValue(undefined, null, '3', 'number'), { type: 'number', value: 3 });
  assert.deepEqual(movedValue(undefined, null, 'true', 'checkbox'), { type: 'checkbox', value: true });
  assert.deepEqual(movedValue(undefined, null, '2026-11-14', 'date'), { type: 'date', value: '2026-11-14' });
  const list = { key: 'owners', type: 'list', value: ['Alex', '[[Sam]]'] };
  assert.deepEqual(movedValue(list, 'sam', 'Kim', 'list'), { type: 'list', value: ['Alex', 'Kim'] }, 'a list swaps the one item');
  assert.deepEqual(movedValue(list, 'Alex', 'sam', 'list'), { type: 'list', value: ['[[Sam]]'] }, 'without doubling an item it has');
  assert.equal(movedValue({ key: 'owners', type: 'list', value: ['Alex'] }, 'alex', null, 'list'), null);
});
