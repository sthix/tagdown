import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { initSettings, openSettings } from './settings/settings';
import { initializeTheme } from './settings/theme';
import { renderPreview } from './tagdown/renderer';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/note-list.css';
import './styles/editor.css';
import './styles/preview.css';
import './styles/settings.css';

type SortOrder = 'updatedDesc' | 'createdDesc' | 'titleAsc' | 'titleDesc' | 'wordCountDesc';
type ViewMode = 'source' | 'split' | 'preview';

type Note = {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  starred: boolean;
  folderId: string | null;
  updatedAt: string;
  wordCount: number;
};

type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  noteCount: number;
  icon?: string | null;
};

type Tag = { id: string; name: string; color: TagColorKey };

type TagColorKey = 'slate' | 'blue' | 'teal' | 'green' | 'amber' | 'rose' | 'violet';

type FolderIcon = { key: string; label: string; svg: string };

type NoteContent = { id: string; content: string };

const app = document.querySelector<HTMLDivElement>('#app')!;

const FOLDER_ICONS: FolderIcon[] = [
  { key: 'folder', label: 'Folder', svg: '<path d="M2.5 4.8c0-.8.6-1.4 1.4-1.4h2.2c.3 0 .6.1.8.3l1 1c.2.2.5.3.8.3h3.4c.8 0 1.4.6 1.4 1.4v5.2c0 .8-.6 1.4-1.4 1.4H3.9c-.8 0-1.4-.6-1.4-1.4V4.8z" />' },
  { key: 'inbox', label: 'Inbox', svg: '<path d="M2.8 4.8h10.4v6.9c0 .7-.5 1.2-1.2 1.2H4c-.7 0-1.2-.5-1.2-1.2V4.8z" /><path d="M5 8.4h2l.7 1.2h.6L9 8.4h2" /><path d="M3.7 2.8h8.6l.9 2H2.8l.9-2z" />' },
  { key: 'archive', label: 'Archive', svg: '<rect x="2.8" y="3" width="10.4" height="3" rx=".6" /><path d="M3.8 6v6.3c0 .4.3.7.7.7h7c.4 0 .7-.3.7-.7V6" /><path d="M6.2 8.6h3.6" />' },
  { key: 'briefcase', label: 'Work', svg: '<rect x="2.6" y="5" width="10.8" height="7.8" rx="1.2" /><path d="M6.1 5V3.9c0-.5.4-.9.9-.9h2c.5 0 .9.4.9.9V5" /><path d="M2.8 8h10.4" />' },
  { key: 'book', label: 'Reading', svg: '<path d="M3.4 3.2h4c.7 0 1.3.6 1.3 1.3v8.3c-.3-.5-.8-.8-1.5-.8H3.4V3.2z" /><path d="M8.7 4.5c0-.7.6-1.3 1.3-1.3h2.6V12H10c-.6 0-1.1.3-1.3.8" />' },
  { key: 'doc', label: 'Specs', svg: '<path d="M4.2 2.6h5.1l2.5 2.5v8.3H4.2V2.6z" /><path d="M9.3 2.8v2.5h2.4" /><path d="M6 8h4 M6 10.3h3" />' },
  { key: 'calendar', label: 'Meetings', svg: '<rect x="3" y="3.8" width="10" height="9" rx="1.1" /><path d="M5.5 2.5v2.2M10.5 2.5v2.2M3.3 6.4h9.4" />' },
  { key: 'person', label: 'Personal', svg: '<circle cx="8" cy="5.5" r="2.1" /><path d="M3.8 13c.7-2.1 2.2-3.2 4.2-3.2s3.5 1.1 4.2 3.2" />' },
];

const TAG_COLORS: Record<TagColorKey, { dot: string; soft: string; ink: string }> = {
  slate:  { dot: 'oklch(0.55 0.02 256)', soft: 'oklch(0.93 0.01 256)', ink: 'oklch(0.35 0.02 256)' },
  blue:   { dot: 'oklch(0.6 0.16 256)',  soft: 'oklch(0.94 0.04 256)', ink: 'oklch(0.4 0.15 256)' },
  teal:   { dot: 'oklch(0.62 0.11 195)', soft: 'oklch(0.94 0.03 195)', ink: 'oklch(0.4 0.11 195)' },
  green:  { dot: 'oklch(0.6 0.14 145)',  soft: 'oklch(0.94 0.04 145)', ink: 'oklch(0.4 0.13 145)' },
  amber:  { dot: 'oklch(0.7 0.13 70)',   soft: 'oklch(0.95 0.04 70)',  ink: 'oklch(0.45 0.13 70)' },
  rose:   { dot: 'oklch(0.62 0.18 18)',  soft: 'oklch(0.95 0.04 18)',  ink: 'oklch(0.45 0.16 18)' },
  violet: { dot: 'oklch(0.6 0.18 295)',  soft: 'oklch(0.94 0.04 295)', ink: 'oklch(0.42 0.17 295)' },
};
const TAG_COLOR_KEYS: TagColorKey[] = ['slate', 'blue', 'teal', 'green', 'amber', 'rose', 'violet'];

