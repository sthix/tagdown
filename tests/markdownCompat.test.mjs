import { test } from 'node:test';
import assert from 'node:assert/strict';

const { tagdown } = await import(new URL('../src/tagdown/parser.js', import.meta.url).href);

const fence = (code, lang = 'rust') => tagdown(`\`\`\`${lang}\n${code}\n\`\`\`\n`);
const codeText = (html) => [...html.matchAll(/<span class="td-code-text">(.*?)<\/span>/g)].map((m) => m[1]);

for (const [name, code, shown] of [
  ['generics', 'let a: Vec<String> = v;', 'let a: Vec&lt;String&gt; = v;'],
  ['the unit type', 'fn s() -> Result<()> {}', 'fn s() -&gt; Result&lt;()&gt; {}'],
  ['a comparison', 'if (a<b) {}', 'if (a&lt;b) {}'],
  ['HTML', '<div>hi</div>', '&lt;div&gt;hi&lt;/div&gt;'],
  ['a Tagdown tag', '<note warn>', '&lt;note warn&gt;'],
  ['a quote marker', '> not a quote', '&gt; not a quote'],
  ['a comment marker', '%% kept %%', '%% kept %%'],
  ['a rule', '---', '---'],
  ['a heading', '# comment', '# comment'],
  ['a callout marker', ':::', ':::'],
]) {
  test(`a code fence keeps ${name} as text`, () => {
    assert.deepEqual(codeText(fence(code)), [shown]);
  });
}

test('a code fence keeps its blank lines', () => {
  assert.deepEqual(codeText(fence('a\n\nb')).length, 3);
});

test('fences can use tildes, long runs, and languages with symbols', () => {
  assert.match(tagdown('~~~js\nlet a;\n~~~'), /td-code-lang">js</);
  assert.deepEqual(codeText(tagdown('````md\n```\nx\n```\n````')), ['```', 'x', '```']);
  assert.match(tagdown('```c++\nint a;\n```'), /td-code-lang">c\+\+</);
});

test('a fence right after a paragraph is still a fence', () => {
  const html = tagdown('Text\n```\ncode\n```\nMore');
  assert.match(html, /<p>Text<\/p><div class="td-code">/);
  assert.match(html, /<p>More<\/p>$/);
});

test('an unclosed fence runs to the end of the note', () => {
  assert.deepEqual(codeText(tagdown('```\na\n\nb')), ['a', ' ', 'b']);
});

test('mermaid fences still reach the diagram renderer', () => {
  assert.match(fence('graph TD\nA-->B', 'mermaid'), /<pre class="mermaid">graph TD\nA--&gt;B<\/pre>/);
});

test('a <code> tag still shows a fence as text', () => {
  assert.match(tagdown('<code md>\n```\nx\n```\n</code>'), /```/);
});

test('> lines are a blockquote, with inline formatting', () => {
  const html = tagdown('> A **bold** quote\n> second line');
  assert.match(html, /<blockquote><p>A <strong>bold<\/strong> quote\nsecond line<\/p><\/blockquote>/);
});

test('a quote can interrupt a paragraph, and blank lines end it', () => {
  assert.equal(tagdown('text\n> q\n\nafter').match(/<blockquote/g).length, 1);
  assert.match(tagdown('text\n> q\n\nafter'), /<p>text<\/p>.*<blockquote.*<p>q<\/p>.*<\/blockquote><p>after<\/p>/s);
  assert.equal(tagdown('> a\n\n> b').match(/<blockquote/g).length, 2);
});

test('a plain line after a quote continues it', () => {
  assert.match(tagdown('> a\nb'), /<blockquote><p>a\nb<\/p>/);
});

test('quotes nest and hold lists, inline tags and code', () => {
  assert.equal(tagdown('> a\n>\n> > b').match(/<blockquote/g).length, 2);
  assert.match(tagdown('> - one\n> - two'), /<blockquote[^>]*><ul/);
  assert.match(tagdown('> Press <keys>Cmd+K</keys> now'), /<blockquote[^>]*><p>Press .*now<\/p><\/blockquote>/s);
  assert.deepEqual(codeText(tagdown('> ```\n> a<b\n> ```')), ['a&lt;b']);
});

test('a > that closes a multi-line tag, or sits mid-line, is not a quote', () => {
  assert.doesNotMatch(tagdown('a > b'), /blockquote/);
  assert.doesNotMatch(tagdown('<div\n  class="x"\n>\nhi\n</div>'), /blockquote/);
  assert.doesNotMatch(tagdown('`> code`'), /blockquote/);
});

test('Obsidian callouts become notes', () => {
  const html = tagdown('> [!warning] Careful\n> Body **text**');
  assert.match(html, /td-note-warn/);
  assert.match(html, /td-note-icon">Careful</);
  assert.match(html, /<p>Body <strong>text<\/strong><\/p>/);
});

test('callout types map to the closest note, with a title from the type', () => {
  assert.match(tagdown('> [!note]\n> x'), /td-note-info.*td-note-icon">Note</s);
  assert.match(tagdown('> [!BUG]- Fold\n> x'), /td-note-error.*>Fold</s);
  assert.match(tagdown('> [!done]\n> x'), /td-note-ok.*>Done</s);
  assert.match(tagdown('> [!custom]\n> x'), /td-note-info.*>Custom</s);
});

test('%% comments never render', () => {
  assert.equal(tagdown('a %%secret%% b'), '<p>a  b</p>');
  assert.equal(tagdown('%%\nsecret\n\nmore\n%%\n\nshown'), '<p>shown</p>');
  assert.match(tagdown('`%%kept%%`'), /<code>%%kept%%<\/code>/);
});

test('a lone %% is text', () => {
  assert.match(tagdown('100%% sure'), /100%% sure/);
});

test('plain quotes and <quote> tags stay distinct', () => {
  assert.match(tagdown('> a'), /<blockquote><p>a<\/p><\/blockquote>/);
  assert.match(tagdown('<quote "Ada">\nb\n</quote>'), /<blockquote class="td-quote">.*td-quote-cite">Ada</s);
});

test('a quote inside a list item stays in that item', () => {
  const html = tagdown('- one\n  > quoted **here**\n  > more\n- two');
  assert.match(html, /<li>one<blockquote><p>quoted <strong>here<\/strong>\nmore<\/p><\/blockquote><\/li><li>two<\/li>/);
  assert.match(tagdown('- [ ] task\n  > why'), /class="td-task".*<blockquote><p>why<\/p>/s);
  assert.match(tagdown('- a\n  > [!tip] T\n  > b'), /<li>a<aside class="td-note td-note-tip"/);
  assert.equal(tagdown('- a\n  - b\n    > q').match(/<ul>/g).length, 2);
});

test('an indented quote with no list above it is still a quote', () => {
  assert.match(tagdown('  > q'), /<blockquote><p>q/);
});

test('fold markers make a callout collapsible', () => {
  assert.match(tagdown('> [!tip]- Closed\n> x'), /<details class="td-note td-note-fold td-note-tip">\s*<summary[^>]*>Closed</);
  assert.match(tagdown('> [!tip]+ Open\n> x'), /<details class="td-note td-note-fold td-note-tip" open>/);
  assert.match(tagdown('> [!tip] Plain\n> x'), /<aside class="td-note td-note-tip"/);
});
