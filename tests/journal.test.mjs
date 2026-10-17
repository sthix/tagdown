import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/journal.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM',
  '--outDir',
  'dist-test/journal',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { appendBlock, captureText } = await import(new URL('../dist-test/journal/journal.js', import.meta.url).href);

test('appending joins a list like the vault does (journal.rs)', () => {
  assert.equal(appendBlock('# Day\n\n- [ ] One\n', '- [ ] Two'), '# Day\n\n- [ ] One\n- [ ] Two\n');
  assert.equal(appendBlock('# Day\n\n1. One', '2. Two'), '# Day\n\n1. One\n2. Two\n');
  assert.equal(appendBlock('# Day\n\n- One\n', 'A thought'), '# Day\n\n- One\n\nA thought\n');
  assert.equal(appendBlock('# Day\n\n---', '-1 degrees'), '# Day\n\n---\n\n-1 degrees\n', 'a rule is no list');
});

test('a capture as a task becomes an open checklist item', () => {
  assert.equal(captureText('  Call Sam  ', false), 'Call Sam');
  assert.equal(captureText('Call Sam', true), '- [ ] Call Sam');
  assert.equal(captureText('Call Sam\nabout the trip', true), '- [ ] Call Sam\n  about the trip');
  assert.equal(captureText('- [ ] Already one', true), '- [ ] Already one');
});