let notes: Note[] = [];
let folders: Folder[] = [];
let allNotesCount = 0;
let tags: Tag[] = [];
let selectedNote: Note | null = null;
let selectedFolder: string | null = null;
let selectedTag: string | null = null;
let expandedTags: Record<string, boolean> = {};
let content = '';
let viewMode: ViewMode = 'split';
let saveTimer: number | undefined;
let savedMessage = 'Ready';
let searchQuery = '';
let creatingFolderParent: string | null | undefined;
let expandedFolders: Record<string, boolean> = {};
let draggingFolderId: string | null = null;
let dragOverTarget: { el: HTMLElement; cls: string } | null = null;
let creatingTag = false;
let tagDraftColor: TagColorKey = 'blue';

initializeTheme();

app.innerHTML = `
  <header class="titlebar" data-tauri-drag-region>
    <div class="app-brand"><strong>Tagdown</strong><span id="document-title">Tagdown Editor</span></div>
    <label class="search-shell" aria-label="Search notes">
      <span aria-hidden="true">⌕</span>
      <input id="search" placeholder="Search notes, tags, content…" autocomplete="off" spellcheck="false" />
      <kbd>⌘K</kbd>
    </label>
    <div class="mode-switch" role="group" aria-label="View mode">
      <button data-mode="source" type="button">Source</button>
      <button data-mode="split" type="button">Split</button>
      <button data-mode="preview" type="button">Preview</button>
    </div>
    <button id="new-note" class="new-note-button" type="button" aria-label="Create new note">✎ <span>New</span></button>
    <button id="settings-button" class="chrome-icon-button" type="button" aria-label="Open settings">⚙</button>
  </header>
  <main class="shell">
    <aside class="sidebar">
      <header>
        <span class="sidebar-title">Library</span>
        <span class="sidebar-count" id="library-count">0</span>
      </header>
      <section>
        <h2 class="section-header"><span>Documents</span><button id="new-folder" class="section-add" type="button" title="New folder" aria-label="New folder">+</button></h2>
        <div id="folders"></div>
      </section>
      <section>
        <h2 class="section-header"><span>Tags <span class="section-count" id="tag-count">0</span></span><button id="new-tag" class="section-add" type="button" title="New tag" aria-label="New tag">+</button></h2>
        <div id="tags"></div>
      </section>
    </aside>
    <section class="note-list">
      <header>
        <p class="pane-eyebrow">Notes</p>
        <div class="note-list-heading">
          <span class="scope-icon" aria-hidden="true">▤</span>
          <h1 id="note-list-title">All Notes</h1>
          <span id="note-list-count">0</span>
          <button id="note-list-new" class="mini-icon-button" type="button" title="New note">+</button>
        </div>
        <div class="filter-pills" aria-label="Quick filters">
          <button class="active" type="button">All</button><button type="button">Pinned</button><button type="button">Untagged</button><button type="button">Recent</button>
        </div>
      </header>
      <div id="notes"></div>
    </section>
    <section class="editor-pane"><div id="editor-root"></div></section>
  </main>
  <footer class="status"><span id="counts"></span><span id="saved"></span></footer>
`;

const folderEl = document.querySelector<HTMLDivElement>('#folders')!;
const noteEl = document.querySelector<HTMLDivElement>('#notes')!;
const tagEl = document.querySelector<HTMLDivElement>('#tags')!;
const editorRoot = document.querySelector<HTMLDivElement>('#editor-root')!;
const countsEl = document.querySelector<HTMLSpanElement>('#counts')!;
const savedEl = document.querySelector<HTMLSpanElement>('#saved')!;
const documentTitleEl = document.querySelector<HTMLSpanElement>('#document-title')!;
const noteListTitleEl = document.querySelector<HTMLHeadingElement>('#note-list-title')!;
const noteListCountEl = document.querySelector<HTMLSpanElement>('#note-list-count')!;
const libraryCountEl = document.querySelector<HTMLSpanElement>('#library-count')!;
const scopeIconEl = document.querySelector<HTMLSpanElement>('.scope-icon')!;
const tagCountEl = document.querySelector<HTMLSpanElement>('#tag-count')!;

async function boot() {
  initSettings();
  bindChrome();
  await reloadFolders();
  await reloadTags();
  await reloadNotes();
  if (notes[0]) await openNote(notes[0]);
  await listen('note-saved', () => { savedMessage = 'Saved'; renderStatus(); });
}

