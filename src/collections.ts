import { invoke } from '@tauri-apps/api/core';
import { uiIcon } from './icons';
import { setOption } from './queryText';
import { renderQueryOutput, type QueryOutput, type TableActions } from './queries';
import { COLLECTION_LAYOUTS, collectionFilters, collectionLayout, collectionQuery, type Collection, type CollectionLayout } from './collectionModel';
import { firstGrapheme, noteIcon } from './propertyValues';
import { renderThoughts, type ThoughtReviewOptions } from './thoughts';

type Draft = Pick<Collection, 'name' | 'icon' | 'query'>;
type DialogOptions = {
  save: (draft: Draft) => Promise<void>;
  /** Runs the rules as typed, for the live match count. */
  preview?: (query: string) => Promise<QueryOutput>;
  editing?: boolean;
};

const PREVIEW_DELAY = 300;
const isEmoji = (text: string) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text);

export function openCollectionDialog(initial: Draft, { save, preview, editing = false }: DialogOptions) {
  if (document.querySelector('.collection-dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog collection-dialog';
  dialog.setAttribute('aria-labelledby', 'collection-dialog-title');
  dialog.innerHTML = `
    <form class="confirm-shell">
      <h2 class="confirm-title" id="collection-dialog-title">${editing ? 'Edit collection' : 'New collection'}</h2>
      <p class="confirm-detail">Keep a live view of matching notes in your sidebar.</p>
      <div class="collection-fields">
        <label>Icon<span class="collection-icon-field"><input name="icon" class="capture-text" aria-label="Collection icon" maxlength="16" placeholder="◈" autocomplete="off"><button type="button" class="collection-emoji-button" data-emoji title="Choose an emoji (⌃⌘Space)" aria-label="Choose an emoji">☺︎</button></span></label>
        <label>Name<input name="name" class="capture-text" required maxlength="100" placeholder="Reading list" autocomplete="off"></label>
      </div>
      <label class="collection-field">Layout<select name="layout">${COLLECTION_LAYOUTS.map(l => `<option value="${l.value}">${l.label}</option>`).join('')}</select></label>
      <label class="collection-field">Rules<textarea name="rules" class="capture-text" rows="3" spellcheck="false" placeholder="type:Book status=reading sort:title" aria-describedby="collection-preview"></textarea></label>
      <p class="collection-preview" id="collection-preview" aria-live="polite"></p>
      <p class="collection-help">Use tags, types, properties, or search text. For example <code>type:Book status=reading</code>, <code>tag:project</code>, or <code>is:pinned</code>. Empty rules include all notes outside Archive.</p>
      <details class="collection-help"><summary>Sorting and layout options</summary><p><code>sort:title</code> or <code>sort:-due</code> changes the order. <code>columns:status,due</code> chooses properties. Boards use <code>group:status</code>; tasks support <code>date:today sort:date</code>. Use <code>limit:500</code> to show more than 50 results.</p></details>
      <p class="capture-error" role="alert" hidden></p>
      <div class="confirm-actions"><button type="button" class="confirm-button" data-cancel>Cancel</button><button type="submit" class="confirm-button is-primary">${editing ? 'Save changes' : 'Create collection'}</button></div>
    </form>`;
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const name = form.elements.namedItem('name') as HTMLInputElement;
  const icon = form.elements.namedItem('icon') as HTMLInputElement;
  const rules = form.elements.namedItem('rules') as HTMLTextAreaElement;
  const layout = form.elements.namedItem('layout') as HTMLSelectElement;
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const error = form.querySelector<HTMLElement>('[role="alert"]')!;
  const matches = form.querySelector<HTMLElement>('.collection-preview')!;
  name.value = initial.name;
  icon.value = initial.icon;
  rules.value = setOption(initial.query, 'show', null);
  layout.value = collectionLayout(initial.query);
  const draftQuery = () => collectionQuery(rules.value.trim(), layout.value as CollectionLayout);
  // One emoji (or a short symbol) per collection: the system palette types into the focused field.
  icon.addEventListener('input', () => {
    const symbol = firstGrapheme(icon.value.trim());
    if (symbol && isEmoji(symbol)) icon.value = symbol;
  });
  form.querySelector('[data-emoji]')!.addEventListener('click', () => {
    icon.focus();
    icon.select();
    void invoke('show_emoji_picker').catch(() => {});
  });
  // A live count, so rules that match nothing (or don't parse) show up before saving.
  let previewTimer = 0;
  let previewRun = 0;
  const refreshPreview = () => {
    if (!preview) return;
    window.clearTimeout(previewTimer);
    const run = ++previewRun;
    previewTimer = window.setTimeout(async () => {
      try {
        const output = await preview(draftQuery());
        if (run !== previewRun) return;
        const noun = output.show === 'tasks' ? 'task' : 'note';
        matches.textContent = output.total ? `${output.total} ${noun}${output.total === 1 ? '' : 's'} match` : `No ${noun}s match yet`;
        matches.classList.remove('is-error');
      } catch (failure) {
        if (run !== previewRun) return;
        matches.textContent = String(failure);
        matches.classList.add('is-error');
      }
    }, PREVIEW_DELAY);
  };
  rules.addEventListener('input', refreshPreview);
  layout.addEventListener('change', refreshPreview);
  rules.addEventListener('keydown', (event) => {
    // ⌘↩ saves from the rules field, where ↩ adds a line.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
  });
  const close = () => { window.clearTimeout(previewTimer); previewRun++; if (dialog.open) dialog.close(); dialog.remove(); };
  form.querySelector('[data-cancel]')!.addEventListener('click', () => { if (!button.disabled) close(); });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); if (!button.disabled) close(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const draft = { name: name.value.trim(), icon: icon.value.trim(), query: draftQuery() };
    if (!draft.name) { name.focus(); return; }
    button.disabled = true;
    error.hidden = true;
    try { await save(draft); close(); }
    catch (failure) { error.textContent = String(failure); error.hidden = false; button.disabled = false; }
  });
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
  name.select();
  refreshPreview();
}

