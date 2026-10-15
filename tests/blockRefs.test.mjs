import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/blockRefs.ts',
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

const { blockIdOf, blockIds, blockIdOfTarget, newBlockId, markerLine, ensureBlockId, blockReference } = await import(new URL('../dist-test/blockRefs.js', import.meta.url).href);
const { tagdown } = await import(new URL('../src/tagdown/parser.js', import.meta.url).href);

// A random source that always yields `id`, then anything.
const fixed = (id) => {
  const digits = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const queue = [...id].map((c) => digits.indexOf(c) / 36 + 0.001);
  return () => queue.shift() ?? 0;
};

test('markers sit at a line end after whitespace', () => {
  assert.equal(blockIdOf('A paragraph ^ab12cd'), 'ab12cd');
  assert.equal(blockIdOf('- [ ] task ^t-2  '), 't-2');
  assert.equal(blockIdOf('E = mc^2'), null);
  assert.equal(blockIdOf('2^10^'), null);
  assert.equal(blockIdOf('[[Plan#^ab12cd]]'), null);
  assert.deepEqual([...blockIds('one ^a1\ntwo\n- three ^B2')], ['a1', 'b2']);
  assert.equal(blockIdOfTarget('Plan#^ab12cd'), 'ab12cd');
  assert.equal(blockIdOfTarget('Plan#Setup'), null);
});

test('new ids are short, start with a letter and avoid taken ones', () => {
  assert.equal(newBlockId(new Set(), fixed('ab12cd')), 'ab12cd');
  assert.equal(newBlockId(new Set(['ab12cd']), fixed('ab12cdxy34zz')), 'xy34zz');
  assert.equal(newBlockId(new Set(), fixed('1abcdeqwerty')), 'qwerty');
  assert.match(newBlockId(new Set()), /^[a-z][a-z0-9]{5}$/);
});

test('paragraphs are marked on their last line, items and headings on their own', () => {
  const lines = ['# Title', 'first', 'second', '', '- item', '  - child', '```', 'code', '```', '| a | b |'];
  assert.equal(markerLine(lines, 0), 0);
  assert.equal(markerLine(lines, 1), 2);
  assert.equal(markerLine(lines, 2), 2);
  assert.equal(markerLine(lines, 3), null);
  assert.equal(markerLine(lines, 4), 4);
  assert.equal(markerLine(lines, 5), 5);
  assert.equal(markerLine(lines, 7), null);
  assert.equal(markerLine(lines, 9), null);
});

test('copying a reference adds an id once and only to that block', () => {
  const text = 'Intro\n\nfirst line\nsecond line\n\n- [ ] task';
  const caret = text.indexOf('first') + 2;
  const added = ensureBlockId(text, caret, new Set(), fixed('ab12cd'));
  assert.deepEqual(added, { text: 'Intro\n\nfirst line\nsecond line ^ab12cd\n\n- [ ] task', id: 'ab12cd', changed: true });
  assert.deepEqual(ensureBlockId(added.text, caret, new Set(['ab12cd'])), { text: added.text, id: 'ab12cd', changed: false });
  const task = ensureBlockId('- [ ] task  ', 3, new Set(), fixed('tt1234'));
  assert.equal(task.text, '- [ ] task ^tt1234');
  assert.equal(ensureBlockId('a\n\n', 2, new Set()), null);
  assert.equal(blockReference(' Plan ', 'ab12cd'), '[[Plan#^ab12cd]]');
  assert.equal(blockReference('Plan', 'ab12cd', true), '![[Plan#^ab12cd]]');
});

test('the parser hides markers and keeps them as anchors', () => {
  assert.equal(tagdown('Para line\nsecond ^ab12cd'), '<p>Para line\nsecond<span class="td-block-id" data-block-id="ab12cd"></span></p>');
  assert.match(tagdown('- [ ] task ^t-2'), /<span>task<span class="td-block-id" data-block-id="t-2"><\/span><\/span>/);
  assert.equal(tagdown('## Setup ^h1'), '<h2 id="setup">Setup<span class="td-block-id" data-block-id="h1"></span></h2>');
  assert.equal(tagdown('E = mc^2 and `x ^y`'), '<p>E = mc^2 and <code>x ^y</code></p>');
});

test('block links read as the note title and keep the id in their target', () => {
  const html = tagdown('See [[Plan#^ab12cd]] and [[Plan#^x|this]]');
  assert.match(html, /<a class="td-wikilink td-blockref" href="#Plan%23%5Eab12cd" data-target="Plan#&#94;ab12cd">Plan<\/a>/);
  assert.match(html, />this<\/a>/);
  assert.doesNotMatch(html, /<sup>/);
});

test('block embeds become placeholders the app fills', () => {
  assert.equal(
    tagdown('![[Plan#^ab12cd]]'),
    '<div class="td-transclusion" data-target="Plan#&#94;ab12cd"><a class="td-wikilink td-transclusion-source" href="#Plan%23%5Eab12cd" data-target="Plan#&#94;ab12cd">Plan</a><div class="td-transclusion-body"></div></div>',
  );
  assert.match(tagdown('Inline ![[Plan#^ab12cd|quote]] here'), /^<p>Inline <span class="td-transclusion" data-target="Plan#&#94;ab12cd">.*>quote<\/a><span class="td-transclusion-body"><\/span><\/span> here<\/p>$/);
  // Only block references embed; other targets stay ordinary links.
  assert.match(tagdown('![[Plan]]'), /^<p>!<a class="td-wikilink"/);
});