function bindChrome() {
  document.querySelector('#settings-button')?.addEventListener('click', () => openSettings());
  document.querySelector('#new-note')?.addEventListener('click', createNote);
  document.querySelector('#note-list-new')?.addEventListener('click', createNote);
  document.querySelector('#new-folder')?.addEventListener('click', () => {
    const parent = selectedFolder && selectedFolder !== 'archive' ? selectedFolder : null;
    startFolderCreate(parent);
  });
  document.querySelector('#new-tag')?.addEventListener('click', () => {
    creatingTag = true;
    tagDraftColor = 'blue';
    renderTags();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      viewMode = button.dataset.mode as ViewMode;
      renderEditor();
    });
  });

  document.querySelector<HTMLInputElement>('#search')?.addEventListener('input', async (event) => {
    searchQuery = (event.target as HTMLInputElement).value;
    if (!searchQuery.trim()) return reloadNotes();
    const results = await invoke<Array<{ note: Note }>>('search', { query: searchQuery });
    notes = results.map((r) => r.note);
    renderFolders();
    renderNotes();
  });

  window.addEventListener('keydown', async (event) => {
    if (event.metaKey && event.key === ',') { event.preventDefault(); openSettings(); }
    if (event.metaKey && event.shiftKey && event.key === 'd') { event.preventDefault(); openSettings('appearance'); }
    if (event.metaKey && event.key === 's') { event.preventDefault(); await flushSave(); }
    if (event.metaKey && event.key.toLowerCase() === 'n') { event.preventDefault(); await createNote(); }
    if (event.metaKey && ['1', '2', '3'].includes(event.key)) {
      event.preventDefault();
      viewMode = event.key === '1' ? 'source' : event.key === '2' ? 'split' : 'preview';
      renderEditor();
    }
  });
}

async function createNote() {
  const note = await invoke<Note>('create_note', { folderId: selectedFolder });
  await reloadFolders();
  await reloadNotes();
  await openNote(note);
}

function startFolderCreate(parentId: string | null) {
  creatingFolderParent = parentId;
  if (parentId) expandedFolders[parentId] = true;
  renderFolders();
}

async function commitFolderCreate(name: string, parentId: string | null) {
  const trimmed = name.trim();
  if (!trimmed) { cancelFolderCreate(); return; }
  const folder = await invoke<Folder>('create_folder', { name: trimmed, parentId, icon: 'folder' });
  creatingFolderParent = undefined;
  if (parentId) expandedFolders[parentId] = true;
  selectedFolder = folder.id;
  await reloadFolders();
  await reloadNotes();
}

function cancelFolderCreate() {
  creatingFolderParent = undefined;
  renderFolders();
}

async function reloadTags() {
  tags = await invoke<Tag[]>('list_tags');
  renderTags();
}

async function commitTagCreate(name: string, color: TagColorKey) {
  const trimmed = name.trim();
  if (!trimmed) { creatingTag = false; renderTags(); return; }
  await invoke<Tag>('create_tag', { name: trimmed, color });
  creatingTag = false;
  await reloadTags();
}

async function deleteTag(id: string) {
  await invoke('delete_tag', { id });
  await reloadTags();
}

async function reloadFolders() {
  folders = await invoke<Folder[]>('list_folders');
  const allNotes = await invoke<Note[]>('list_notes', { folderId: null, sort: 'updatedDesc' satisfies SortOrder });
  allNotesCount = allNotes.filter((note) => note.folderId !== 'archive').length;
  renderFolders();
}

async function reloadNotes() {
  notes = await invoke<Note[]>('list_notes', { folderId: selectedFolder, sort: 'updatedDesc' satisfies SortOrder });
  if (selectedNote && !notes.some((note) => note.id === selectedNote!.id)) {
    selectedNote = null;
    content = '';
    documentTitleEl.textContent = 'Tagdown Editor';
    renderEditor();
  }
  renderFolders();
  renderNotes();
}

