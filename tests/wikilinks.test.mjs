import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

execFileSync('npx', ['tsc', 'src/wikilinks.ts', 'src/templatePicker.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--lib', 'ES2022,DOM', '--outDir', 'dist-test/wikilinks', '--noEmit', 'false', '--skipLibCheck'], { stdio: 'inherit' });
const outDir = new URL('../dist-test/wikilinks/', import.meta.url);
for (const file of readdirSync(outDir).filter((name) => name.endsWith('.js'))) {
  const path = new URL(file, outDir);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/(from '\.\/[\w]+)'/g, "$1.js'"));
}
const { noteAliases, resolveTarget, suggestWikilinks } = await import(new URL('wikilinks.js', outDir));
const { templateBody, templateInsertion } = await import(new URL('templatePicker.js', outDir));
const note = (id, title, path = '', properties = []) => ({ id, title, path, properties, folderId: null });
const aliases = (...values) => [{ key: 'aliases', type: 'list', value: values }];

test('aliases use typed frontmatter properties and trim and deduplicate names', () => {
  const target = note('a', 'Samuel', '', [...aliases(' Sam ', 'SAM', ''), { key: 'alias', type: 'text', value: 'S. Rivera' }, { key: 'owner', type: 'text', value: 'Wrong' }]);
  assert.deepEqual(noteAliases(target), ['Sam', 'S. Rivera']);
  assert.equal(resolveTarget(' sam#Agenda ', [target])?.id, 'a');
  assert.equal(resolveTarget('s. rivera', [target])?.id, 'a');
  assert.equal(resolveTarget('Wrong', [target]), null);
});

test('titles and paths take precedence over aliases and shared aliases resolve to nothing', () => {
  const a = note('a', 'Samuel', 'people/sam.md', aliases('Alex', 'work/plan', 'shared'));
  const b = note('b', 'Alex', 'work/plan.md', aliases('shared'));
  assert.equal(resolveTarget('Alex', [a, b])?.id, 'b');
  assert.equal(resolveTarget('work/plan', [a, b])?.id, 'b');
  assert.equal(resolveTarget('shared', [a, b]), null);
  assert.equal(resolveTarget('sam', [a, b])?.id, 'a');
});

test('match quality outranks recency, then recency and backlink counts break ties', () => {
  const a = { ...note('a', 'Plan'), updatedAt: '2026-01-01' };
  const b = { ...note('b', 'Planning'), updatedAt: '2026-10-19' };
  const c = { ...note('c', 'Another topic', '', aliases('plan')), updatedAt: '2026-10-01' };
  const d = { ...note('d', 'Planet'), updatedAt: b.updatedAt, backlinkCount: 3 };
  assert.deepEqual(suggestWikilinks('plan', [a, b, c, d], null).map((n) => n.id), ['a', 'c', 'd', 'b']);
  assert.match(suggestWikilinks('plan', [c], null)[0].hint, /Alias: plan/);
  assert.deepEqual(suggestWikilinks('', [a, b, d], null).map((n) => n.id), ['d', 'b', 'a']);
  assert.deepEqual(suggestWikilinks('plan', [a, { ...b, folderId: 'archive' }], 'a'), []);
});

test('exact titles and file paths outrank competing aliases and path suffixes stay searchable', () => {
  const file = { ...note('file', 'Roadmap', 'work/sub/plan.md'), updatedAt: '2026-01-01' };
  const alias = { ...note('alias', 'Other', 'other.md', aliases('work/sub/plan', 'plan')), updatedAt: '2026-10-19' };
  const titled = note('titled', 'work/sub/plan', 'elsewhere.md');
  assert.deepEqual(suggestWikilinks('work/sub/plan', [alias, file, titled], null).map(n => n.id), ['titled', 'file', 'alias']);
  const fileSuggestion = suggestWikilinks('work/sub/plan', [alias, file, titled], null).find(n => n.id === 'file');
  assert.equal(fileSuggestion.linkTarget, 'work/sub/plan.md');
  assert.equal(resolveTarget(fileSuggestion.linkTarget, [alias, file, titled])?.id, 'file');
  for (const query of ['work/sub/plan', './WORK/sub/plan.md', 'sub/plan', 'plan']) {
    const matches = suggestWikilinks(query, [alias, file], null);
    assert.equal(matches[0].id, 'file', query);
    assert.equal(matches[0].linkTarget, 'work/sub/plan');
    assert.equal(matches[0].hint, 'work/sub/plan.md');
    assert.equal(resolveTarget(matches[0].linkTarget, [alias, file])?.id, 'file');
  }
  assert.equal(suggestWikilinks('work/sub/pl', [alias, file], null).find(n => n.id === 'file')?.linkTarget, 'work/sub/plan');
});

test('duplicate titles produce path based suggestions', () => {
  const suggestions = suggestWikilinks('Plan', [note('a', 'Plan', 'work/plan.md'), note('b', 'Plan', 'home/plan.md')], 'a');
  assert.equal(suggestions[0].linkTarget, 'home/plan');
});

test('template insertion strips metadata and title and expands only known placeholders', () => {
  const template = '---\nid: should-not-copy\naliases: [Private]\n---\n# Meeting Template\n\n## {{title}}\n{{weekday}} {{date}}\n[[{{yesterday}}]] [[{{tomorrow}}]]\n{{custom}}\n';
  const body = templateBody(template, 'Roadmap', '2026-10-19');
  assert.equal(body, '## Roadmap\nMonday 2026-10-19\n[[2026-10-18]] [[2026-10-20]]\n{{custom}}');
  assert.equal(templateBody('# Empty Template\n\n', '', '2026-10-19'), '');
  assert.equal(templateBody('# Code Template\n\n```md\n# Literal heading\n```', ''), '```md\n# Literal heading\n```');
});

test('template edits preserve surrounding paragraphs, unknown placeholders, and caret position', () => {
  const before = 'Before\n\n\n\nAfter';
  const edit = templateInsertion(before, 8, 8, '# Reusable Template\n\n## Prompts\n{{custom}}', 'Existing');
  const after = before.slice(0, edit.from) + edit.text + before.slice(edit.to);
  assert.equal(after, 'Before\n\n## Prompts\n{{custom}}\n\nAfter');
  assert.equal(after.slice(edit.selStart), '\n\nAfter');
  assert.equal(edit.selStart, edit.selEnd);
  assert.equal(templateInsertion(before, 8, 8, '# Empty Template', 'Existing'), null);
});
