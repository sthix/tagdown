import { test } from 'node:test';
import assert from 'node:assert/strict';

const { tagdown } = await import(new URL('../src/tagdown/parser.js', import.meta.url).href);

test('dashes become en and em dashes next to quotes and words', () => {
  const html = tagdown('"Hello" --- this is a test... 1990--2020.');
  assert.match(html, /”\s—\sthis is a test…\s1990–2020\./);
  assert.match(tagdown('one---two -- three'), /one—two – three/);
});

test('flags and longer dash runs stay as typed', () => {
  assert.match(tagdown('run it with --verbose and ----'), /--verbose and ----/);
});
