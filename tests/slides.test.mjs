import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/tagdown/slides.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
const { splitSlides, slideAtLine } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const texts = (s) => splitSlides(s).map((slide) => slide.text);

test('splits at --- lines and drops empty slides', () => {
  assert.deepEqual(texts('# Talk\n\nIntro\n\n---\n\n## Two\n\n---\n---\n\n## Three\n'), ['# Talk\n\nIntro', '## Two', '## Three']);
});

test('a note without separators is one slide', () => {
  assert.deepEqual(texts('# Only\n\ntext'), ['# Only\n\ntext']);
});

test('ignores separators in code and skips frontmatter', () => {
  const note = '---\ntitle: x\ntags: [a]\n---\n# One\n```yaml\n---\nkey: v\n```\n---\n# Two';
  assert.deepEqual(texts(note), ['# One\n```yaml\n---\nkey: v\n```', '# Two']);
});

test('a leading rule that is not frontmatter starts the first slide', () => {
  assert.deepEqual(texts('---\n# One\n---\n# Two'), ['# One', '# Two']);
});

test('finds the slide holding a line', () => {
  const slides = splitSlides('# A\n\n---\n\n# B\ntext\n---\n# C');
  assert.deepEqual([0, 2, 4, 5, 7].map((line) => slideAtLine(slides, line)), [0, 0, 1, 1, 2]);
});
