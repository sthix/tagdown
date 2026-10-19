import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/tagdown/diagrams.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const moduleText = outputText.replace("from 'pele'", `from ${JSON.stringify(import.meta.resolve('pele'))}`);
const { applyDiagrams } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString('base64')}`);

// The detached export path only needs these DOM operations. Rendering uses the
// real Pele package, including its parsers, escaping and accessibility IDs.
class ExportNode {
  isConnected = false;
  html = '';
  error = null;
  constructor(text) { this.text = text; }
  get textContent() { return this.html ? 'SVG labels are not Mermaid source' : this.text; }
  set textContent(text) { this.text = text; this.html = ''; this.error = null; }
  set innerHTML(html) { this.html = html; this.error = null; }
  querySelector() { return this.html || this.error ? {} : null; }
  replaceChildren(error) { this.error = error; this.html = ''; }
}

globalThis.document = {
  documentElement: {},
  createElement: () => ({ className: '', textContent: '' }),
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

const root = (...nodes) => ({ querySelectorAll: () => nodes });

test('Mermaid fences render to SVG for detached exports, with distinct accessibility IDs', () => {
  const a = new ExportNode('flowchart LR\n accTitle: Preview\n A[Source] --> B[Preview]');
  const b = new ExportNode('sequenceDiagram\n accTitle: Preview\n Alice->>Bob: Hello');
  applyDiagrams(root(a, b));
  assert.match(a.html, /<svg[^>]*class="pele pele-flowchart"/);
  assert.match(a.html, /Source/);
  assert.match(b.html, /pele-sequence/);
  const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids(a.html).length > 0);
  assert.equal(ids(a.html).some((id) => ids(b.html).includes(id)), false);
});

test('repeated renders preserve the original source and allow a node to be reused', () => {
  const node = new ExportNode('graph LR\n A[Original] --> B');
  applyDiagrams(root(node));
  applyDiagrams(root(node));
  assert.equal(node.error, null);
  assert.match(node.html, /Original/);
  node.textContent = 'graph TD\n C[Replacement] --> D';
  applyDiagrams(root(node));
  assert.match(node.html, /Replacement/);
  assert.doesNotMatch(node.html, /Original/);
});

test('invalid diagrams show errors as text and do not stop later diagrams', () => {
  const bad = new ExportNode('<img src=x onerror=alert(1)>');
  const good = new ExportNode('pie\n "One": 1\n "Two": 2');
  applyDiagrams(root(bad, good));
  assert.equal(bad.html, '');
  assert.equal(bad.error.className, 'pele pele-error');
  assert.ok(bad.error.textContent.length > 0);
  const message = bad.error.textContent;
  applyDiagrams(root(bad));
  assert.equal(bad.error.textContent, message);
  assert.match(good.html, /pele-pie/);
  bad.textContent = 'graph LR\n A --> B';
  applyDiagrams(root(bad));
  assert.equal(bad.error, null);
  assert.match(bad.html, /pele-flowchart/);
});

test('diagram labels are escaped and empty fences stay empty', () => {
  const hostile = new ExportNode('flowchart LR\n A["<script>alert(1)</script>"] --> B');
  const empty = new ExportNode('  ');
  applyDiagrams(root(hostile, empty));
  assert.match(hostile.html, /pele-flowchart/);
  assert.doesNotMatch(hostile.html, /<script/);
  assert.equal(empty.html, '');
  assert.equal(empty.error, null);
});
