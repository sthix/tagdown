import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/taskRepeat.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM',
  '--outDir',
  'dist-test/repeat',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { nextDate, nextTaskLine } = await import(new URL('../dist-test/repeat/taskRepeat.js', import.meta.url).href);
const { tagdown } = await import(new URL('../src/tagdown/parser.js', import.meta.url).href);

test('repeats step on like the vault’s (tasks.rs)', () => {
  assert.equal(nextDate('2026-10-16', 'weekday'), '2026-10-19', 'Friday to Monday');
  assert.equal(nextDate('2026-10-31', 'day'), '2026-11-01');
  assert.equal(nextDate('2026-12-28', 'week'), '2027-01-04');
  assert.equal(nextDate('2026-01-31', 'month'), '2026-02-28');
  assert.equal(nextDate('2028-02-29', 'year'), '2029-02-28');
});

test('a ticked repeating task makes its next one', () => {
  assert.equal(nextTaskLine('  - [x] Water [[2026-10-20|Tue]] every:week !low', '2026-10-17'), '  - [ ] Water [[2026-10-27|Tue]] every:week !low');
  assert.equal(nextTaskLine('- [x] Stretch every:Day', '2026-10-17'), '- [ ] Stretch every:Day [[2026-10-18]]');
  assert.equal(nextTaskLine('- [x] Water [[2026-10-20]]', '2026-10-17'), null, 'no repeat');
  assert.equal(nextTaskLine('- [x] everyday chores', '2026-10-17'), null);
  assert.equal(nextTaskLine('Plain text every:week', '2026-10-17'), null);
});

test('task words render as chips and the day link as a day', () => {
  const html = tagdown('- [ ] Invite list [[2020-01-02]] !high every:weekday\n- [x] Done [[2020-01-02]]\n- [ ] Ship it! now');
  assert.match(html, /<li class="td-task is-high">/);
  assert.match(html, /class="td-wikilink td-task-date is-overdue"[^>]*>Thu, Jan 2, 2020<\/a>/);
  assert.match(html, /<span class="td-task-flag is-high"[^>]*>high<\/span>/);
  assert.match(html, /<span class="td-task-repeat"[^>]*>↻ weekdays<\/span>/);
  assert.doesNotMatch(html, /!high|every:weekday/, 'the words themselves are hidden');
  assert.match(html, /class="td-wikilink td-task-date" [^>]*>Thu, Jan 2, 2020/, 'a done task is never overdue');
  assert.match(html, /Ship it! now/, 'an exclamation mark is just text');
});