function renderFolders() {
  const archive = folders.find((folder) => folder.id === 'archive');
  const userFolders = folders.filter((folder) => folder.id !== 'archive');
  const childrenByParent = new Map<string | null, Folder[]>();
  userFolders.forEach((folder) => {
    const parentId = folder.parentId && userFolders.some((candidate) => candidate.id === folder.parentId) ? folder.parentId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(folder);
    childrenByParent.set(parentId, siblings);
  });
  childrenByParent.forEach((siblings) => siblings.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name)));

  const rowInset = (depth: number) => 12 + depth * 14;
  const createRow = (parentId: string | null, depth: number) => creatingFolderParent === parentId ? `
    <div class="folder-create-row" style="padding-left: ${rowInset(depth) + 19}px">
      <span class="folder-icon" aria-hidden="true">${iconSvg('folder', 13)}</span>
      <input id="folder-create-input" placeholder="Folder name" autocomplete="off" spellcheck="false" aria-label="Folder name" />
    </div>
  ` : '';

  const renderFolderRow = (folder: Folder, depth: number): string => {
    const children = childrenByParent.get(folder.id) ?? [];
    const isExpanded = expandedFolders[folder.id] ?? children.length > 0;
    expandedFolders[folder.id] = isExpanded;
    const selected = folder.id === selectedFolder;
    return `
      <div class="folder-tree-item">
        <button class="folder ${selected ? 'selected' : ''}" data-folder="${folder.id}" style="padding-left: ${rowInset(depth)}px" type="button" draggable="true">
          <span class="folder-disclosure ${isExpanded ? 'open' : ''} ${children.length ? '' : 'is-empty'}" data-toggle-folder="${folder.id}" aria-hidden="true">${iconSvg('chevron', 10)}</span>
          <span class="folder-icon" aria-hidden="true">${iconSvg('folder', 13)}</span>
          <span class="folder-name">${escapeHtml(folder.name)}</span>
          <span class="folder-count">${folder.noteCount ?? 0}</span>
          <span class="folder-child-add" data-new-child="${folder.id}" role="button" tabindex="-1" title="New nested folder" aria-label="New nested folder">+</span>
          <span class="folder-delete" data-delete-folder="${folder.id}" role="button" tabindex="-1" title="Delete folder" aria-label="Delete folder">×</span>
        </button>
        ${isExpanded ? (createRow(folder.id, depth + 1) + children.map((child) => renderFolderRow(child, depth + 1)).join('')) : ''}
      </div>
    `;
  };

  folderEl.innerHTML = `
    <button class="folder system-folder ${selectedFolder === null ? 'selected' : ''}" data-folder="" style="padding-left: ${rowInset(0)}px" type="button">
      <span class="folder-disclosure is-empty" aria-hidden="true"></span>
      <span class="folder-icon" aria-hidden="true">${iconSvg('notes', 13)}</span>
      <span class="folder-name">All Notes</span>
      <span class="folder-count">${allNotesCount}</span>
    </button>
    <button class="folder system-folder ${selectedFolder === 'archive' ? 'selected' : ''}" data-folder="archive" style="padding-left: ${rowInset(0)}px" type="button">
      <span class="folder-disclosure is-empty" aria-hidden="true"></span>
      <span class="folder-icon" aria-hidden="true">${iconSvg('archive', 13)}</span>
      <span class="folder-name">Archive</span>
      <span class="folder-count">${archive?.noteCount ?? 0}</span>
    </button>
    ${createRow(null, 0)}
    ${(childrenByParent.get(null) ?? []).map((folder) => renderFolderRow(folder, 0)).join('')}
  `;

  folderEl.querySelectorAll<HTMLButtonElement>('.folder').forEach((button) => {
    button.addEventListener('click', async () => {
      selectedFolder = button.dataset.folder || null;
      selectedTag = null;
      await reloadNotes();
    });
  });
  folderEl.querySelectorAll<HTMLElement>('[data-toggle-folder]').forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = toggle.dataset.toggleFolder!;
      expandedFolders[id] = !expandedFolders[id];
      renderFolders();
    });
  });
  folderEl.querySelectorAll<HTMLElement>('[data-new-child]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      startFolderCreate(button.dataset.newChild!);
    });
  });
  folderEl.querySelectorAll<HTMLElement>('[data-delete-folder]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const deletedId = button.dataset.deleteFolder!;
      const folder = folders.find((f) => f.id === deletedId);
      const childCount = folders.filter((f) => f.parentId === deletedId).length;
      const noteCount = folder?.noteCount ?? 0;
      const parts: string[] = [];
      if (noteCount > 0) parts.push(`${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`);
      if (childCount > 0) parts.push(`${childCount} ${childCount === 1 ? 'subfolder' : 'subfolders'}`);
      const detail = parts.length
        ? `This folder contains ${parts.join(' and ')}. They will be permanently deleted.`
        : 'This folder is empty.';
      const ok = await confirmDialog({
        title: 'Delete folder',
        message: `Delete "${folder?.name ?? 'this folder'}"?`,
        detail,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      await invoke('delete_folder', { id: deletedId });
      if (selectedFolder === deletedId || isDescendantFolder(selectedFolder, deletedId)) selectedFolder = null;
      await reloadFolders();
      await reloadNotes();
    });
  });
  folderEl.querySelectorAll<HTMLButtonElement>('.folder').forEach((button) => bindFolderDragHandlers(button));
  const createInput = document.querySelector<HTMLInputElement>('#folder-create-input');
  if (createInput) {
    requestAnimationFrame(() => createInput.focus());
    let committed = false;
    createInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        committed = true;
        await commitFolderCreate(createInput.value, creatingFolderParent ?? null);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        committed = true;
        cancelFolderCreate();
      }
    });
    createInput.addEventListener('blur', async () => {
      if (committed) return;
      committed = true;
      if (creatingFolderParent === undefined) return;
      await commitFolderCreate(createInput.value, creatingFolderParent ?? null);
    });
  }
  const currentFolder = selectedFolder ? folders.find((folder) => folder.id === selectedFolder) : null;
  noteListTitleEl.textContent = currentFolder?.name ?? 'All Notes';
  scopeIconEl.innerHTML = currentFolder ? folderIconSvg(currentFolder.icon) : iconSvg(selectedFolder === 'archive' ? 'archive' : 'notes');
  libraryCountEl.textContent = String(notes.length);
}

