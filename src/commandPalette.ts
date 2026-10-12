// ⌘K command palette: one place to jump to a note or run an app action.

export type PaletteNote = {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  folderName: string | null;
  updatedLabel: string;
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
  searchContent: (query: string) => Promise<string[]>;
  actions: () => PaletteAction[];
  openNote: (id: string) => void | Promise<void>;
  noteIcon: string;
};

type Row =
  | { kind: 'note'; note: PaletteNote }
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

  const run = async (row: Row | undefined) => {
    if (!row) return;
    close();
    if (row.kind === 'note') await source.openNote(row.note.id);
    else await row.action.run();
  };

  const render = () => {
    const noteRows = rows.filter((r): r is Extract<Row, { kind: 'note' }> => r.kind === 'note');
    const actionRows = rows.filter((r): r is Extract<Row, { kind: 'action' }> => r.kind === 'action');
    let index = -1;
    const section = (title: string, body: string) => body ? `<div class="palette-section" role="presentation"><h3>${title}</h3>${body}</div>` : '';
    const noteMarkup = noteRows.map(({ note }) => {
      index++;
      return `
        <div class="palette-row ${index === active ? 'active' : ''}" role="option" id="palette-opt-${index}" aria-selected="${index === active}" data-index="${index}">
          <span class="palette-row-icon">${source.noteIcon}</span>
          <span class="palette-row-main">
            <strong>${highlight(note.title || 'Untitled', input.value)}</strong>
            <small>${escapeHtml([note.folderName, note.preview].filter(Boolean).join(' — '))}</small>
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
      : `<div class="palette-empty"><strong>No matches for “${escapeHtml(input.value.trim())}”</strong><span>Try a shorter or different word. Archived notes aren’t searched.</span></div>`;
    input.setAttribute('aria-activedescendant', rows.length ? `palette-opt-${active}` : '');
    list.querySelector('.palette-row.active')?.scrollIntoView({ block: 'nearest' });
  };

  const update = async () => {
    const query = input.value.trim().toLowerCase();
    const actions = source.actions();
    if (!query) {
      rows = [
        ...allNotes.slice(0, 6).map((note) => ({ kind: 'note' as const, note })),
        ...actions.map((action) => ({ kind: 'action' as const, action })),
      ];
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

    // Full-text matches from the vault index arrive a beat later.
    const token = ++searchToken;
    const ids = await source.searchContent(query).catch(() => [] as string[]);
    if (token !== searchToken || !dialog) return;
    const seen = new Set(scored.map((note) => note.id));
    const extra = ids.filter((id) => !seen.has(id)).map((id) => allNotes.find((note) => note.id === id)).filter((note): note is PaletteNote => !!note);
    if (!extra.length) return;
    const noteCount = rows.filter((r) => r.kind === 'note').length;
    rows.splice(noteCount, 0, ...extra.slice(0, Math.max(0, 8 - noteCount)).map((note) => ({ kind: 'note' as const, note })));
    render();
  };

  input.addEventListener('input', () => { void update(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(rows.length - 1, active + 1); render(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (event.key === 'Enter') { event.preventDefault(); void run(rows[active]); }
  });
  list.addEventListener('mousemove', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.palette-row');
    const idx = Number(row?.dataset.index ?? -1);
    if (row && idx !== active) { active = idx; list.querySelectorAll('.palette-row').forEach((el) => el.classList.toggle('active', el === row)); }
  });
  list.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.palette-row');
    if (row) void run(rows[Number(row.dataset.index)]);
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

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
