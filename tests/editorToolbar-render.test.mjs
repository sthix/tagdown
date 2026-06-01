import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/editorToolbar.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--outDir',
  'dist-test',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const moduleUrl = new URL('../dist-test/editorToolbar.js', import.meta.url);
const { renderEditorToolbar } = await import(moduleUrl.href);

test('renders write actions with structure and tagdown items inside the component drawer', () => {
  const html = renderEditorToolbar([
    { label: 'Tabs', description: 'Switchable tab panels', category: 'Layout', template: '<tabs>demo</tabs>' },
    { label: 'Mermaid', description: 'Diagram syntax', category: 'Code & Math', template: '```mermaid\ngraph LR\n```' },
  ]);

  assert.match(html, /class="format-toolbar"/);
  assert.match(html, /aria-label="Formatting toolbar"/);
  assert.match(html, /<span class="toolbar-group-label">Write<\/span>/);
  assert.doesNotMatch(html, /<span class="toolbar-group-label">Structure<\/span>/);
  assert.doesNotMatch(html, /<span class="toolbar-group-label">Tagdown<\/span>/);
  assert.match(html, /data-wrap="\*\*\|\*\*"/);
  assert.match(html, /data-insert="# "/);
  assert.match(html, /data-line="true"/);
  assert.match(html, /id="insert-module"/);
  assert.match(html, /<strong>Components<\/strong>/);
  assert.doesNotMatch(html, /<strong>Insert<\/strong>/);
  assert.match(html, /<section class="toolbar-menu-section" aria-label="Structure">/);
  assert.match(html, /<strong>Bullet list<\/strong>/);
  assert.match(html, /<strong>Table<\/strong>/);
  assert.match(html, /<strong>Callout<\/strong>/);
  assert.match(html, /<section class="toolbar-menu-section" aria-label="Tagdown">/);
  assert.match(html, /<strong>Tagdown pair<\/strong>/);
  assert.match(html, /role="menuitem"[^>]*data-wrap="&lt;kbd&gt;\|&lt;\/kbd&gt;"/);
  assert.match(html, /<section class="toolbar-menu-section" aria-label="Layout">/);
  assert.match(html, /<strong>Tabs<\/strong>/);
  assert.match(html, /<small>Switchable tab panels<\/small>/);
});

test('escapes component labels descriptions and templates before rendering attributes', () => {
  const html = renderEditorToolbar([
    { label: '<Bad "label">', description: 'Use <unsafe> & "quoted" text', category: 'Text', template: '<x value="bad">&</x>' },
  ]);

  assert.doesNotMatch(html, /<Bad/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;Bad &quot;label&quot;&gt;/);
  assert.match(html, /Use &lt;unsafe&gt; &amp; &quot;quoted&quot; text/);
  assert.match(html, /data-insert="&lt;x value=&quot;bad&quot;&gt;&amp;&lt;\/x&gt;"/);
});
