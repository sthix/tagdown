import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/propertyValues.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM',
  '--outDir',
  'dist-test/props',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { parseListInput, parseInput, convertValue, defaultValue, valueText, keyProblem } = await import(new URL('../dist-test/props/propertyValues.js', import.meta.url).href);

test('list fields split on commas outside links and quotes', () => {
  assert.deepEqual(parseListInput('Alex, [[Sam, the elder]], "a, b" ,, '), ['Alex', '[[Sam, the elder]]', 'a, b']);
  assert.deepEqual(parseListInput(''), []);
});

test('typed input becomes a value, or null when it can’t', () => {
  assert.deepEqual(parseInput('number', ' 2,5 '), { type: 'number', value: 2.5 });
  assert.equal(parseInput('number', 'abc'), null);
  assert.equal(parseInput('number', ''), null);
  assert.deepEqual(parseInput('date', '2026-11-14'), { type: 'date', value: '2026-11-14' });
  assert.equal(parseInput('date', 'tomorrow'), null);
  assert.deepEqual(parseInput('checkbox', 'yes'), { type: 'checkbox', value: true });
  assert.deepEqual(parseInput('text', '  [[Sam]] '), { type: 'text', value: '[[Sam]]' });
});

test('changing a type keeps what it can', () => {
  assert.deepEqual(convertValue({ type: 'text', value: '3' }, 'number'), { type: 'number', value: 3 });
  assert.deepEqual(convertValue({ type: 'text', value: 'soon' }, 'number'), { type: 'number', value: 0 });
  assert.deepEqual(convertValue({ type: 'text', value: '[[Sam]]' }, 'list'), { type: 'list', value: ['[[Sam]]'] });
  assert.deepEqual(convertValue({ type: 'list', value: ['2026-01-02', 'x'] }, 'date'), { type: 'date', value: '2026-01-02' });
  assert.deepEqual(convertValue({ type: 'number', value: 4 }, 'text'), { type: 'text', value: '4' });
  assert.deepEqual(convertValue({ type: 'date', value: '2026-01-02' }, 'checkbox'), { type: 'checkbox', value: false });
  assert.deepEqual(defaultValue('date', '2026-10-15'), { type: 'date', value: '2026-10-15' });
  assert.equal(valueText({ type: 'list', value: ['a', 'b'] }), 'a, b');
});

test('names must be usable and unique', () => {
  assert.equal(keyProblem('status', []), null);
  assert.equal(keyProblem('due date', []), null);
  assert.match(keyProblem('', []), /needs a name/);
  assert.match(keyProblem('Tags', []), /managed by Tagdown/);
  assert.match(keyProblem('a:b', []), /can’t be/);
  assert.match(keyProblem('#x', []), /can’t be/);
  assert.match(keyProblem('owner', ['owner']), /already has/);
  assert.equal(keyProblem('owner', ['owner'], 'owner'), null);
});
