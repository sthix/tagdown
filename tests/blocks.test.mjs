import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/tagdown/blocks.ts',
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

const moduleUrl = new URL('../dist-test/blocks.js', import.meta.url);
const { splitBlocks, markSource } = await import(moduleUrl.href);
const { tagdown } = await import(new URL('../src/tagdown/parser.js', import.meta.url).href);

const texts = (source) => splitBlocks(source).map(({ start, end }) => source.split('\n').slice(start, end).join('\n'));

test('splits frontmatter, headings, paragraphs and lists into separate blocks', () => {
  const source = '---\ntags: [a]\n---\n# Title\nIntro line one\nline two\n\n- one\n\n- two\n  continued\n\nAfter';
  assert.deepEqual(texts(source), [
    '---\ntags: [a]\n---',
    '# Title',
    'Intro line one\nline two',
    '- one\n\n- two\n  continued',
    'After',
  ]);
});

test('keeps fences, callouts, math and tag containers whole across blank lines', () => {
  const source = [
    '```js', 'a', '', 'b', '```',
    '::: info', 'x', '', 'y', ':::',
    '$$', 'E = mc^2', '', '$$',
    '<tabs>', '<tab "A">', 'one', '', '</tab>', '</tabs>',
    '<kbd>⌘K</kbd> is an inline line',
  ].join('\n');
  assert.deepEqual(texts(source), [
    '```js\na\n\nb\n```',
    '::: info\nx\n\ny\n:::',
    '$$\nE = mc^2\n\n$$',
    '<tabs>\n<tab "A">\none\n\n</tab>\n</tabs>',
    '<kbd>⌘K</kbd> is an inline line',
  ]);
});

test('marker paragraphs survive rendering at the top level', () => {
  const source = '# Title\n\nPara #tag\n\n1. a\n2. b\n\n::: warn\nCareful\n:::\n\nText[^1]\n\n[^1]: Foot';
  const blocks = splitBlocks(source);
  const html = tagdown(markSource(source, blocks));
  for (let i = 1; i < blocks.length; i++) assert.match(html, new RegExp(`<p>TDBLOCKMARK${i}X</p>`));
});