type WorkspaceOptions = {
  actions: TableActions;
  open: (id: string, event: MouseEvent) => void;
  toggleTask: (input: HTMLInputElement) => Promise<void>;
  edit: () => void;
  close: () => void;
  refresh: () => void;
  review?: ThoughtReviewOptions;
  folderName?: (value: string) => string | null;
};

export function renderCollectionWorkspace(host: HTMLElement, collection: Collection, output: QueryOutput | null, error: string | null, options: WorkspaceOptions) {
  // Repaints follow every edit and refresh: keep the reader's place in the same collection.
  const scrollTop = host.dataset.collection === collection.id ? host.querySelector('.collection-body')?.scrollTop ?? 0 : 0;
  host.replaceChildren();
  host.dataset.collection = collection.id;
  const layout = collectionLayout(collection.query);
  host.dataset.layout = options.review ? 'review' : layout;
  const layoutIcons = { notes: 'list', table: 'table', cards: 'cards', board: 'board', tasks: 'checklist' };
  const topbar = document.createElement('div');
  topbar.className = 'editor-topbar collection-topbar';
  topbar.setAttribute('data-tauri-drag-region', '');
  topbar.innerHTML = `<button type="button" class="chrome-icon-button collection-back" data-close aria-label="Back to notes" title="Back to notes (Esc)">${uiIcon('chevronLeft', 15)}</button><div class="crumbs"><span class="crumb">${uiIcon('collection', 14)}Collections</span><span class="crumb-sep" aria-hidden="true">/</span><span class="crumb is-current"></span></div><div class="collection-tools topbar-right"><div class="mode-switch collection-layout-switch" role="group" aria-label="View layout">${COLLECTION_LAYOUTS.map(l => `<button type="button" data-layout="${l.value}" class="${l.value === layout ? 'selected' : ''}" aria-pressed="${l.value === layout}">${uiIcon(layoutIcons[l.value], 14)}<span>${l.label}</span></button>`).join('')}</div><select class="collection-layout-select" aria-label="Collection layout">${COLLECTION_LAYOUTS.map(l => `<option value="${l.value}">${l.label}</option>`).join('')}</select><button type="button" class="collection-edit-button" data-edit>${uiIcon(options.review ? 'collection' : 'sliders', 14)}<span>${options.review ? 'Save as collection' : 'Edit collection'}</span></button><span class="collection-tool-divider" aria-hidden="true"></span><button type="button" class="chrome-icon-button" data-refresh aria-label="Refresh collection" title="Refresh collection">${uiIcon('refresh', 15)}</button></div>`;
  topbar.querySelector('.crumb.is-current')!.textContent = collection.name;
  topbar.querySelector('[data-edit]')!.setAttribute('aria-label', options.review ? 'Save as collection' : 'Edit collection');
  const select = topbar.querySelector('select')!;
  select.value = layout;
  const changeLayout = (next: string) => {
    if (next !== layout) options.actions.editQuery(collection.query, setOption(collection.query, 'show', next));
  };
  select.addEventListener('change', () => changeLayout(select.value));
  topbar.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach(button => button.addEventListener('click', () => changeLayout(button.dataset.layout!)));
  if (options.review) {
    select.hidden = true;
    (topbar.querySelector('.collection-layout-switch') as HTMLElement).hidden = true;
  }
  topbar.querySelector('[data-edit]')!.addEventListener('click', options.edit);
  topbar.querySelector('[data-close]')!.addEventListener('click', options.close);
  topbar.querySelector('[data-refresh]')!.addEventListener('click', options.refresh);
  host.append(topbar);
  const header = document.createElement('header');
  header.className = 'collection-head';
  header.innerHTML = `<div class="collection-heading"><span class="collection-symbol" aria-hidden="true"></span><h1 class="doc-title"></h1></div><div class="collection-meta doc-meta"><span class="collection-result-count">${uiIcon(options.review ? 'checklist' : layoutIcons[layout], 12)}<span></span></span><div class="collection-scope"></div></div>`;
  if (collection.icon) header.querySelector('.collection-symbol')!.textContent = collection.icon;
  else header.querySelector('.collection-symbol')!.innerHTML = uiIcon('collection', 26);
  header.querySelector('h1')!.textContent = collection.name;
  const noun = output?.show === 'tasks' ? 'task' : 'note';
  header.querySelector('.collection-result-count span')!.textContent = output ? `${output.total} ${noun}${output.total === 1 ? '' : 's'}` : error ? 'Could not load this collection' : 'Loading…';
  const scope = header.querySelector('.collection-scope')!;
  const filters = collectionFilters(collection.query, options.folderName);
  if (!filters.length) {
    const label = document.createElement('span');
    label.className = 'collection-scope-all';
    label.textContent = 'All notes';
    scope.append(label);
  } else {
    for (const label of filters.slice(0, 5)) {
      const chip = document.createElement('span');
      chip.className = 'collection-scope-chip';
      chip.textContent = label;
      scope.append(chip);
    }
    if (filters.length > 5) {
      const more = document.createElement('span');
      more.className = 'collection-scope-all';
      more.textContent = `+${filters.length - 5} more`;
      more.title = filters.slice(5).join(', ');
      scope.append(more);
    }
  }
  host.append(header);
  const body = document.createElement('div');
  body.className = 'preview collection-body';
  const query = document.createElement('div');
  query.className = 'td-query';
  const results = document.createElement('div');
  results.className = 'td-query-body';
  query.append(results);
  body.append(query);
  host.append(body);
  if (error) {
    const message = document.createElement('p');
    message.className = 'td-query-error';
    message.setAttribute('role', 'alert');
    message.textContent = error;
    results.append(message);
    if (!options.review) results.append(editRulesButton(options.edit));
  } else if (output) {
    if (options.review) {
      renderThoughts(results, output.notes, options.review);
      if (output.total > output.notes.length) {
        const more = document.createElement('p');
        more.className = 'td-query-more';
        more.textContent = `Showing ${output.notes.length} of ${output.total} notes. More appear as you process these.`;
        results.append(more);
      }
    } else {
      renderQueryOutput(results, output, collection.query, options.actions);
      if (output.show === 'cards') decorateCollectionCards(results, output);
      // An empty collection says how to change that, instead of only "No notes match".
      const empty = results.querySelector('.td-query-empty');
      if (empty && !output.total) empty.after(editRulesButton(options.edit));
    }
  }
  if (scrollTop) body.scrollTop = scrollTop;
  body.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLElement>('[data-open-note]');
    if (link) { event.preventDefault(); options.open(link.dataset.openNote!, event); return; }
    const wikilink = target.closest<HTMLElement>('.td-wikilink');
    if (wikilink) { event.preventDefault(); options.actions.openLink(wikilink.dataset.target || ''); }
  });
  body.addEventListener('auxclick', (event) => {
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-open-note]');
    if (event.button === 1 && link) { event.preventDefault(); options.open(link.dataset.openNote!, event); }
  });
  body.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-task-note]');
    if (input) void options.toggleTask(input);
  });
}

