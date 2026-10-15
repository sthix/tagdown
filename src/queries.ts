// Live query blocks: fills each `.td-query` placeholder the parser emits for
// `<query … />` with matching notes or tasks from the vault.
//
// Results are cached per query so re-rendering the preview on every keystroke
// shows them at once; `invalidateQueries()` marks them stale after the vault
// changes, and the next render refreshes them in place.

import { invoke } from '@tauri-apps/api/core';
import { renderPreview } from './tagdown/renderer';
import { defaultValue, valueText, type Property, type PropertyType, type PropertyValue } from './propertyValues';
import { propertyField } from './propertiesPanel';
import { getOption, nextSort, setOption, withColumns } from './queryText';

type QueryNote = { id: string; title: string; folder: string | null; tags: string[]; updatedAt: string; createdAt?: string; properties?: Property[] };
export type NewNote = { folderId: string | null; tags: string[]; properties: Property[] };
type QueryTask = { noteId: string; noteTitle: string; text: string; done: boolean; line: number };
type QueryOutput = { show: 'notes' | 'tasks' | 'table'; notes: QueryNote[]; tasks: QueryTask[]; total: number; columns?: string[]; newNote?: NewNote | null };
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
  /** What editing a table does; without it (or in a snapshot) tables are read-only. */
  table?: TableActions;
};

export type TableActions = {
  /** Set a property of a listed note; resolves false when that failed. */
  editProperty: (noteId: string, key: string, value: PropertyValue) => Promise<boolean>;
  /** Replace the query's text in the note (sorting, columns). */
  editQuery: (oldQuery: string, newQuery: string) => void;
  /** Add a note titled `title` that starts as `newNote` says. */
  createRow: (newNote: NewNote, title: string) => Promise<boolean>;
  openLink: (target: string) => void;
  decorate: (el: HTMLElement) => void;
  valueSuggestions: (key: string) => string[];
  /** The type the vault mostly gives `key`. */
  knownType: (key: string) => PropertyType | null;
};

// Built-in columns: the note's own fields rather than properties.
const BUILT_IN: Record<string, (note: QueryNote) => string> = {
  updated: (note) => shortDate(note.updatedAt),
  created: (note) => (note.createdAt ? shortDate(note.createdAt) : ''),
  folder: (note) => note.folder ?? '',
  tags: (note) => note.tags.map((t) => `#${t}`).join(' '),
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
    if (cached) paint(body, cached, options, query);
    else body.innerHTML = '<p class="td-query-empty">Loading…</p>';
    if (cached && fresh.has(key)) return;
    const result = await fetchQuery(query, options.excludeId);
    // Skip the repaint when nothing changed, so lists don't flicker while typing.
    // (Blocks may be detached, e.g. an export being prepared; they still get results.)
    if (JSON.stringify(result) !== JSON.stringify(cached)) paint(body, result, options, query);
  }));
}

function paint(body: HTMLElement, result: Result, options: FillOptions, query: string) {
  if (!result.ok) {
    body.innerHTML = `<p class="td-query-error">${escapeHtml(result.error)}</p>`;
    return;
  }
  const { output } = result;
  const listed = output.show === 'tasks' ? output.tasks.length : output.notes.length;
  const more = output.total > listed
    ? `<p class="td-query-more">Showing ${listed} of ${output.total}. Add <code>limit:${output.total}</code> to see all.</p>`
    : '';
  if (output.show === 'table') {
    paintTable(body, output, options.interactive === false ? undefined : options.table, query);
    body.insertAdjacentHTML('beforeend', more);
    return;
  }
  if (output.show === 'notes') {
    body.innerHTML = output.notes.length
      ? `<ul class="td-query-notes">${output.notes.map((note) => `
          <li><a class="td-query-note" href="#" data-open-note="${escapeHtml(note.id)}">${escapeHtml(note.title || 'Untitled')}</a>${propertyChips(note, output.columns ?? [])}
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

/** The values of the properties a query filters or sorts by. */
function propertyChips(note: QueryNote, columns: string[]): string {
  const chips = columns.flatMap((column) => {
    const property = note.properties?.find((p) => p.key.toLowerCase() === column.toLowerCase());
    if (!property || property.type === 'raw') return [];
    const text = property.type === 'checkbox' ? (property.value ? '✓' : '✗') : valueText(property).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target);
    if (!text) return [];
    return [`<span class="td-query-prop"><span class="td-query-prop-key">${escapeHtml(property.key)}</span>${escapeHtml(text)}</span>`];
  });
  return chips.length ? ` <span class="td-query-props">${chips.join('')}</span>` : '';
}

/** The property `column` of a note, compared without case. */
function propertyOf(note: QueryNote, column: string): Property | undefined {
  return note.properties?.find((p) => p.key.toLowerCase() === column.toLowerCase());
}

/** A value as plain text, links as their labels. */
function plainText(property: Property): string {
  if (property.type === 'checkbox') return property.value ? '✓' : '';
  return valueText(property).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target);
}

