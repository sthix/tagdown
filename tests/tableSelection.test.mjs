import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/tableSelection.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM,DOM.Iterable',
  '--outDir',
  'dist-test/selection',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { pickRows, selectionFor } = await import(new URL('../dist-test/selection/tableSelection.js', import.meta.url).href);

const ids = (set) => [...set].sort();

test('ticking picks a row; shift-ticking picks the rows from the last one', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(ids(pickRows(order, new Set(), 1, null, false, true)), ['b']);
  assert.deepEqual(ids(pickRows(order, new Set(['b']), 3, 1, true, true)), ['b', 'c', 'd']);
  assert.deepEqual(ids(pickRows(order, new Set(['b']), 0, 3, true, true)), ['a', 'b', 'c', 'd'], 'upwards too');
  assert.deepEqual(ids(pickRows(order, new Set(['a', 'b', 'c', 'd']), 2, 0, true, false)), ['d'], 'shift-unticking clears the range');
  assert.deepEqual(ids(pickRows(order, new Set(['a']), 4, null, true, true)), ['a', 'e'], 'no anchor: just this row');
});

test('a selection outlives a repaint, minus rows no longer listed', () => {
  const first = selectionFor('show:table type:Book', ['a', 'b', 'c']);
  first.ids = new Set(['a', 'c']);
  first.anchor = 2;
  const again = selectionFor('show:table type:Book', ['a', 'b']);
  assert.deepEqual(ids(again.ids), ['a']);
  assert.equal(again.anchor, null);
  assert.equal(selectionFor('show:table type:Person', ['a']).ids.size, 0, 'each table its own');
});
