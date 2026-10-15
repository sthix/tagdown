import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/queryText.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM',
  '--outDir',
  'dist-test/querytext',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { queryTokens, getOption, setOption, nextSort, withColumns } = await import(new URL('../dist-test/querytext/queryText.js', import.meta.url).href);

test('queries split like the vault splits them', () => {
  assert.deepEqual(queryTokens('tag:a  "two words" owner=[[Sam Rivera]] columns:"due date,status"'), ['tag:a', '"two words"', 'owner=[[Sam Rivera]]', 'columns:"due date,status"']);
  assert.equal(getOption('show:table columns:"due date,status"', 'columns'), 'due date,status');
  assert.equal(getOption('show:table', 'sort'), null);
});

test('options are replaced in place, added at the end, or removed', () => {
  assert.equal(setOption('show:table sort:due status=active', 'sort', '-due'), 'show:table sort:-due status=active');
  assert.equal(setOption('show:table status=active', 'sort', 'due'), 'show:table status=active sort:due');
  assert.equal(setOption('show:table sort:due status=active', 'sort', null), 'show:table status=active');
  assert.equal(setOption('show:table', 'columns', 'due date,owner'), 'show:table columns:"due date,owner"');
  assert.equal(withColumns('show:table columns:a,b', ['a']), 'show:table columns:a');
  assert.equal(withColumns('show:table columns:a', []), 'show:table columns:');
});

test('clicking a header sorts up, then down, then back to the default', () => {
  assert.equal(nextSort(null, 'due'), 'due');
  assert.equal(nextSort('due', 'due'), '-due');
  assert.equal(nextSort('-due', 'due'), null);
  assert.equal(nextSort('priority', 'due'), 'due');
  assert.equal(nextSort(null, 'title'), 'title');
  assert.equal(nextSort('title', 'title'), null);
});