/**
 * A table of the listed notes, a column per property. With `actions`, cells
 * edit the notes' properties, headers sort and add or hide columns (by
 * rewriting the query), and a last row adds a note that matches the query.
 */
function paintTable(body: HTMLElement, output: QueryOutput, actions: TableActions | undefined, query: string) {
  const columns = output.columns ?? [];
  const sort = getOption(query, 'sort');
  const table = document.createElement('table');
  table.className = `td-query-table${actions ? ' is-editable' : ''}`;

  // The type a column's empty cells take: what its filled cells use, else what the vault uses.
  const typeOf = (column: string): Exclude<PropertyType, 'raw'> => {
    const counts = new Map<PropertyType, number>();
    for (const note of output.notes) {
      const p = propertyOf(note, column);
      if (p && p.type !== 'raw') counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    }
    const found = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? actions?.knownType(column) ?? 'text';
    return found === 'raw' ? 'text' : found;
  };

  const head = table.createTHead().insertRow();
  const header = (label: string, column: string) => {
    const th = document.createElement('th');
    th.scope = 'col';
    const sortable = column === 'title' || !(column.toLowerCase() in BUILT_IN);
    const state = sort?.toLowerCase() === column.toLowerCase() ? 'asc' : sort?.toLowerCase() === `-${column.toLowerCase()}` ? 'desc' : null;
    if (actions && sortable) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'td-qt-head';
      button.title = state === 'asc' && column !== 'title' ? 'Sort descending' : state ? 'Back to the default order' : 'Sort by this column';
      button.innerHTML = `${escapeHtml(label)}${state ? `<span class="td-qt-arrow" aria-hidden="true">${state === 'asc' ? '↑' : '↓'}</span>` : ''}`;
      button.addEventListener('click', () => {
        const next = nextSort(sort, column);
        actions.editQuery(query, setOption(query, 'sort', next));
      });
      th.append(button);
    } else {
      th.innerHTML = `<span class="td-qt-label">${escapeHtml(label)}</span>`;
    }
    if (actions && column !== 'title') {
      const hide = document.createElement('button');
      hide.type = 'button';
      hide.className = 'td-qt-hide';
      hide.textContent = '×';
      hide.title = `Hide “${column}”`;
      hide.setAttribute('aria-label', `Hide column ${column}`);
      hide.addEventListener('click', () => actions.editQuery(query, withColumns(query, columns.filter((c) => c !== column))));
      th.append(hide);
    }
    head.append(th);
  };
  header('Title', 'title');
  columns.forEach((column) => header(column, column));
  if (actions) head.append(addColumnHeader(output, columns, (next) => actions.editQuery(query, withColumns(query, next))));

  const rows = table.createTBody();
  output.notes.forEach((note, r) => {
    const tr = rows.insertRow();
    const title = tr.insertCell();
    title.className = 'td-qt-title';
    title.innerHTML = `<a class="td-query-note" href="#" data-open-note="${escapeHtml(note.id)}">${escapeHtml(note.title || 'Untitled')}</a>`;
    columns.forEach((column, c) => {
      const cell = tr.insertCell();
      const property = propertyOf(note, column);
      const builtIn = BUILT_IN[column.toLowerCase()];
      if (!property && builtIn) {
        cell.className = 'td-qt-builtin';
        cell.textContent = builtIn(note);
        return;
      }
      cell.dataset.type = property?.type ?? typeOf(column);
      if (!actions) {
        cell.textContent = property ? plainText(property) : '';
        return;
      }
      const shown: Property = property ?? { key: column, ...defaultValue(typeOf(column)) };
      cell.append(propertyField(shown, {
        save: (value) => actions.editProperty(note.id, property?.key ?? column, value),
        decorate: actions.decorate,
        openLink: actions.openLink,
        suggestions: () => actions.valueSuggestions(column),
        listId: `td-qt-values-${r}-${c}`,
        blank: !property,
        emptyLabel: '',
      }));
    });
    if (actions) tr.insertCell().className = 'td-qt-spacer';
  });

  // Wide tables scroll on their own instead of widening the note.
  const scroller = document.createElement('div');
  scroller.className = 'td-qt-scroll';
  scroller.append(table);
  body.replaceChildren(scroller);
  if (!output.notes.length) body.insertAdjacentHTML('beforeend', '<p class="td-query-empty">No notes match.</p>');
  if (actions && output.newNote) body.append(newRowButton(output.newNote, actions));
}