function iconSvg(key: string | null | undefined, size = 16) {
  const icon = FOLDER_ICONS.find((candidate) => candidate.key === key);
  const body = key === 'notes'
    ? '<rect x="4" y="2.7" width="8" height="10.6" rx="1.1" /><path d="M6 5.3h4 M6 7.8h4 M6 10.3h2.7" />'
    : key === 'chevron'
      ? '<path d="M5.4 3.8L9.1 8l-3.7 4.2" />'
      : icon?.svg ?? FOLDER_ICONS[0].svg;
  return `<svg class="folder-svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function folderIconSvg(icon: string | null | undefined) {
  return iconSvg(icon || 'folder');
}

function isDescendantFolder(folderId: string | null, ancestorId: string) {
  let current = folders.find((folder) => folder.id === folderId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = folders.find((folder) => folder.id === current?.parentId);
  }
  return false;
}

function clearDragOver() {
  if (dragOverTarget) {
    dragOverTarget.el.classList.remove(dragOverTarget.cls);
    dragOverTarget = null;
  }
}

function effectiveParentId(folder: Folder): string | null {
  return folder.parentId && folders.some((f) => f.id === folder.parentId && f.id !== 'archive') ? folder.parentId : null;
}

function bindFolderDragHandlers(button: HTMLButtonElement) {
  const id = button.dataset.folder ?? '';
  const isArchive = id === 'archive';
  const isAllNotes = id === '';
  const isUserFolder = !isArchive && !isAllNotes;

  if (isUserFolder) {
    button.addEventListener('dragstart', (event) => {
      event.stopPropagation();
      draggingFolderId = id;
      button.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
      }
    });
    button.addEventListener('dragend', () => {
      button.classList.remove('dragging');
      draggingFolderId = null;
      clearDragOver();
    });
  }

  if (isArchive) return;

  button.addEventListener('dragover', (event) => {
    if (!draggingFolderId || draggingFolderId === id) return;
    if (isUserFolder && isDescendantFolder(id, draggingFolderId)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    let zone: 'into' | 'above' | 'below';
    if (isAllNotes) {
      zone = 'into';
    } else {
      const rect = button.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      if (offsetY < rect.height * 0.25) zone = 'above';
      else if (offsetY > rect.height * 0.75) zone = 'below';
      else zone = 'into';
    }

    const cls = `drop-${zone}`;
    if (dragOverTarget?.el !== button || dragOverTarget?.cls !== cls) {
      clearDragOver();
      button.classList.add(cls);
      dragOverTarget = { el: button, cls };
    }
  });

  button.addEventListener('dragleave', (event) => {
    const related = event.relatedTarget as Node | null;
    if (related && button.contains(related)) return;
    if (dragOverTarget?.el === button) clearDragOver();
  });

  button.addEventListener('drop', async (event) => {
    if (!draggingFolderId || draggingFolderId === id) return;
    event.preventDefault();
    event.stopPropagation();

    const draggedId = draggingFolderId;
    const zone = dragOverTarget?.cls.replace('drop-', '') as 'into' | 'above' | 'below' | undefined;
    clearDragOver();
    draggingFolderId = null;
    button.classList.remove('dragging');

    let parentId: string | null;
    let position: number | undefined;

    if (isAllNotes) {
      parentId = null;
      position = undefined;
    } else if (zone === 'into') {
      parentId = id;
      position = undefined;
    } else {
      const target = folders.find((f) => f.id === id);
      if (!target) return;
      parentId = effectiveParentId(target);
      const siblings = folders
        .filter((f) => f.id !== draggedId && f.id !== 'archive' && effectiveParentId(f) === parentId)
        .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
      const idx = siblings.findIndex((f) => f.id === id);
      if (idx < 0) return;
      position = zone === 'below' ? idx + 1 : idx;
    }

    await invoke('move_folder', { id: draggedId, parentId, position });
    if (parentId) expandedFolders[parentId] = true;
    await reloadFolders();
    await reloadNotes();
  });
}

function renderNotes() {
  noteListCountEl.textContent = `${notes.length}`;
  if (!notes.length) {
    noteEl.innerHTML = '<div class="empty"><div class="empty-icon">▥</div><strong>No notes here</strong><span>Nothing matches this filter yet.</span></div>';
    renderTags();
    return;
  }
  noteEl.innerHTML = notes.map((note) => {
    const date = formatDate(note.updatedAt);
    const tagMarkup = note.tags.slice(0, 3).map((tag) => `<span><i></i>${escapeHtml(tag)}</span>`).join('');
    return `
      <article class="note-card ${selectedNote?.id === note.id ? 'selected' : ''}" data-note="${note.id}" tabindex="0">
        <div class="note-card-topline"><time>${date}</time>${note.starred ? '<span class="starred" aria-label="Pinned">⌖</span>' : ''}</div>
        <h3>${escapeHtml(note.title || 'Untitled')}</h3>
        <p>${escapeHtml(note.preview || 'No additional text')}</p>
        <small>${tagMarkup || '<span>untagged</span>'}<em>${note.wordCount || 0} w</em></small>
        <button class="note-delete" data-delete-note="${note.id}" type="button" title="Delete note" aria-label="Delete note">×</button>
      </article>
    `;
  }).join('');
  noteEl.querySelectorAll<HTMLElement>('.note-card').forEach((card) => {
    const choose = async () => {
      const note = notes.find((candidate) => candidate.id === card.dataset.note);
      if (note) await openNote(note);
    };
    card.addEventListener('click', choose);
    card.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); await choose(); }
    });
  });
  noteEl.querySelectorAll<HTMLButtonElement>('.note-delete').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = button.dataset.deleteNote;
      if (!id) return;
      const note = notes.find((candidate) => candidate.id === id);
      const archived = note?.folderId === 'archive';
      const ok = await confirmDialog({
        title: archived ? 'Delete note' : 'Move to Archive',
        message: `${archived ? 'Delete' : 'Archive'} "${note?.title || 'Untitled'}"?`,
        detail: archived
          ? 'This note will be permanently deleted. This cannot be undone.'
          : 'This note will be moved to the Archive.',
        confirmLabel: archived ? 'Delete' : 'Archive',
        danger: archived,
      });
      if (!ok) return;
      await invoke(archived ? 'destroy_note' : 'delete_note', { id });
      await reloadFolders();
      await reloadNotes();
      renderTags();
    });
  });
  renderTags();
}

type TagNode = { path: string; name: string; children: TagNode[]; hasRecord: boolean };

function noteTagPaths(): string[] {
  const set = new Set<string>();
  for (const note of notes) {
    if (note.folderId === 'archive') continue;
    for (const t of note.tags) set.add(t);
  }
  return [...set];
}

function buildTagTree(): TagNode[] {
  const recordNames = new Set(tags.map((t) => t.name));
  const paths = new Set<string>([...noteTagPaths(), ...recordNames]);
  for (const p of [...paths]) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  }
  const nodes = new Map<string, TagNode>();
  for (const p of paths) {
    const name = p.split('/').pop()!;
    nodes.set(p, { path: p, name, children: [], hasRecord: recordNames.has(p) });
  }
  const roots: TagNode[] = [];
  for (const node of nodes.values()) {
    const idx = node.path.lastIndexOf('/');
    if (idx < 0) roots.push(node);
    else nodes.get(node.path.slice(0, idx))!.children.push(node);
  }
  const sortRec = (list: TagNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function tagCount(path: string): number {
  return notes.filter(
    (note) =>
      note.folderId !== 'archive' &&
      note.tags.some((t) => t === path || t.startsWith(`${path}/`)),
  ).length;
}

function colorForTag(path: string) {
  const record = tags.find((t) => t.name === path);
  if (record) return TAG_COLORS[record.color] ?? TAG_COLORS.slate;
  // Stable pseudo-random color derived from the tag path.
  let hash = 0;
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) | 0;
  const key = TAG_COLOR_KEYS[Math.abs(hash) % TAG_COLOR_KEYS.length];
  return TAG_COLORS[key];
}

async function selectTag(path: string) {
  selectedTag = path;
  selectedFolder = null;
  const all = await invoke<Note[]>('list_notes', { folderId: null, sort: 'updatedDesc' satisfies SortOrder });
  notes = all.filter(
    (note) =>
      note.folderId !== 'archive' &&
      note.tags.some((t) => t === path || t.startsWith(`${path}/`)),
  );
  if (selectedNote && !notes.some((n) => n.id === selectedNote!.id)) {
    selectedNote = null;
    content = '';
    documentTitleEl.textContent = 'Tagdown Editor';
    renderEditor();
  }
  renderFolders();
  renderNotes();
  noteListTitleEl.textContent = `#${path}`;
  scopeIconEl.textContent = '#';
}

