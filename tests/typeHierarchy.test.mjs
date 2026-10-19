import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', ['tsc', 'src/typeHierarchy.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--outDir', 'dist-test/typeHierarchy', '--skipLibCheck'], { stdio: 'inherit' });
const { typeTree, typeMatches } = await import('../dist-test/typeHierarchy/typeHierarchy.js');

test('child types follow their parent with the right depth', () => {
  const types = [{ name: 'Author', parent: 'Person' }, { name: 'Book' }, { name: 'Novelist', parent: 'Author' }, { name: 'Person' }];
  assert.deepEqual(typeTree(types).map(({ type, depth }) => [type.name, depth]), [['Book', 0], ['Person', 0], ['Author', 1], ['Novelist', 2]]);
});

test('orphaned and cyclic types remain visible once each', () => {
  const types = [{ name: 'Author', parent: 'Missing' }, { name: 'A', parent: 'B' }, { name: 'B', parent: 'A' }];
  const rows = typeTree(types);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(({ type }) => type.name)).size, 3);
  assert.equal(rows.find(({ type }) => type.name === 'Author').depth, 0);
});

test('parent views and link suggestions include descendants but not siblings', () => {
  const author = { name: 'Novelist', ancestors: ['Author', 'Person'] };
  assert.equal(typeMatches(author, 'Novelist', ' person '), true);
  assert.equal(typeMatches(author, 'Novelist', 'author'), true);
  assert.equal(typeMatches(author, 'Novelist', 'Novelist'), true);
  assert.equal(typeMatches(author, 'Novelist', 'Book'), false);
  assert.equal(typeMatches(undefined, 'Person', 'Person'), true);
  assert.equal(typeMatches(undefined, 'Author', 'Person'), false);
});
