import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/webLinks.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM,DOM.Iterable',
  '--outDir',
  'dist-test/weblinks',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { webUrl, onEmptyLine } = await import(new URL('../dist-test/weblinks/webLinks.js', import.meta.url).href);

test('only a lone http(s) address counts as a link to save', () => {
  assert.equal(webUrl('  https://example.com/post?id=1 \n'), 'https://example.com/post?id=1');
  assert.equal(webUrl('HTTP://example.com'), 'HTTP://example.com');
  assert.equal(webUrl('see https://example.com'), null);
  assert.equal(webUrl('https://example.com and more'), null);
  assert.equal(webUrl('file:///etc/hosts'), null);
  assert.equal(webUrl('https://'), null);
});

test('the paste offer needs a line with nothing else on it', () => {
  const text = '# Note\n\n\nSome text here\n';
  assert.equal(onEmptyLine(text, 8, 8), true, 'the empty line');
  assert.equal(onEmptyLine(text, 7, 7), true, 'the other empty line');
  assert.equal(onEmptyLine(text, 9, 9), false, 'the start of a line with text');
  assert.equal(onEmptyLine(text, 14, 14), false, 'inside a sentence');
  assert.equal(onEmptyLine('  \n', 2, 2), true, 'spaces only');
  assert.equal(onEmptyLine('Some text', 0, 9), true, 'the whole line selected');
});
