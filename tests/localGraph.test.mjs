import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/localGraph.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM,DOM.Iterable',
  '--outDir',
  'dist-test/graph',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { ringLayout, kindColor } = await import(new URL('../dist-test/graph/localGraph.js', import.meta.url).href);

test('neighbours sit on one ring, or two when there are many', () => {
  const one = ringLayout(4, 900, 560);
  assert.equal(one.length, 4);
  assert.deepEqual(one.map((p) => [Math.round(p.x), Math.round(p.y)]), [[450, 101], [684, 280], [450, 459], [216, 280]], 'starting at the top, clockwise');
  const two = ringLayout(20, 900, 560);
  assert.equal(two.length, 20);
  const distance = (p) => Math.hypot(p.x - 450, p.y - 280);
  assert.ok(two.slice(0, 12).every((p) => distance(p) < 180), 'the first twelve on the inner ring');
  assert.ok(two.slice(12).every((p) => distance(p) > 200), 'the rest further out');
  assert.equal(new Set(two.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)).size, 20, 'no two in one place');
});

test('a type keeps its color; journal pages and plain notes have their own', () => {
  const kinds = ['Book', 'Person', 'Project'];
  assert.equal(kindColor('person', kinds), kindColor('Person', ['Book', 'Person']));
  assert.notEqual(kindColor('Book', kinds), kindColor('Person', kinds));
  assert.notEqual(kindColor('Journal', kinds), kindColor('', kinds));
  assert.notEqual(kindColor('', kinds), kindColor('Book', kinds));
});
