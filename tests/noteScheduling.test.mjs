import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execFileSync('npx', ['tsc', 'src/noteScheduling.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--lib', 'ES2022,DOM', '--outDir', 'dist-test/scheduling', '--skipLibCheck'], { stdio: 'inherit' });
const path = new URL('../dist-test/scheduling/noteScheduling.js', import.meta.url);
writeFileSync(path, readFileSync(path, 'utf8').replace("from './journal'", "from './journal.js'"));
const { targetDate, canScheduleNote, scheduledDays } = await import(path.href);
const note = { id: 'a', title: 'Launch', folderId: null, properties: [{ key: 'Target_Date', type: 'date', value: '2026-11-01' }] };

test('target dates are typed and do not conflate task dates or other date fields', () => {
  assert.equal(targetDate(note), '2026-11-01');
  assert.equal(targetDate({ properties: [{ key: 'due', type: 'date', value: '2026-11-01' }] }), null);
  assert.equal(targetDate({ properties: [{ key: 'target_date', type: 'text', value: '2026-11-01' }] }), null);
  assert.equal(targetDate({ properties: [{ key: 'target_date', type: 'date', value: '2026-02-30' }] }), null);
});

test('scheduled day markers count regular notes and exclude system notes', () => {
  const notes = [note, { ...note, id: 'b' }, { ...note, id: 'old', folderId: 'archive' }, { ...note, id: 'template', title: 'Book Template' }, { ...note, id: 'day', journal: '2026-10-26' }, { ...note, id: 'imported-day', title: '2026-10-26' }];
  assert.deepEqual([...scheduledDays(notes)], [['2026-11-01', 2]]);
  assert.equal(canScheduleNote(note), true);
  assert.equal(canScheduleNote(notes[2]), false);
});
