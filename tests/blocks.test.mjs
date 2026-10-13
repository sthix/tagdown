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

const { moveBlock, firstMovableBlock } = await import(moduleUrl.href);

const move = (source, from, to) => moveBlock(source, splitBlocks(source), from, to);

test('moving a block keeps the gaps between blocks that stay neighbours', () => {
  const source = '# T\n\nOne\n\nTwo\n\n\nThree\n';
  assert.deepEqual(move(source, 3, 1), { source: '# T\n\nThree\n\nOne\n\nTwo\n', start: 2 });
  assert.deepEqual(move(source, 1, 4), { source: '# T\n\nTwo\n\n\nThree\n\nOne\n', start: 7 });
  assert.equal(move(source, 1, 1), null);
  assert.equal(move(source, 1, 2), null);
});

test('moved blocks get a blank line where they had none', () => {
  // A heading followed directly by a paragraph.
  const source = '# T\n## Part\nText\n\nOther';
  assert.equal(move(source, 3, 1).source, '# T\n\nOther\n\n## Part\nText');
});

test('multi-line blocks move whole', () => {
  const source = '# T\n\n- a\n- b\n\n::: tip\nHi\n:::\n\nEnd';
  assert.equal(move(source, 2, 1).source, '# T\n\n::: tip\nHi\n:::\n\n- a\n- b\n\nEnd');
});

test('frontmatter and the title stay at the top', () => {
  const source = '---\ntags: [a]\n---\n# Title\n\nBody';
  assert.equal(firstMovableBlock(source, splitBlocks(source)), 2);
  assert.equal(firstMovableBlock('Intro\n\n# Title\n\nBody', splitBlocks('Intro\n\n# Title\n\nBody')), 2);
  assert.equal(firstMovableBlock('No title\n\nBody', splitBlocks('No title\n\nBody')), 0);
});

const { sectionSpan } = await import(moduleUrl.href);

test('a heading section runs to the next heading of the same or a higher level', () => {
  const source = '# T\n\n## A\n\nText\n\n### A.1\n\nMore\n\n## B\n\nEnd';
  const blocks = splitBlocks(source);
  assert.equal(sectionSpan(source, blocks, 1), 4); // ## A, Text, ### A.1, More
  assert.equal(sectionSpan(source, blocks, 3), 2); // ### A.1, More
  assert.equal(sectionSpan(source, blocks, 5), 2); // ## B, End
  assert.equal(sectionSpan(source, blocks, 2), 1); // a paragraph
});

test('a whole section moves together', () => {
  const source = '# T\n\n## A\n\nText\n\n## B\n\nEnd';
  const blocks = splitBlocks(source);
  assert.deepEqual(moveBlock(source, blocks, 3, 1, 2), { source: '# T\n\n## B\n\nEnd\n\n## A\n\nText', start: 2 });
  assert.equal(moveBlock(source, blocks, 1, 5, 2).source, '# T\n\n## B\n\nEnd\n\n## A\n\nText');
  // Dropping inside the moving section does nothing.
  assert.equal(moveBlock(source, blocks, 1, 2, 2), null);
  assert.equal(moveBlock(source, blocks, 1, 3, 2), null);
});
