// ⌘K command palette: one place to jump to a note or run an app action.

export type PaletteNote = {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  folderName: string | null;
  updatedLabel: string;
};

/** A full-text match: an excerpt of the note body with matched ranges. */
export type PaletteHit = {
  id: string;
  excerpt: string;
  highlights: Array<[number, number]>;
};

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: string;
  run: () => void | Promise<void>;
};

export type PaletteSource = {
  notes: () => Promise<PaletteNote[]>;
  searchContent: (query: string) => Promise<PaletteHit[]>;
  actions: () => PaletteAction[];
  /** `where`: the open tab, a new tab (⌘↵ / ⌘-click) or a split beside it (⌥⌘↵ / ⌥⌘-click). */
  openNote: (id: string, where: 'here' | 'tab' | 'split') => void | Promise<void>;
  noteIcon: string;
};

type Row =
  | { kind: 'note'; note: PaletteNote; hit?: PaletteHit }
  | { kind: 'action'; action: PaletteAction };

let dialog: HTMLDialogElement | null = null;

export function isPaletteOpen() {
  return !!dialog?.open;
}

export async function openCommandPalette(source: PaletteSource, initialQuery = '') {
  if (dialog?.open) {
    dialog.querySelector<HTMLInputElement>('.palette-input')?.select();
    return;
  }
  dialog?.remove();
  dialog = document.createElement('dialog');
  dialog.className = 'palette';
  dialog.setAttribute('aria-label', 'Search and commands');
  dialog.innerHTML = `
    <div class="palette-shell">
      <label class="palette-field">
        <svg class="ui-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7.2" cy="7.2" r="4.4" /><path d="M10.5 10.5l3 3" /></svg>
        <input class="palette-input" type="text" placeholder="Search notes or type a command" autocomplete="off" spellcheck="false"
               role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" />
        <kbd>esc</kbd>
      </label>
      <div class="palette-list" id="palette-list" role="listbox"></div>
      <footer class="palette-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>⌘↵</kbd> new tab</span>
        <span><kbd>⌥⌘↵</kbd> split</span>
        <span class="palette-foot-syntax"><code>tag:</code><code>title:</code><code>"phrase"</code><code>-word</code></span>
        <span class="palette-foot-brand">Tagdown</span>
      </footer>
    </div>`;
  document.body.appendChild(dialog);

  const input = dialog.querySelector<HTMLInputElement>('.palette-input')!;
  const list = dialog.querySelector<HTMLDivElement>('.palette-list')!;
  const allNotes = await source.notes();
  let rows: Row[] = [];
  let active = 0;
  let searchToken = 0;

  const close = () => {
    if (!dialog) return;
    const el = dialog;
    el.classList.add('is-closing');
    window.setTimeout(() => { if (el.open) el.close(); el.remove(); }, 110);
    dialog = null;
  };

  const run = async (row: Row | undefined, event?: { metaKey: boolean; altKey: boolean }) => {
    if (!row) return;
    close();
    const where = event?.metaKey ? (event.altKey ? 'split' : 'tab') : 'here';
    if (row.kind === 'note') await source.openNote(row.note.id, where);
    else await row.action.run();
  };

  const render = () => {
    const noteRows = rows.filter((r): r is Extract<Row, { kind: 'note' }> => r.kind === 'note');
    const actionRows = rows.filter((r): r is Extract<Row, { kind: 'action' }> => r.kind === 'action');
    let index = -1;
    const section = (title: string, body: string) => body ? `<div class="palette-section" role="presentation"><h3>${title}</h3>${body}</div>` : '';
    const noteMarkup = noteRows.map(({ note, hit }) => {
      index++;
      const detail = hit?.highlights.length
        ? markRanges(hit.excerpt, hit.highlights)
        : escapeHtml([note.folderName, note.preview].filter(Boolean).join(' — '));
      return `
        <div class="palette-row ${index === active ? 'active' : ''}" role="option" id="palette-opt-${index}" aria-selected="${index === active}" data-index="${index}">
          <span class="palette-row-icon">${source.noteIcon}</span>
          <span class="palette-row-main">
            <strong>${highlight(note.title || 'Untitled', input.value)}</strong>
            <small>${detail}</small>
          </span>
          <span class="palette-row-meta">${escapeHtml(note.updatedLabel)}</span>
        </div>`;
    }).join('');
    const actionMarkup = actionRows.map(({ action }) => {
      index++;
      return `
        <div class="palette-row ${index === active ? 'active' : ''}" role="option" id="palette-opt-${index}" aria-selected="${index === active}" data-index="${index}">
          <span class="palette-row-icon">${action.icon}</span>
          <span class="palette-row-main"><strong>${highlight(action.label, input.value)}</strong>${action.hint ? `<small>${escapeHtml(action.hint)}</small>` : ''}</span>
          ${action.shortcut ? `<span class="palette-row-meta"><kbd>${escapeHtml(action.shortcut)}</kbd></span>` : ''}
        </div>`;
    }).join('');
    list.innerHTML = rows.length
      ? section(input.value.trim() ? 'Notes' : 'Recent notes', noteMarkup) + section('Commands', actionMarkup)
      : `<div class="palette-empty"><strong>No matches for “${escapeHtml(input.value.trim())}”</strong><span>Try a shorter or different word, or filter with tag:name, title:word, "exact phrase" or -exclude. Archived notes aren’t searched.</span></div>`;
    input.setAttribute('aria-activedescendant', rows.length ? `palette-opt-${active}` : '');
    list.querySelector('.palette-row.active')?.scrollIntoView({ block: 'nearest' });
  };

  const update = async () => {
    const raw = input.value.trimStart();
    const query = raw.trim().toLowerCase();
    const actions = source.actions();
    // Filters and phrases only make sense to the full-text index.
    const advanced = /(^|\s)(-\S|(tag|title):)|"/i.test(raw);
    if (!query) {
      rows = [
        ...allNotes.slice(0, 6).map((note) => ({ kind: 'note' as const, note })),
        ...actions.map((action) => ({ kind: 'action' as const, action })),
      ];
      active = 0;
      render();
      return;
    }
    const token = ++searchToken;
    if (advanced) {
      const hits = await source.searchContent(raw).catch(() => [] as PaletteHit[]);
      if (token !== searchToken || !dialog) return;
      rows = hitRows(hits, 10);
      active = 0;
      render();
      return;
    }

    const scored = allNotes
      .map((note) => ({ note, score: score(query, note.title, [note.preview, ...note.tags, note.folderName ?? ''].join(' ')) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.note);
    const matchedActions = actions.filter((action) => score(query, action.label, action.hint ?? '') > 0);
    rows = [
      ...scored.slice(0, 8).map((note) => ({ kind: 'note' as const, note })),
      ...matchedActions.map((action) => ({ kind: 'action' as const, action })),
    ];
    active = 0;
    render();

    // Full-text matches from the vault index arrive a beat later: they add
    // body excerpts to the title matches and append notes matched by content.
    const hits = await source.searchContent(raw).catch(() => [] as PaletteHit[]);
    if (token !== searchToken || !dialog || !hits.length) return;
    const byId = new Map(hits.map((hit) => [hit.id, hit]));
    const noteRows = rows.filter((r): r is Extract<Row, { kind: 'note' }> => r.kind === 'note');
    noteRows.forEach((row) => { row.hit = byId.get(row.note.id); });
    const seen = new Set(noteRows.map((row) => row.note.id));
    const extra = hitRows(hits.filter((hit) => !seen.has(hit.id)), Math.max(0, 8 - noteRows.length));
    rows.splice(noteRows.length, 0, ...extra);
    render();
  };

  const hitRows = (hits: PaletteHit[], limit: number): Row[] => hits
    .map((hit) => ({ hit, note: allNotes.find((note) => note.id === hit.id) }))
    .filter((entry): entry is { hit: PaletteHit; note: PaletteNote } => !!entry.note)
    .slice(0, limit)
    .map(({ hit, note }) => ({ kind: 'note' as const, note, hit }));

  input.addEventListener('input', () => { void update(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(rows.length - 1, active + 1); render(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (event.key === 'Enter') { event.preventDefault(); void run(rows[active], event); }
  });
  list.addEventListener('mousemove', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.palette-row');
    const idx = Number(row?.dataset.index ?? -1);
    if (row && idx !== active) { active = idx; list.querySelectorAll('.palette-row').forEach((el) => el.classList.toggle('active', el === row)); }
  });
  list.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.palette-row');
    if (row) void run(rows[Number(row.dataset.index)], event);
  });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('mousedown', (event) => { if (event.target === dialog) close(); });

  dialog.showModal();
  input.value = initialQuery;
  input.focus();
  await update();
}

function score(query: string, primary: string, secondary: string) {
  const title = primary.toLowerCase();
  if (title.startsWith(query)) return 100;
  if (title.split(/[\s/–-]+/).some((word) => word.startsWith(query))) return 80;
  if (title.includes(query)) return 60;
  if (secondary.toLowerCase().includes(query)) return 30;
  // Loose subsequence match on the title, e.g. "dsrv" → "Design review".
  // Must begin at the start of a word so stray letters don't match.
  const start = title.split(/[\s/–-]+/).findIndex((word) => word.startsWith(query[0]));
  if (start < 0) return 0;
  let i = 0;
  for (const ch of title.split(/[\s/–-]+/).slice(start).join(' ')) if (ch === query[i]) i++;
  return i === query.length ? 10 : 0;
}

function highlight(text: string, query: string) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, at))}<mark>${escapeHtml(text.slice(at, at + q.length))}</mark>${escapeHtml(text.slice(at + q.length))}`;
}

/** Escape `text`, wrapping the given [start, end) ranges in <mark>. */
function markRanges(text: string, ranges: Array<[number, number]>) {
  let out = '';
  let at = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    out += `${escapeHtml(text.slice(at, start))}<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    at = end;
  }
  return out + escapeHtml(text.slice(at));
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
