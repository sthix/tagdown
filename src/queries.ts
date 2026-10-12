// Live query blocks: fills each `.td-query` placeholder the parser emits for
// `<query … />` with matching notes or tasks from the vault.
//
// Results are cached per query so re-rendering the preview on every keystroke
// shows them at once; `invalidateQueries()` marks them stale after the vault
// changes, and the next render refreshes them in place.

import { invoke } from '@tauri-apps/api/core';
import { renderPreview } from './tagdown/renderer';

type QueryNote = { id: string; title: string; folder: string | null; tags: string[]; updatedAt: string };
type QueryTask = { noteId: string; noteTitle: string; text: string; done: boolean; line: number };
type QueryOutput = { show: 'notes' | 'tasks'; notes: QueryNote[]; tasks: QueryTask[]; total: number };
type Result = { ok: true; output: QueryOutput } | { ok: false; error: string };

const results = new Map<string, Result>();
const fresh = new Set<string>();
const pending = new Map<string, Promise<Result>>();

export function invalidateQueries() {
  fresh.clear();
}

const keyFor = (query: string, excludeId: string | null) => `${excludeId ?? ''}\n${query}`;

function fetchQuery(query: string, excludeId: string | null): Promise<Result> {
  const key = keyFor(query, excludeId);
  let request = pending.get(key);
  if (!request) {
    request = invoke<QueryOutput>('run_query', { query, excludeId })
      .then((output): Result => ({ ok: true, output }))
      .catch((error): Result => ({ ok: false, error: String(error) }))
      .then((result) => {
        results.set(key, result);
        fresh.add(key);
        pending.delete(key);
        return result;
      });
    pending.set(key, request);
  }
  return request;
}

type FillOptions = {
  /** The note holding the queries; it is left out of their results. */
  excludeId: string | null;
  /** Exports are snapshots: no checkboxes to tick, and results are awaited. */
  interactive?: boolean;
};

/** Fill every query block under `root`. Resolves when all results are shown. */
export async function fillQueries(root: HTMLElement, options: FillOptions) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.td-query'));
  await Promise.all(blocks.map(async (block) => {
    const query = block.dataset.query ?? '';
    const key = keyFor(query, options.excludeId);
    const body = block.querySelector<HTMLElement>('.td-query-body');
    if (!body) return;
    const cached = results.get(key);
    if (cached) paint(body, cached, options);
    else body.innerHTML = '<p class="td-query-empty">Loading…</p>';
    if (cached && fresh.has(key)) return;
    const result = await fetchQuery(query, options.excludeId);
    // Skip the repaint when nothing changed, so lists don't flicker while typing.
    // (Blocks may be detached, e.g. an export being prepared; they still get results.)
    if (JSON.stringify(result) !== JSON.stringify(cached)) paint(body, result, options);
  }));
}

function paint(body: HTMLElement, result: Result, options: FillOptions) {
  if (!result.ok) {
    body.innerHTML = `<p class="td-query-error">${escapeHtml(result.error)}</p>`;
    return;
  }
  const { output } = result;
  const more = output.total > (output.show === 'notes' ? output.notes.length : output.tasks.length)
    ? `<p class="td-query-more">Showing ${output.show === 'notes' ? output.notes.length : output.tasks.length} of ${output.total}. Add <code>limit:${output.total}</code> to see all.</p>`
    : '';
  if (output.show === 'notes') {
    body.innerHTML = output.notes.length
      ? `<ul class="td-query-notes">${output.notes.map((note) => `
          <li><a class="td-query-note" href="#" data-open-note="${escapeHtml(note.id)}">${escapeHtml(note.title || 'Untitled')}</a>
          <span class="td-query-meta">${escapeHtml([note.folder, shortDate(note.updatedAt)].filter(Boolean).join(' · '))}${note.tags.length ? ` · ${note.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}` : ''}</span></li>`).join('')}</ul>${more}`
      : '<p class="td-query-empty">No notes match.</p>';
    return;
  }
  if (!output.tasks.length) {
    body.innerHTML = '<p class="td-query-empty">No matching tasks.</p>';
    return;
  }
  const groups: Array<{ id: string; title: string; tasks: QueryTask[] }> = [];
  for (const task of output.tasks) {
    const last = groups[groups.length - 1];
    if (last?.id === task.noteId) last.tasks.push(task);
    else groups.push({ id: task.noteId, title: task.noteTitle, tasks: [task] });
  }
  body.innerHTML = groups.map((group) => `
    <div class="td-query-group">
      <a class="td-query-note" href="#" data-open-note="${escapeHtml(group.id)}">${escapeHtml(group.title || 'Untitled')}</a>
      <ul class="td-query-tasks">${group.tasks.map((task) => `
        <li class="td-query-task${task.done ? ' is-done' : ''}">
          <input type="checkbox"${task.done ? ' checked' : ''}${options.interactive === false ? ' disabled' : ''}
                 data-task-note="${escapeHtml(task.noteId)}" data-task-line="${task.line}" data-task-text="${escapeHtml(task.text)}"
                 aria-label="${task.done ? 'Mark not done' : 'Mark done'}: ${escapeHtml(task.text)}">
          <span>${inline(task.text)}</span>
        </li>`).join('')}</ul>
    </div>`).join('') + more;
}

/** Tick or untick a task shown in a query block; it lives in another note. */
export async function toggleQueryTask(input: HTMLInputElement) {
  const { taskNote, taskLine, taskText } = input.dataset;
  if (!taskNote || !taskLine || taskText === undefined) return;
  await invoke('set_task_done', { id: taskNote, line: Number(taskLine), text: taskText, done: input.checked });
  invalidateQueries();
}

/** Render one line of Tagdown without its paragraph wrapper. */
function inline(text: string) {
  const holder = document.createElement('div');
  holder.innerHTML = renderPreview(text);
  const only = holder.children.length === 1 && holder.firstElementChild?.tagName === 'P' ? holder.firstElementChild : holder;
  return only.innerHTML;
}

function shortDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `today ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

type TaskListOptions = {
  openNote: (id: string) => void | Promise<void>;
  afterToggle: () => void | Promise<void>;
};

/** A dialog listing every open task in the vault, grouped by note. */
export function openTaskList(options: TaskListOptions) {
  document.querySelector('.task-list-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'task-list-dialog';
  dialog.setAttribute('aria-label', 'Open tasks');
  dialog.innerHTML = `
    <div class="task-list-shell">
      <header class="task-list-head">
        <div><h2>Open tasks</h2><span>Across all notes. Put <code>&lt;query show:tasks /&gt;</code> in a note to keep a list like this there.</span></div>
        <button type="button" class="history-close" aria-label="Close" data-close>×</button>
      </header>
      <div class="preview task-list-body"><div class="td-query" data-query="show:tasks limit:500"><div class="td-query-body"></div></div></div>
    </div>`;
  document.body.append(dialog);
  const body = dialog.querySelector<HTMLElement>('.task-list-body')!;
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const refresh = () => { invalidateQueries(); return fillQueries(body, { excludeId: null }); };
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.addEventListener('mousedown', (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => dialog.remove());
  body.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const task = target.closest<HTMLInputElement>('input[data-task-note]');
    if (task) {
      void toggleQueryTask(task).then(options.afterToggle).catch(() => { task.checked = !task.checked; }).finally(refresh);
      return;
    }
    const note = target.closest<HTMLElement>('[data-open-note]');
    if (note) {
      event.preventDefault();
      close();
      void options.openNote(note.dataset.openNote!);
    }
  });
  dialog.showModal();
  void refresh();
}
