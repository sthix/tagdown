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

const { appendBlock, captureText, dayKey, parseDayKey, shiftDay, shiftMonth, calendarHtml } = await import(new URL('../dist-test/journal/journal.js', import.meta.url).href);

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

test('calendar dates validate leap days, early years, month boundaries and daylight-saving transitions', () => {
  assert.equal(parseDayKey('2026-02-29'), null);
  assert.equal(parseDayKey('2026-02-30'), null);
  assert.equal(parseDayKey('2026-2-01'), null);
  assert.equal(dayKey(parseDayKey('0026-02-01')), '0026-02-01');
  assert.equal(shiftDay('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftDay('2026-03-29', 1), '2026-03-30');
  assert.equal(shiftDay('2026-10-25', -1), '2026-10-24');
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
});

test('calendar shows scheduled counts alongside journal page markers', () => {
  const html = calendarHtml({ year: 2026, month: 1 }, new Set(['2026-02-12']), '2026-02-12', new Map([['2026-02-12', 2], ['2026-02-15', 1]]));
  assert.equal((html.match(/data-day=/g) ?? []).length, 28);
  assert.match(html, /has-page has-scheduled[^>]*data-day="2026-02-12"/);
  assert.match(html, /2 scheduled notes/);
  assert.match(html, /1 scheduled note/);
  assert.match(html, /aria-current="date"/);
  assert.equal((calendarHtml({ year: 2024, month: 1 }, new Set(), null).match(/data-day=/g) ?? []).length, 29);
});