function editRulesButton(edit: () => void) {
  const holder = document.createElement('p');
  holder.className = 'collection-empty-action';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'confirm-button';
  button.innerHTML = `${uiIcon('sliders', 13)}<span></span>`;
  button.querySelector('span')!.textContent = 'Edit rules';
  button.addEventListener('click', edit);
  holder.append(button);
  return holder;
}

function decorateCollectionCards(root: HTMLElement, output: QueryOutput) {
  for (const note of output.notes) {
    const card = root.querySelector<HTMLElement>(`.td-qc-card[data-open-note="${CSS.escape(note.id)}"]`);
    const body = card?.querySelector('.td-qc-body');
    if (!body) continue;
    const icon = noteIcon(note.properties);
    if (icon) {
      const symbol = document.createElement('span');
      symbol.className = 'collection-card-icon';
      symbol.textContent = icon;
      symbol.setAttribute('aria-hidden', 'true');
      body.prepend(symbol);
    }
    const metadata = document.createElement('span');
    metadata.className = 'collection-card-meta';
    const tags = document.createElement('span');
    tags.className = 'collection-card-tags';
    tags.textContent = note.tags.slice(0, 2).map(tag => `#${tag}`).join(' ');
    const date = new Date(note.updatedAt);
    const time = document.createElement('time');
    if (!Number.isNaN(date.getTime())) {
      time.dateTime = note.updatedAt;
      time.textContent = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      time.title = `Edited ${date.toLocaleString()}`;
    }
    metadata.append(tags, time);
    body.append(metadata);
  }
}
