import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'tsc',
  'src/taskCascade.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM',
  '--outDir',
  'dist-test/cascade',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

const { cascadeTask, subtaskStates } = await import(new URL('../dist-test/cascade/taskCascade.js', import.meta.url).href);

const note = [
  'Tasks:',
  '',
  '- [ ] Reise nach Frankfurt !high',
  '  - [x] Hinreise',
  '  - [ ] Hugendubel',
  '    Note under it',
  '    - [ ] Nested deeper',
  '',
  '  - [ ] Uniqlo',
  '- [ ] Next task',
  '  - [ ] Not a subtask of the first',
];

test('ticking a task ticks everything nested under it, and only that', () => {
  const lines = [...note];
  lines[2] = '- [x] Reise nach Frankfurt !high';
  const before = subtaskStates(lines, 2);
  assert.deepEqual(before, [true, false, false, false]);
  cascadeTask(lines, 2, true, before);
  assert.deepEqual(lines.slice(3, 9), ['  - [x] Hinreise', '  - [x] Hugendubel', '    Note under it', '    - [x] Nested deeper', '', '  - [x] Uniqlo']);
  assert.equal(lines[9], '- [ ] Next task');
  assert.equal(lines[10], '  - [ ] Not a subtask of the first');
});

test('unticking restores what the subtasks were before', () => {
  const lines = [...note];
  lines[2] = '- [x] Reise nach Frankfurt !high';
  const before = subtaskStates(lines, 2);
  cascadeTask(lines, 2, true, before);
  lines[2] = '- [ ] Reise nach Frankfurt !high';
  cascadeTask(lines, 2, false, before);
  assert.deepEqual(lines, note);
});

test('unticking without a fitting memory leaves subtasks alone', () => {
  const lines = ['- [ ] Parent', '  - [x] A', '  - [x] B'];
  cascadeTask(lines, 0, false, undefined);
  assert.deepEqual(lines, ['- [ ] Parent', '  - [x] A', '  - [x] B']);
  cascadeTask(lines, 0, false, [false]);
  assert.deepEqual(lines, ['- [ ] Parent', '  - [x] A', '  - [x] B'], 'a subtask was added or removed since');
});
