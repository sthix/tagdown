// Ticking a task ticks every task nested under it. Unticking it puts them
// back the way they were before, when that is still known.

const TASK = /^(\s*[-*+]\s+\[)([ xX])(\].*)$/;

const indentOf = (line: string) => (line.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '    ').length;

/** Line indexes of the tasks nested under the task on line `at`. */
export function subtaskLines(lines: string[], at: number): number[] {
  const parent = indentOf(lines[at]);
  const found: number[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (indentOf(lines[i]) <= parent) break;
    if (TASK.test(lines[i])) found.push(i);
  }
  return found;
}

/** Whether each of `at`'s subtasks is done, top to bottom. */
export function subtaskStates(lines: string[], at: number): boolean[] {
  return subtaskLines(lines, at).map((i) => lines[i].match(TASK)![2] !== ' ');
}

/**
 * Carry the task on line `at`, just set to `done`, down to its subtasks (in place).
 * Ticked: all of them are ticked. Unticked: they go back to `previous`, the states
 * from before the tick, if it still fits them; otherwise they're left alone.
 */
export function cascadeTask(lines: string[], at: number, done: boolean, previous?: boolean[]) {
  const children = subtaskLines(lines, at);
  if (!done && previous?.length !== children.length) return;
  children.forEach((i, n) => {
    const state = done || previous![n];
    lines[i] = lines[i].replace(TASK, (_, open: string, __: string, close: string) => `${open}${state ? 'x' : ' '}${close}`);
  });
}

const CHECKBOX_LINE = /^(\s*(?:>\s?)*\s*[-*+]\s+\[)([ xX])(\](?:\s+.*)?)$/;
const FENCE_LINE = /^\s*(`{3,}(?=[^`]*$)|~{3,})/;

/**
 * Each line that shows a checkbox in the preview, in order, split around the
 * tick mark: `[index, before, mark, after]`. Quoted tasks count; tasks in fenced
 * code and %% comments stay text, so they don't.
 */
export function checkboxLines(lines: string[]): Array<[number, string, string, string]> {
  const found: Array<[number, string, string, string]> = [];
  let fence: string | null = null;
  let inComment = false;
  lines.forEach((line, index) => {
    const unquoted = line.replace(/^(\s*>\s?)+/, '');
    if (fence) {
      const closing = unquoted.trim();
      if (closing.length >= fence.length && closing === fence[0].repeat(closing.length)) fence = null;
      return;
    }
    const opened = unquoted.match(FENCE_LINE);
    if (opened) { fence = opened[1]; return; }
    const marks = line.split('%%').length - 1;
    if (inComment) { if (marks % 2) inComment = false; return; }
    if (marks % 2) { inComment = true; return; }
    const m = line.match(CHECKBOX_LINE);
    if (m) found.push([index, m[1], m[2], m[3]]);
  });
  return found;
}
