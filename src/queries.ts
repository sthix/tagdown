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
import { boardLanes, laneKey, movedValue, propertyOf, type Lane } from './boardLanes';
import { resolveLocalImages } from './localImages';

type QueryNote = { id: string; title: string; folder: string | null; tags: string[]; updatedAt: string; createdAt?: string; properties?: Property[]; excerpt?: string; cover?: string };
export type NewNote = { folderId: string | null; tags: string[]; properties: Property[] };
type QueryTask = {
  noteId: string; noteTitle: string; text: string; done: boolean; line: number;
  /** Its day (YYYY-MM-DD), priority (1 high to 3 low) and repeat, and its text without those words. */
  date?: string | null; priority?: number | null; repeat?: string | null; label?: string;
};
type QueryOutput = {
  show: 'notes' | 'tasks' | 'table' | 'board' | 'cards';
  notes: QueryNote[];
  tasks: QueryTask[];
  total: number;
  columns?: string[];
  newNote?: NewNote | null;
  /** A board's group property, and the lanes its query names. */
  group?: string;
  lanes?: string[];
};
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
  /** Set (or with null, remove) a property of a listed note; resolves false when that failed. */
  editProperty: (noteId: string, key: string, value: PropertyValue | null) => Promise<boolean>;
  /** Replace the query's text in the note (sorting, columns). */
  editQuery: (oldQuery: string, newQuery: string) => void;
  /** Add a note titled `title` that starts as `newNote` says. */
  createRow: (newNote: NewNote, title: string) => Promise<boolean>;
  openLink: (target: string) => void;
  decorate: (el: HTMLElement) => void;
  valueSuggestions: (key: string) => string[];
  /** What an empty `key` means (“A Person”), if anything. */
  valueHint?: (key: string) => string | null;
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
  const actions = options.interactive === false ? undefined : options.table;
  if (output.show === 'table' || output.show === 'board' || output.show === 'cards') {
    if (output.show === 'table') paintTable(body, output, actions, query);
    else if (output.show === 'board') paintBoard(body, output, actions, query);
    else paintCards(body, output, actions);
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
  // Sorted by day, tasks are grouped by day and say which note they're in; otherwise by note.
  const byDay = getOption(query, 'sort')?.toLowerCase() === 'date';
  const groups: Array<{ id: string; title: string; tasks: QueryTask[] }> = [];
  for (const task of output.tasks) {
    const id = byDay ? dayGroup(task) : task.noteId;
    const last = groups[groups.length - 1];
    if (last?.id === id) last.tasks.push(task);
    else groups.push({ id, title: byDay ? dayGroupTitle(id) : task.noteTitle, tasks: [task] });
  }
  const item = (task: QueryTask) => `
        <li class="td-query-task${task.done ? ' is-done' : ''}${task.priority ? ` is-${PRIORITIES[task.priority]}` : ''}">
          <input type="checkbox"${task.done ? ' checked' : ''}${options.interactive === false ? ' disabled' : ''}
                 data-task-note="${escapeHtml(task.noteId)}" data-task-line="${task.line}" data-task-text="${escapeHtml(task.text)}"
                 aria-label="${task.done ? 'Mark not done' : 'Mark done'}: ${escapeHtml(task.text)}">
          <span>${inline(taskText(task))}${taskChips(task, !byDay)}${byDay ? ` <a class="td-query-task-note" href="#" data-open-note="${escapeHtml(task.noteId)}">${escapeHtml(task.noteTitle || 'Untitled')}</a>` : ''}</span>
        </li>`;
  body.innerHTML = groups.map((group) => `
    <div class="td-query-group${byDay ? ` is-day${group.id === 'overdue' ? ' is-overdue' : ''}` : ''}">
      ${byDay ? `<h4 class="td-query-day">${escapeHtml(group.title)}</h4>` : `<a class="td-query-note" href="#" data-open-note="${escapeHtml(group.id)}">${escapeHtml(group.title || 'Untitled')}</a>`}
      <ul class="td-query-tasks">${group.tasks.map(item).join('')}</ul>
    </div>`).join('') + more;
}