function renderTags() {
  const roots = buildTagTree();
  let totalNodes = 0;
  const countNodes = (list: TagNode[]) => { list.forEach((node) => { totalNodes++; countNodes(node.children); }); };
  countNodes(roots);
  tagCountEl.textContent = String(totalNodes);

  const swatchRow = TAG_COLOR_KEYS.map((key) => {
    const c = TAG_COLORS[key];
    const selected = key === tagDraftColor;
    return `<button type="button" class="tag-swatch ${selected ? 'selected' : ''}" data-tag-color="${key}" title="${key}" aria-label="${key}" style="--swatch:${c.dot}"></button>`;
  }).join('');

  const createCard = creatingTag ? `
    <div class="tag-create-card">
      <div class="tag-create-row">
        <span class="tag-dot" id="tag-create-dot" style="background:${TAG_COLORS[tagDraftColor].dot}"></span>
        <input id="tag-create-input" placeholder="Tag name" autocomplete="off" spellcheck="false" aria-label="Tag name" />
      </div>
      <div class="tag-swatch-row">
        ${swatchRow}
        <span class="tag-create-hint">↵ to save · esc to cancel</span>
      </div>
    </div>
  ` : '';

  const rowInset = (depth: number) => 8 + depth * 14;
  const renderTagRow = (node: TagNode, depth: number): string => {
    const count = tagCount(node.path);
    const isExpanded = expandedTags[node.path] ?? node.children.length > 0;
    expandedTags[node.path] = isExpanded;
    const selected = node.path === selectedTag;
    const c = colorForTag(node.path);
    const deletable = node.hasRecord && count === 0;
    return `
      <div class="tag-tree-item">
        <div class="tag-row ${selected ? 'selected' : ''}" data-tag-path="${escapeHtml(node.path)}" style="padding-left: ${rowInset(depth)}px">
          <span class="tag-disclosure ${isExpanded ? 'open' : ''} ${node.children.length ? '' : 'is-empty'}" data-toggle-tag="${escapeHtml(node.path)}" aria-hidden="true">${iconSvg('chevron', 10)}</span>
          <span class="tag-dot" style="background:${c.dot}"></span>
          <span class="tag-name">${escapeHtml(node.name)}</span>
          <span class="tag-count">${count}</span>
          ${deletable ? `<button class="tag-delete" data-delete-tag-name="${escapeHtml(node.path)}" type="button" title="Delete tag" aria-label="Delete tag">×</button>` : ''}
        </div>
        ${isExpanded ? node.children.map((child) => renderTagRow(child, depth + 1)).join('') : ''}
      </div>
    `;
  };

  const rows = roots.map((node) => renderTagRow(node, 0)).join('');

  const empty = !creatingTag && totalNodes === 0
    ? '<div class="tag-empty">Type <kbd>#tag</kbd> in a note, or press <kbd>+</kbd>.</div>'
    : '';

  tagEl.innerHTML = createCard + rows + empty;

  tagEl.querySelectorAll<HTMLElement>('.tag-row').forEach((row) => {
    row.addEventListener('click', () => selectTag(row.dataset.tagPath!));
  });
  tagEl.querySelectorAll<HTMLElement>('[data-toggle-tag]').forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const path = toggle.dataset.toggleTag!;
      expandedTags[path] = !expandedTags[path];
      renderTags();
    });
  });
  tagEl.querySelectorAll<HTMLButtonElement>('[data-delete-tag-name]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const path = button.dataset.deleteTagName!;
      const record = tags.find((t) => t.name === path);
      if (record) await deleteTag(record.id);
    });
  });
  tagEl.querySelectorAll<HTMLButtonElement>('[data-tag-color]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      tagDraftColor = button.dataset.tagColor as TagColorKey;
      const dot = document.querySelector<HTMLSpanElement>('#tag-create-dot');
      if (dot) dot.style.background = TAG_COLORS[tagDraftColor].dot;
      tagEl.querySelectorAll<HTMLElement>('[data-tag-color]').forEach((b) => {
        b.classList.toggle('selected', b.dataset.tagColor === tagDraftColor);
      });
    });
  });
  const input = document.querySelector<HTMLInputElement>('#tag-create-input');
  if (input) {
    requestAnimationFrame(() => input.focus());
    let committed = false;
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        committed = true;
        await commitTagCreate(input.value, tagDraftColor);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        committed = true;
        creatingTag = false;
        renderTags();
      }
    });
    input.addEventListener('blur', async () => {
      if (committed) return;
      committed = true;
      await commitTagCreate(input.value, tagDraftColor);
    });
  }
}

