import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/figures.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM,DOM.Iterable',
  '--outDir',
  'dist-test/figures',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { figureInfo, setFigure } = await import(new URL('../dist-test/figures/figures.js', import.meta.url).href);
const { tagdown } = await import(new URL('../src/tagdown/parser.js', import.meta.url).href);

test('a figure reads its caption and size the way the parser does', () => {
  assert.deepEqual(figureInfo('<figure src="a.png" caption="A cat" size=Small />', 0), { caption: 'A cat', size: 'small' });
  assert.deepEqual(figureInfo('<figure src=a.png "Positional" />', 0), { caption: 'Positional', size: null });
  assert.deepEqual(figureInfo('<figure src="a.png" size=huge />', 0), { caption: '', size: null });
  assert.equal(figureInfo('<figure src="a.png" />', 1), null);
});

test('setting a size or caption rewrites only that figure', () => {
  const two = '<figure src="attachments/a b.png" />\n<figure src="b.png" alt="B" width=200 />';
  assert.equal(setFigure(two, 1, 'size', 'medium'), '<figure src="attachments/a b.png" />\n<figure src="b.png" alt="B" size=medium />', 'a size replaces the width');
  assert.equal(setFigure(two, 0, 'caption', 'Our "new" office'), "<figure src=\"attachments/a b.png\" caption='Our \"new\" office' />\n<figure src=\"b.png\" alt=\"B\" width=200 />");
  assert.equal(setFigure('<figure src=a.png "Old" size=small />', 0, 'caption', 'New'), '<figure src=a.png size=small caption=New />', 'a positional caption is replaced');
  assert.equal(setFigure('<figure src=a.png caption="Old" size=small />', 0, 'caption', '  '), '<figure src=a.png size=small />', 'empty removes it');
  assert.equal(setFigure('<figure src=a.png size=small />', 0, 'size', ''), '<figure src=a.png />');
  assert.equal(setFigure('No figure here', 0, 'size', 'small'), null);
});

test('what the bar writes renders as meant', () => {
  const tag = setFigure(setFigure('<figure src="a.png" />', 0, 'size', 'large'), 0, 'caption', "It's \"here\"");
  assert.equal(tag, '<figure src="a.png" size=large caption="It\'s “here”" />');
  assert.equal(tagdown(tag), '<figure class="td-figure is-large"><img src="a.png" alt=""><figcaption>It’s “here”</figcaption></figure>');
});

test('Markdown images render, with an Obsidian-style width', () => {
  assert.equal(tagdown('![A cat](attachments/cat.png)'), '<p><img class="td-image" src="attachments/cat.png" alt="A cat"></p>');
  assert.equal(tagdown('![A cat|300](cat.png "Our cat")'), '<p><img class="td-image" src="cat.png" alt="A cat" width="300" title="Our cat"></p>');
  assert.equal(tagdown('[not an image](cat.png)'), '<p><a href="cat.png">not an image</a></p>');
  assert.equal(tagdown('![x](a*b*.png) *it*'), '<p><img class="td-image" src="a*b*.png" alt="x"> <em>it</em></p>', 'a file name stays as written');
});

test('figure sizes and percentage widths', () => {
  assert.equal(tagdown('<figure src=a.png width=60% />'), '<figure class="td-figure"><img src="a.png" alt="" style="width: 60%"></figure>');
  assert.equal(tagdown('<figure src=a.png width=200 size=huge />'), '<figure class="td-figure"><img src="a.png" alt="" width="200"></figure>');
});

test('Obsidian image embeds render as images', () => {
  assert.equal(tagdown('![[photo.png]]'), '<p><img class="td-image" src="photo.png" alt="photo.png" data-vault-name="photo.png"></p>', 'a bare name is looked up in the vault');
  assert.equal(tagdown('![[attachments/photo.png|300]]'), '<p><img class="td-image" src="attachments/photo.png" alt="photo.png" width="300"></p>');
  assert.equal(tagdown('See ![[a_b_.JPG|200x100]] and ![[cat.webp|Our cat]]'), '<p>See <img class="td-image" src="a_b_.JPG" alt="a_b_.JPG" width="200" height="100" data-vault-name="a_b_.JPG"> and <img class="td-image" src="cat.webp" alt="Our cat" data-vault-name="cat.webp"></p>');
  assert.doesNotMatch(tagdown('![[Plan]] ![[Plan#^ab12cd]]'), /td-image/, 'a note is not an image');
});
