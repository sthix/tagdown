import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', ['tsc', 'src/aiEdits.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--lib', 'ES2022,DOM', '--outDir', 'dist-test/aiEdits', '--skipLibCheck'], { stdio: 'inherit' });
const { aiResultEdit } = await import('../dist-test/aiEdits/aiEdits.js');

test('async AI results reject changed notes and stale selections', () => {
  const snapshot = { noteId: 'one', content: '# Notes\n\nOriginal', start: 9, end: 17 };
  assert.throws(() => aiResultEdit(snapshot, 'two', snapshot.content, 'New', 'replace'), /note changed/);
  assert.throws(() => aiResultEdit(snapshot, 'one', `${snapshot.content}!`, 'New', 'replace'), /note changed/);
  assert.throws(() => aiResultEdit({ ...snapshot, end: 200 }, 'one', snapshot.content, 'New', 'replace'), /range/);
});

test('AI edits retain surrounding UTF-16 text and can insert without replacing the source', () => {
  const content = '# Notes\n\n🌻 Original\n\nKeep me';
  const start = content.indexOf('Original');
  const snapshot = { noteId: 'one', content, start, end: start + 'Original'.length };
  const apply = edit => content.slice(0, edit.from) + edit.text + content.slice(edit.to);
  assert.equal(apply(aiResultEdit(snapshot, 'one', content, 'Clearer', 'replace')), '# Notes\n\n🌻 Clearer\n\nKeep me');
  assert.equal(apply(aiResultEdit(snapshot, 'one', content, 'Summary', 'insert')), '# Notes\n\n🌻 Original\n\nSummary\n\nKeep me');
});