async function openNote(note: Note) {
  selectedNote = note;
  const noteContent = await invoke<NoteContent>('get_note_content', { id: note.id });
  content = noteContent.content;
  documentTitleEl.textContent = note.title || 'Untitled';
  renderNotes();
  renderEditor();
}

function renderEditor() {
  const title = selectedNote?.title || 'Untitled';
  const preview = `<div class="preview td-note-root">${renderPreview(content)}</div>`;
  const textarea = `<textarea id="source" spellcheck="true" aria-label="Tagdown source">${escapeHtml(content)}</textarea>`;
  editorRoot.className = `editor-root mode-${viewMode}`;
  editorRoot.innerHTML = selectedNote ? `
    <header class="editor-header">
      <div class="editor-title-block">
        <input id="title-input" value="${escapeHtml(title)}" aria-label="Note title" readonly />
        <div class="editor-meta"><span>${wordCount(content)} words</span><span>·</span><span>${stripText(content).length} chars</span><span>·</span><span>${formatDate(selectedNote.updatedAt)}</span>${selectedNote.starred ? '<span>·</span><span class="pinned-label">⌖ Pinned</span>' : ''}</div>
      </div>
      <button id="pin-note" class="mini-icon-button ${selectedNote.starred ? 'active' : ''}" type="button" title="Pin note">⌖</button>
    </header>
    <div class="format-toolbar" aria-label="Formatting toolbar">
      <button data-insert="# " data-line="true" title="Heading">H</button>
      <button data-wrap="**|**" title="Bold">B</button>
      <button data-wrap="*|*" title="Italic"><i>I</i></button>
      <button data-wrap="\`|\`" title="Code">&lt;/&gt;</button>
      <button data-insert="- " data-line="true" title="List">• List</button>
      <span></span>
      <button data-insert="key :: value" title="Tagdown pair">::</button>
      <button data-insert="\n::: info\nYour message here\n:::\n" title="Callout">Callout</button>
      <button data-insert="\n| Header | Header |\n| ------ | ------ |\n| Cell | Cell |\n" title="Table">Table</button>
      <button data-wrap="&lt;kbd&gt;|&lt;/kbd&gt;" title="Keyboard key">kbd</button>
    </div>
    <div class="editor-body">${viewMode === 'source' ? textarea : viewMode === 'preview' ? preview : `<div class="split">${textarea}${preview}</div>`}</div>
  ` : '<div class="empty-editor"><div>✎</div><strong>No note selected</strong><span>Pick a note from the list, or press ⌘N to start a new one.</span></div>';

  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    const selected = button.dataset.mode === viewMode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  document.querySelector('#pin-note')?.addEventListener('click', async () => {
    if (!selectedNote) return;
    selectedNote = await invoke<Note>('star_note', { id: selectedNote.id, starred: !selectedNote.starred });
    await reloadNotes();
    renderEditor();
  });

  editorRoot.querySelectorAll<HTMLButtonElement>('[data-insert], [data-wrap]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.wrap) {
        const [left, right] = button.dataset.wrap.split('|');
        wrapSelection(left, right);
      } else {
        insertText(button.dataset.insert || '', button.dataset.line === 'true');
      }
    });
  });

  editorRoot.querySelector<HTMLDivElement>('.preview')?.addEventListener('click', (event) => {
    const pill = (event.target as HTMLElement).closest<HTMLElement>('.td-tag');
    if (pill?.dataset.tag) selectTag(pill.dataset.tag);
  });

  const source = document.querySelector<HTMLTextAreaElement>('#source');
  source?.addEventListener('input', () => {
    content = source.value;
    savedMessage = 'Saving…';
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushSave, 500);
    const livePreview = editorRoot.querySelector<HTMLDivElement>('.preview');
    if (livePreview) livePreview.innerHTML = renderPreview(content);
    renderStatus();
  });
  renderStatus();
}