/** The last header: a menu adding one of the listed notes' other properties, or a built-in column. */
function addColumnHeader(output: QueryOutput, columns: string[], apply: (columns: string[]) => void): HTMLElement {
  const th = document.createElement('th');
  th.className = 'td-qt-add';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '+';
  button.title = 'Add a column';
  button.setAttribute('aria-label', 'Add a column');
  button.setAttribute('aria-haspopup', 'menu');
  th.append(button);
  button.addEventListener('click', () => {
    const open = th.querySelector('.td-qt-menu');
    if (open) { open.remove(); return; }
    const shown = new Set(columns.map((c) => c.toLowerCase()));
    const keys: string[] = [];
    for (const note of output.notes) for (const p of note.properties ?? []) {
      if (p.type !== 'raw' && !shown.has(p.key.toLowerCase()) && !keys.some((k) => k.toLowerCase() === p.key.toLowerCase())) keys.push(p.key);
    }
    const builtIns = Object.keys(BUILT_IN).filter((k) => !shown.has(k));
    const menu = document.createElement('div');
    menu.className = 'td-qt-menu';
    menu.setAttribute('role', 'menu');
    const item = (label: string, column: string, hint?: string) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'menuitem');
      option.innerHTML = `${escapeHtml(label)}${hint ? `<span>${escapeHtml(hint)}</span>` : ''}`;
      option.addEventListener('click', () => { menu.remove(); apply([...columns, column]); });
      menu.append(option);
    };
    keys.forEach((key) => item(key, key));
    builtIns.forEach((key) => item(key, key, 'note'));
    th.append(menu);
    menu.querySelector<HTMLElement>('button')?.focus();
    const close = (event: Event) => {
      if (th.contains(event.target as Node)) return;
      menu.remove();
      document.removeEventListener('mousedown', close, true);
    };
    document.addEventListener('mousedown', close, true);
    menu.addEventListener('keydown', (event) => { if (event.key === 'Escape') { menu.remove(); button.focus(); } });
  });
  return th;
}

/** “+ New note”, which asks for a title and adds a note that matches the query. */
function newRowButton(newNote: NewNote, actions: TableActions): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'td-qt-new';
  const start = () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = '<span aria-hidden="true">+</span> New note';
    const starts = [
      ...newNote.properties.map((p) => `${p.key}: ${plainText(p)}`),
      ...newNote.tags.map((t) => `#${t}`),
    ];
    if (starts.length) button.title = `Starts with ${starts.join(', ')}`;
    button.addEventListener('click', ask);
    holder.replaceChildren(button);
  };
  const ask = () => {
    const input = document.createElement('input');
    input.className = 'prop-input';
    input.placeholder = 'Title of the new note';
    input.setAttribute('aria-label', 'Title of the new note');
    let done = false;
    const finish = async (keep: boolean) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      if (keep && title && (await actions.createRow(newNote, title))) return;
      start();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); void finish(false); }
    });
    input.addEventListener('blur', () => void finish(true));
    holder.replaceChildren(input);
    input.focus();
  };
  start();
  return holder;
}
