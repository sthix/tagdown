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

const { parseListInput, parseInput, convertValue, defaultValue, displayText, inputText, valueText, keyProblem, EDITABLE_TYPES } = await import(new URL('../dist-test/props/propertyValues.js', import.meta.url).href);

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

test('all editable types have defaults and lossless input representations', () => {
  for (const { type } of EDITABLE_TYPES) {
    const value = defaultValue(type, '2026-10-19');
    assert.deepEqual(parseInput(type, inputText(value)), value, type);
  }
  const items = { type: 'list', value: ['a, b', 'say "hi"', 'C:\\notes', '[[Sam, the elder]]'] };
  assert.deepEqual(parseInput('list', inputText(items)), items);
});

test('specialized fields validate without losing multiline or international text', () => {
  assert.deepEqual(parseInput('longtext', '  line one\n\nline two\t '), { type: 'longtext', value: '  line one\n\nline two\t ' });
  assert.equal(parseInput('date', '2026-02-30'), null);
  assert.equal(parseInput('date', '2025-02-29'), null);
  assert.ok(parseInput('date', '2024-02-29'));
  assert.deepEqual(parseInput('datetime', '2026-10-19T14:30'), { type: 'datetime', value: '2026-10-19T14:30:00' });
  for (const text of ['2026-02-30T10:00', '2026-10-19T25:00', '2026-10-19T10:60']) assert.equal(parseInput('datetime', text), null);
  assert.ok(parseInput('url', 'https://example.com/path?q=a#part'));
  for (const text of ['javascript:alert(1)', 'file:///tmp/a', 'https://']) assert.equal(parseInput('url', text), null);
  assert.ok(parseInput('email', 'sascha+notes@example.de'));
  assert.equal(parseInput('email', 'bad@'), null);
  assert.ok(parseInput('phone', '+49 (30) 123-456'));
  assert.equal(parseInput('phone', 'call me'), null);
  assert.deepEqual(parseInput('multiselect', 'Doing, Done, Doing'), { type: 'multiselect', value: ['Doing', 'Done'] });
});

test('percent, duration, currency and rating preserve numeric semantics', () => {
  assert.deepEqual(parseInput('percent', '75%'), { type: 'percent', value: 0.75 });
  assert.equal(displayText({ type: 'percent', value: 0.75 }), '75%');
  assert.deepEqual(parseInput('duration', '1:30:05.5'), { type: 'duration', value: 5405.5 });
  assert.deepEqual(parseInput('duration', '90'), { type: 'duration', value: 90 });
  assert.equal(displayText({ type: 'duration', value: 5405.5 }), '1:30:05.5');
  for (const text of ['-5', '1:60', '1.5:02', 'Infinity']) assert.equal(parseInput('duration', text), null);
  assert.equal(displayText({ type: 'currency', value: 12.5 }), '¤12.50');
  for (const text of ['6', '-1', '2.5', 'Infinity']) assert.equal(parseInput('rating', text), null);
  assert.equal(displayText({ type: 'rating', value: 3 }), '★★★☆☆');
  assert.deepEqual(convertValue({ type: 'percent', value: 0.75 }, 'number'), { type: 'number', value: 0.75 });
  assert.deepEqual(convertValue({ type: 'number', value: 0.75 }, 'percent'), { type: 'percent', value: 0.75 });
  assert.deepEqual(convertValue({ type: 'date', value: '2026-10-19' }, 'datetime'), { type: 'datetime', value: '2026-10-19T00:00:00' });
  assert.deepEqual(convertValue({ type: 'list', value: ['a', 'b'] }, 'multiselect'), { type: 'multiselect', value: ['a', 'b'] });
});