function insertText(text: string, atLineStart = false) {
  const source = document.querySelector<HTMLTextAreaElement>('#source');
  if (!source) return;
  let start = source.selectionStart;
  const end = source.selectionEnd;
  if (atLineStart) while (start > 0 && content[start - 1] !== '\n') start--;
  content = content.slice(0, start) + text + content.slice(end);
  savedMessage = 'Saving…';
  renderEditor();
  const next = document.querySelector<HTMLTextAreaElement>('#source');
  next?.focus();
  if (next) next.selectionStart = next.selectionEnd = start + text.length;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 500);
}

function wrapSelection(left: string, right: string) {
  const source = document.querySelector<HTMLTextAreaElement>('#source');
  if (!source) return;
  const start = source.selectionStart;
  const end = source.selectionEnd;
  const selected = content.slice(start, end);
  content = content.slice(0, start) + left + selected + right + content.slice(end);
  savedMessage = 'Saving…';
  renderEditor();
  const next = document.querySelector<HTMLTextAreaElement>('#source');
  next?.focus();
  if (next) { next.selectionStart = start + left.length; next.selectionEnd = start + left.length + selected.length; }
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 500);
}

async function flushSave() {
  if (!selectedNote) return;
  selectedNote = await invoke<Note>('save_note', { id: selectedNote.id, content });
  await reloadNotes();
  savedMessage = 'Saved';
  documentTitleEl.textContent = selectedNote.title || 'Untitled';
  renderStatus();
}

function renderStatus() {
  countsEl.textContent = selectedNote ? `${wordCount(content)} words · ${content.length} characters` : 'No note';
  savedEl.textContent = `${savedMessage} · ${viewMode}`;
}

function wordCount(value: string) {
  const stripped = stripText(value);
  return stripped ? stripped.split(/\s+/).length : 0;
}

function stripText(value: string) {
  return value.replace(/`+([^`]+)`+/g, '$1').replace(/<[^>]+>/g, '').replace(/:::\s*\w*/g, '').replace(/[|#*_>\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function confirmDialog(opts: { title: string; message: string; detail?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  document.querySelector('.confirm-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';
  dialog.innerHTML = `
    <div class="confirm-shell">
      <h2 class="confirm-title">${escapeHtml(opts.title)}</h2>
      <p class="confirm-message">${escapeHtml(opts.message)}</p>
      ${opts.detail ? `<p class="confirm-detail">${escapeHtml(opts.detail)}</p>` : ''}
      <div class="confirm-actions">
        <button type="button" class="confirm-button" data-confirm-cancel>${escapeHtml(opts.cancelLabel ?? 'Cancel')}</button>
        <button type="button" class="confirm-button ${opts.danger ? 'is-danger' : 'is-primary'}" data-confirm-ok>${escapeHtml(opts.confirmLabel ?? 'Confirm')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    dialog.querySelector<HTMLButtonElement>('[data-confirm-cancel]')!.addEventListener('click', () => finish(false));
    dialog.querySelector<HTMLButtonElement>('[data-confirm-ok]')!.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => finish(false));
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-confirm-ok]')!.focus();
  });
}

boot().catch((error) => {
  console.error(error);
  app.innerHTML = `<pre class="fatal">${escapeHtml(String(error))}</pre>`;
});