const PRIORITIES: Record<number, string> = { 1: 'high', 2: 'medium', 3: 'low' };
const DATE_LINK = /\s*\[\[\d{4}-\d{2}-\d{2}(?:\|[^\]]*)?\]\]/;

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftedToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDay(date);
}

/** A day in words: Today, Tomorrow, Yesterday, or "Tue, Oct 20". */
function dayName(day: string) {
  if (day === shiftedToday(0)) return 'Today';
  if (day === shiftedToday(1)) return 'Tomorrow';
  if (day === shiftedToday(-1)) return 'Yesterday';
  const date = new Date(`${day}T12:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: day.slice(0, 4) === shiftedToday(0).slice(0, 4) ? undefined : 'numeric' });
}

/** The day group an open task sorted by day goes in: overdue ones together. */
function dayGroup(task: QueryTask) {
  if (!task.date) return 'none';
  return !task.done && task.date < shiftedToday(0) ? 'overdue' : task.date;
}

function dayGroupTitle(group: string) {
  return group === 'overdue' ? 'Overdue' : group === 'none' ? 'No date' : dayName(group);
}

/** A task's text to show: without its priority and repeat words, and without its day, which shows as a chip. */
function taskText(task: QueryTask) {
  const label = task.label ?? task.text;
  return task.date ? label.replace(DATE_LINK, '').trim() || label : label;
}

/** A listed task's day, priority and repeat. The day is left out where the group already says it. */
function taskChips(task: QueryTask, withDay: boolean) {
  let out = '';
  if (task.date && (withDay || dayGroup(task) === 'overdue')) {
    const today = shiftedToday(0);
    const when = task.done ? '' : task.date < today ? ' is-overdue' : task.date === today ? ' is-today' : '';
    out += ` <span class="td-task-when${when}" title="${task.date}">${escapeHtml(dayName(task.date))}</span>`;
  }
  if (task.priority) out += ` <span class="td-task-flag is-${PRIORITIES[task.priority]}">${PRIORITIES[task.priority]}</span>`;
  if (task.repeat) out += ` <span class="td-task-repeat" title="Repeats every ${task.repeat}">↻ ${task.repeat === 'weekday' ? 'weekdays' : task.repeat === 'day' ? 'daily' : `${task.repeat}ly`}</span>`;
  return out;
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

// The open-tasks dialog's views; the last one chosen is kept while the app runs.
const TASK_VIEWS = [
  { label: 'Today', query: 'show:tasks date:today sort:date limit:500', hint: 'Due today, and overdue ones first.' },
  { label: 'Upcoming', query: 'show:tasks date:upcoming sort:date limit:500', hint: 'Tasks with a day after today.' },
  { label: 'Inbox', query: 'show:tasks date:none sort:priority limit:500', hint: 'Tasks without a day yet.' },
  { label: 'All', query: 'show:tasks limit:500', hint: 'Every open task, by note.' },
];
let taskView = 0;

/** A dialog listing the vault's open tasks: today's, upcoming, undated, or all. */
export function openTaskList(options: TaskListOptions) {
  document.querySelector('.task-list-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'task-list-dialog';
  dialog.setAttribute('aria-label', 'Open tasks');
  dialog.innerHTML = `
    <div class="task-list-shell">
      <header class="task-list-head">
        <div><h2>Open tasks</h2><span>Across all notes. Give a task a day with a date link like <code>[[${shiftedToday(1)}]]</code>; a query such as <code>&lt;query show:tasks date:today /&gt;</code> keeps a list like this in a note.</span></div>
        <button type="button" class="history-close" aria-label="Close" data-close>×</button>
      </header>
      <div class="task-list-views" role="tablist" aria-label="Which tasks">${TASK_VIEWS.map((view, i) => `<button type="button" role="tab" data-view="${i}" aria-selected="${i === taskView}">${view.label}</button>`).join('')}</div>
      <div class="preview task-list-body"></div>
    </div>`;
  document.body.append(dialog);
  const body = dialog.querySelector<HTMLElement>('.task-list-body')!;
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const show = () => {
    const view = TASK_VIEWS[taskView];
    body.innerHTML = `<p class="task-list-hint">${view.hint}</p><div class="td-query" data-query="${escapeHtml(view.query)}"><div class="td-query-body"></div></div>`;
    dialog.querySelectorAll<HTMLElement>('[data-view]').forEach((tab) => tab.setAttribute('aria-selected', String(Number(tab.dataset.view) === taskView)));
  };
  const refresh = () => { invalidateQueries(); return fillQueries(body, { excludeId: null }); };
  dialog.querySelector('.task-list-views')!.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-view]');
    if (!tab) return;
    taskView = Number(tab.dataset.view);
    show();
    void refresh();
  });
  show();
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

  const typeOf = (column: string) => columnType(output, column, actions);

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
        emptyLabel: actions.valueHint?.(column) ?? '',
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

/** The type a column's empty cells take: what its filled cells use, else what the vault uses. */
function columnType(output: QueryOutput, column: string, actions: TableActions | undefined): Exclude<PropertyType, 'raw'> {
  const counts = new Map<PropertyType, number>();
  for (const note of output.notes) {
    const p = propertyOf(note, column);
    if (p && p.type !== 'raw') counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  }
  const found = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? actions?.knownType(column) ?? 'text';
  return found === 'raw' ? 'text' : found;
}

const CARD_MIME = 'application/x-tagdown-board-card';

/**
 * A board: a lane per value of the group property, with the notes as cards.
 * With `actions`, cards move between lanes by dragging (which sets the
 * property), each lane adds a note with its value, and "+ Lane" adds a lane
 * (by writing `lanes:` into the query).
 */
function paintBoard(body: HTMLElement, output: QueryOutput, actions: TableActions | undefined, query: string) {
  const group = output.group ?? 'status';
  const type = columnType(output, group, actions);
  const { lanes, none } = boardLanes(output.notes, group, output.lanes ?? [], type);
  const byId = new Map(output.notes.map((note) => [note.id, note]));
  const columns = output.columns ?? [];

  const board = document.createElement('div');
  board.className = `td-qb${actions ? ' is-editable' : ''}`;
  const laneEl = (lane: Lane | null) => {
    const ids = lane ? lane.ids : none;
    const section = document.createElement('section');
    section.className = `td-qb-lane${lane ? '' : ' is-none'}`;
    section.dataset.lane = lane?.key ?? '';
    section.innerHTML = `<header class="td-qb-head"><span class="td-qb-name">${escapeHtml(lane ? lane.label : `No ${group}`)}</span><span class="td-qb-count">${ids.length}</span></header>`;
    const cards = document.createElement('div');
    cards.className = 'td-qb-cards';
    for (const id of ids) {
      const note = byId.get(id);
      if (!note) continue;
      const card = document.createElement('div');
      card.className = 'td-qb-card';
      card.innerHTML = `<a class="td-query-note" href="#" data-open-note="${escapeHtml(note.id)}">${escapeHtml(note.title || 'Untitled')}</a>${propertyChips(note, columns)}`;
      if (actions) {
        card.dataset.openNote = note.id;
        card.draggable = true;
        card.addEventListener('dragstart', (event) => {
          event.dataTransfer?.setData(CARD_MIME, JSON.stringify({ id: note.id, from: lane?.value ?? null }));
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          card.classList.add('is-dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
      }
      cards.append(card);
    }
    section.append(cards);
    if (actions) {
      section.addEventListener('dragover', (event) => {
        if (!event.dataTransfer?.types.includes(CARD_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        section.classList.add('is-over');
      });
      section.addEventListener('dragleave', (event) => {
        if (!section.contains(event.relatedTarget as Node | null)) section.classList.remove('is-over');
      });
      section.addEventListener('drop', (event) => {
        section.classList.remove('is-over');
        const raw = event.dataTransfer?.getData(CARD_MIME);
        if (!raw) return;
        event.preventDefault();
        const { id, from } = JSON.parse(raw) as { id: string; from: string | null };
        const to = lane?.value ?? null;
        const note = byId.get(id);
        if (!note || (from === null ? to === null : to !== null && laneKey(from) === laneKey(to))) return;
        const property = propertyOf(note, group);
        const value = movedValue(property, from, to, property && property.type !== 'raw' ? property.type : type);
        // Show the move now; the refresh after saving redraws the board.
        const dragged = board.querySelector<HTMLElement>(`.td-qb-card.is-dragging`);
        if (dragged) cards.append(dragged);
        void actions.editProperty(id, property?.key ?? group, value);
      });
      if (output.newNote) {
        const newNote = output.newNote;
        const others = newNote.properties.filter((p) => p.key.toLowerCase() !== group.toLowerCase());
        const value = lane ? movedValue(undefined, null, lane.value, type) : null;
        section.append(newRowButton({ ...newNote, properties: value ? [...others, { key: group, ...value }] : others }, actions, 'New'));
      }
    }
    return section;
  };
  lanes.forEach((lane) => board.append(laneEl(lane)));
  if (none.length || !lanes.length) board.append(laneEl(null));
  if (actions) board.append(addLaneButton((name) => {
    const named = [...lanes.map((l) => l.value), name];
    actions.editQuery(query, setOption(query, 'lanes', named.join(',')));
  }));

  const scroller = document.createElement('div');
  scroller.className = 'td-qb-scroll';
  scroller.append(board);
  body.replaceChildren(scroller);
}

/** "+ Lane", which asks for a value and adds a lane for it. */
function addLaneButton(add: (name: string) => void): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'td-qb-addlane';
  const start = () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = '<span aria-hidden="true">+</span> Lane';
    button.title = 'Add a lane';
    button.addEventListener('click', ask);
    holder.replaceChildren(button);
  };
  const ask = () => {
    const input = document.createElement('input');
    input.className = 'prop-input';
    input.placeholder = 'Lane name';
    input.setAttribute('aria-label', 'Lane name');
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim().replaceAll(',', ' ');
      if (keep && name) add(name);
      else start();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    holder.replaceChildren(input);
    input.focus();
  };
  start();
  return holder;
}

/** Cards: a grid of the notes, each with its cover image, opening lines and chosen properties. */
function paintCards(body: HTMLElement, output: QueryOutput, actions: TableActions | undefined) {
  const columns = output.columns ?? [];
  const grid = document.createElement('div');
  grid.className = 'td-qc';
  grid.innerHTML = output.notes.map((note) => `
    <a class="td-qc-card${note.cover ? ' has-cover' : ''}" href="#" data-open-note="${escapeHtml(note.id)}">
      ${note.cover ? `<span class="td-qc-cover"><img src="${escapeHtml(note.cover)}" alt="" loading="lazy"></span>` : ''}
      <span class="td-qc-body">
        <strong class="td-qc-title">${escapeHtml(note.title || 'Untitled')}</strong>
        ${note.excerpt ? `<span class="td-qc-excerpt">${escapeHtml(note.excerpt)}</span>` : ''}
        ${propertyChips(note, columns)}
      </span>
    </a>`).join('');
  // A cover that can't load leaves the card without one.
  grid.querySelectorAll<HTMLImageElement>('.td-qc-cover img').forEach((img) => img.addEventListener('error', () => {
    img.closest('.td-qc-card')?.classList.remove('has-cover');
    img.parentElement?.remove();
  }, { once: true }));
  resolveLocalImages(grid);
  body.replaceChildren(grid);
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
function newRowButton(newNote: NewNote, actions: TableActions, label = 'New note'): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'td-qt-new';
  const start = () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<span aria-hidden="true">+</span> ${label}`;
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
