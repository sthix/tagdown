import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { save, message } from '@tauri-apps/plugin-dialog';
import { initSettings, openSettings } from './settings/settings';
import { uiIcon } from './icons';
import { initializeTheme, getEffectiveTheme, onThemePreferenceChange, setThemePreference } from './settings/theme';
import { openCommandPalette, isPaletteOpen, type PaletteAction } from './commandPalette';
import { renderEditablePreview, renderPreview, applyExternals } from './tagdown/renderer';
import { firstMovableBlock, headingLevel, moveBlock, sectionSpan, type SourceBlock } from './tagdown/blocks';
import { applyPreferences, getPreference, onPreferenceChange, setPreference, type ViewMode } from './settings/preferences';
import { attachBlockDrag } from './blockDrag';
import { renderEditorToolbar } from './editorToolbar';
import { buildStandaloneHtml, exportFileName, printNote } from './export';
import { openVersionHistory } from './history';
import { startPresentation } from './presentation';
import { openPublishDialog } from './publish';
import { fillQueries, invalidateQueries, openTaskList, toggleQueryTask, type TableActions } from './queries';
import { attachWikilinkAutocomplete, normalizeTitle, resolveTarget, splitTarget } from './wikilinks';
import { applyCommand, attachSlashCommands, SLASH_HINT, type SlashCommand } from './slashCommands';
import { applyEdit, attachListEditing } from './listEditing';
import { blockIdOfTarget, blockIds, blockReference, ensureBlockId } from './blockRefs';
import { renderPropertiesPanel } from './propertiesPanel';
import type { Property, PropertyType, PropertyValue } from './propertyValues';
import { blockTarget, cachedBlock, fillBlockEmbeds, invalidateBlockEmbeds, lookupBlock } from './blockEmbeds';
import { figureMarkup, imageFiles, pickImages, resolveLocalImages, saveImage, setVaultRoot } from './localImages';
import { chooseVaultFolder, listVaults, onBeforeVaultSwitch, shortPath, switchVault, type VaultEntry } from './vaults';
import { calendarHtml, formatDay, isDayKey, monthOf, relativeDay, shiftDay, shiftMonth, todayKey, type CalendarMonth } from './journal';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/note-list.css';
import './styles/editor.css';
import './styles/preview.css';
import './styles/settings.css';
import './styles/palette.css';

type SortOrder = 'updatedDesc' | 'createdDesc' | 'titleAsc' | 'titleDesc' | 'wordCountDesc';
type QuickFilter = 'all' | 'pinned' | 'untagged' | 'recent';

type Note = {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  starred: boolean;
  folderId: string | null;
  updatedAt: string;
  wordCount: number;
  /** The day (YYYY-MM-DD) this note is the journal page for. */
  journal?: string | null;
  /** Custom frontmatter entries, typed. */
  properties?: Property[];
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

type Backlink = { note: Note; mentions: string[] };

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
  slate:  { dot: 'oklch(0.58 0.025 80)', soft: 'oklch(0.94 0.012 80)', ink: 'oklch(0.36 0.025 80)' },
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
// Every non-archived note, independent of the folder/tag/filter being viewed.
// Sidebar counts read from this so they don't change with the current list.
let libraryNotes: Note[] = [];
let tags: Tag[] = [];
let selectedNote: Note | null = null;
let selectedFolder: string | null = null;
let selectedTag: string | null = null;
let activeFilter: QuickFilter = 'all';
let expandedTags: Record<string, boolean> = {};
let content = '';
let viewMode: ViewMode = getPreference(getPreference('rememberViewMode') ? 'lastViewMode' : 'defaultViewMode');
let saveTimer: number | undefined;
let savedMessage = 'Ready';
let focusMode = false;
let markerAnimateUntil = 0;
let creatingFolderParent: string | null | undefined;
let expandedFolders: Record<string, boolean> = {};
let draggingFolderId: string | null = null;
let dragOverTarget: { el: HTMLElement; cls: string } | null = null;
let creatingTag = false;
let showAllTags = false;
// In-preview editing: the block currently open as raw Tagdown, and the block
// map of the last preview render.
type BlockEdit = { el: HTMLTextAreaElement; start: number; lineCount: number; originalCount: number; restoreIfEmpty: string | null };
let blockEdit: BlockEdit | null = null;
let previewBlocks: SourceBlock[] = [];
let suppressPreviewClick = false;
// Links follow a renamed note: the title other notes link to, and a pending sync.
let linkNoteId: string | null = null;
let linkTitle = '';
let linkSyncTimer: number | undefined;
// "Linked mentions" for the open note, once loaded.
let backlinks: { id: string; items: Backlink[] } | null = null;
const TAG_PREVIEW_LIMIT = 6;
let tagDraftColor: TagColorKey = 'blue';
// The month the journal calendar shows.
let journalMonth: CalendarMonth = monthOf(todayKey());

initializeTheme();
applyPreferences();

// Images in notes are stored relative to the vault.
void invoke<string>('vault_path').then((path) => {
  setVaultRoot(path);
  const preview = document.querySelector<HTMLDivElement>('#editor-root .preview');
  if (preview && !blockEdit) paintPreview(preview);
}).catch(() => {});

// Other vaults, for the palette; a switch saves what's pending first.
let vaults: VaultEntry[] = [];
void listVaults().then((list) => { vaults = list; });
onBeforeVaultSwitch(settlePendingWork);

// A file dropped outside the editor would otherwise replace the app with it.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
}

onPreferenceChange((name) => {
  if (name !== 'spellcheck') return;
  document.querySelectorAll<HTMLTextAreaElement>('#source, .td-block-editor').forEach((textarea) => {
    textarea.spellcheck = getPreference('spellcheck');
  });
});

// Re-render the live preview when the user toggles dark/light so KaTeX and
// Mermaid pick up the new theme. Other DOM is theme-agnostic via CSS variables.
onThemePreferenceChange(() => {
  const lp = document.querySelector<HTMLDivElement>('#editor-root .preview');
  if (!lp) return;
  if (blockEdit) commitBlockEdit();
  else paintPreview(lp);
});

app.innerHTML = `
  <aside class="sidebar">
    <div class="sidebar-top" data-tauri-drag-region>
      <button id="open-palette" class="chrome-icon-button" type="button" title="Search and commands (⌘K)" aria-label="Search and commands">${uiIcon('search', 16)}</button>
      <button id="theme-toggle" class="chrome-icon-button" type="button" title="Switch theme (⌘⇧D)" aria-label="Switch theme"></button>
      <button id="sidebar-collapse" class="chrome-icon-button" type="button" title="Focus mode (⌘\\)" aria-label="Toggle focus mode">${uiIcon('sidebar', 16)}</button>
    </div>
    <nav class="sidebar-scroll" aria-label="Library">
      <section>
        <h2 class="section-header"><span>Library</span><button id="new-folder" class="section-add" type="button" title="New folder" aria-label="New folder">${uiIcon('plus', 13)}</button></h2>
        <div id="folders"></div>
      </section>
      <section>
        <h2 class="section-header"><span>Tags</span><span class="section-count" id="tag-count" hidden>0</span><button id="new-tag" class="section-add" type="button" title="New tag" aria-label="New tag">${uiIcon('plus', 13)}</button></h2>
        <div id="tags"></div>
      </section>
    </nav>
    <footer class="sidebar-foot">
      <button id="new-note" class="new-note-pill" type="button" title="New note (⌘N)">${uiIcon('compose', 15)}<span>New note</span><kbd>⌘N</kbd></button>
      <button id="settings-button" class="round-icon-button" type="button" title="Settings (⌘,)" aria-label="Settings">${uiIcon('sliders', 16)}</button>
    </footer>
  </aside>
  <main class="sheet">
    <section class="note-list">
      <header data-tauri-drag-region>
        <div class="note-list-heading" data-tauri-drag-region>
          <span class="scope-icon" aria-hidden="true"></span>
          <h1 id="note-list-title">All Notes</h1>
          <span id="note-list-count">0</span>
          <button id="note-list-new" class="mini-icon-button" type="button" title="New note (⌘N)" aria-label="New note">${uiIcon('plus', 14)}</button>
        </div>
        <div class="filter-pills" role="group" aria-label="Quick filters">
          <button data-filter="all" type="button">All</button><button data-filter="pinned" type="button">Pinned</button><button data-filter="untagged" type="button">Untagged</button><button data-filter="recent" type="button">Recent</button>
        </div>
      </header>
      <div id="notes"></div>
    </section>
    <section class="editor-pane"><div id="editor-root"></div></section>
  </main>
`;

const folderEl = document.querySelector<HTMLDivElement>('#folders')!;
const noteEl = document.querySelector<HTMLDivElement>('#notes')!;
const tagEl = document.querySelector<HTMLDivElement>('#tags')!;
const editorRoot = document.querySelector<HTMLDivElement>('#editor-root')!;
const noteListTitleEl = document.querySelector<HTMLHeadingElement>('#note-list-title')!;
const noteListCountEl = document.querySelector<HTMLSpanElement>('#note-list-count')!;
const scopeIconEl = document.querySelector<HTMLSpanElement>('.scope-icon')!;
const tagCountEl = document.querySelector<HTMLSpanElement>('#tag-count')!;

async function boot() {
  initSettings();
  bindChrome();
  await reloadFolders();
  await reloadTags();
  await reloadNotes();
  renderFilterPills();
  await openStartupNote();
  await listen('note-saved', () => { savedMessage = 'Saved'; renderStatus(); });
  await listen<{ note: Note; content: string }>('note-changed-externally', (event) => void onExternalChange(event.payload.note, event.payload.content));
  await listen<{ id: string }>('note-removed-externally', (event) => onExternalRemoval(event.payload.id));
}

/** Open what Settings → General → "On launch" asks for. */
async function openStartupNote() {
  const startup = getPreference('startupOpen');
  if (startup === 'journal') {
    await openJournal(todayKey());
    return;
  }
  const lastId = startup === 'last' ? getPreference('lastNoteId') : null;
  const last = lastId ? libraryNotes.find((note) => note.id === lastId) : undefined;
  if (last) await openNote(last);
  else if (notes[0]) await openNote(notes[0]);
}

// ---- Changes made outside the app ----

let listRefreshTimer: number | undefined;

/** Refresh lists and counts once a burst of outside changes (say, a git checkout) settles. */
function scheduleListRefresh() {
  window.clearTimeout(listRefreshTimer);
  listRefreshTimer = window.setTimeout(async () => {
    await reloadFolders();
    await reloadNotes();
  }, 150);
}

async function onExternalChange(note: Note, diskContent: string) {
  scheduleListRefresh();
  if (!selectedNote) return;
  if (note.id !== selectedNote.id) {
    // The other note may have gained or lost a link to this one.
    void loadBacklinks(selectedNote.id);
    return;
  }
  if (diskContent === content) {
    // Only the frontmatter changed, say a property edited in another app.
    const propertiesChanged = JSON.stringify(note.properties ?? []) !== JSON.stringify(selectedNote.properties ?? []);
    selectedNote = note;
    if (propertiesChanged) paintProperties();
    return;
  }
  if (savedMessage === 'Saving…') {
    // Unsaved edits here and a different version on disk: let the user pick.
    window.clearTimeout(saveTimer);
    const useDisk = await confirmDialog({
      title: 'This note changed on disk',
      message: `“${note.title || 'Untitled'}” was edited outside Tagdown while you had unsaved changes.`,
      detail: 'Whichever version you don’t keep stays in this note’s version history.',
      confirmLabel: 'Use version on disk',
      cancelLabel: 'Keep my edits',
    });
    if (selectedNote?.id !== note.id) return;
    await invoke('snapshot_note', { id: note.id, content: useDisk ? content : diskContent }).catch(() => undefined);
    if (!useDisk) {
      await flushSave();
      return;
    }
  }
  selectedNote = note;
  linkTitle = note.title;
  showDiskContent(diskContent);
  savedMessage = 'Reloaded from disk';
  renderStatus();
}

/** Swap in new content for the open note, keeping scroll and caret where they were. */
function showDiskContent(next: string) {
  const source = document.querySelector<HTMLTextAreaElement>('#source');
  const caret = source && document.activeElement === source ? [source.selectionStart, source.selectionEnd] : null;
  const sourceScroll = source?.scrollTop ?? 0;
  const previewScroll = editorRoot.querySelector('.preview')?.scrollTop ?? 0;
  content = next;
  setDocumentTitle(selectedNote?.title || 'Untitled');
  renderEditor();
  const nextSource = document.querySelector<HTMLTextAreaElement>('#source');
  if (nextSource) {
    nextSource.scrollTop = sourceScroll;
    if (caret) {
      nextSource.focus({ preventScroll: true });
      nextSource.setSelectionRange(Math.min(caret[0], next.length), Math.min(caret[1], next.length));
    }
  }
  const preview = editorRoot.querySelector('.preview');
  if (preview) preview.scrollTop = previewScroll;
  if (selectedNote) void loadBacklinks(selectedNote.id);
}

function onExternalRemoval(id: string) {
  if (selectedNote?.id === id) {
    // Nothing left to save into; the list refresh closes the note.
    window.clearTimeout(saveTimer);
    savedMessage = 'Ready';
  }
  scheduleListRefresh();
}

function bindChrome() {
  document.querySelector('#settings-button')?.addEventListener('click', () => openSettings());
  document.querySelector('#open-palette')?.addEventListener('click', () => openPalette());
  document.querySelector('#sidebar-collapse')?.addEventListener('click', toggleFocusMode);
  document.querySelector('#theme-toggle')?.addEventListener('click', toggleTheme);
  onThemePreferenceChange(renderThemeToggle);
  renderThemeToggle();
  document.querySelector('#new-note')?.addEventListener('click', createNote);
  document.querySelector('#note-list-new')?.addEventListener('click', createNote);
  document.querySelector('#new-folder')?.addEventListener('click', () => {
    const parent = isUserFolder(selectedFolder) ? selectedFolder : null;
    startFolderCreate(parent);
  });
  document.querySelector('#new-tag')?.addEventListener('click', () => {
    creatingTag = true;
    tagDraftColor = 'blue';
    renderTags();
  });

  document.querySelectorAll<HTMLButtonElement>('.filter-pills button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = (btn.dataset.filter as QuickFilter) ?? 'all';
      renderFilterPills();
      renderNotes();
    });
  });

  window.addEventListener('keydown', async (event) => {
    if (event.metaKey && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); return; }
    if (isPaletteOpen()) return;
    if (event.metaKey && event.key === '\\') { event.preventDefault(); toggleFocusMode(); return; }
    if (event.metaKey && event.key === ',') { event.preventDefault(); openSettings(); }
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'd') { event.preventDefault(); toggleTheme(); }
    if (event.metaKey && event.key === 's') { event.preventDefault(); await flushSave(); }
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'e') { event.preventDefault(); await exportNoteHtml(); return; }
    if (event.metaKey && event.altKey && event.code === 'KeyP') { event.preventDefault(); await presentNote(); return; }
    if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); await exportNotePdf(); return; }
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); await showOpenTasks(); return; }
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'h') { event.preventDefault(); await showVersionHistory(); return; }
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'j') { event.preventDefault(); await openJournal(todayKey()); return; }
    if (event.metaKey && event.altKey && selectedNote?.journal && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      await openJournal(shiftDay(selectedNote.journal, event.key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    if (event.metaKey && event.key.toLowerCase() === 'n') { event.preventDefault(); await createNote(); }
    if (event.metaKey && ['1', '2', '3'].includes(event.key)) {
      event.preventDefault();
      setViewMode(event.key === '1' ? 'source' : event.key === '2' ? 'split' : 'preview');
    }
  });
}

function setViewMode(mode: ViewMode) {
  viewMode = mode;
  setPreference('lastViewMode', mode);
  renderEditor();
}

function toggleFocusMode() {
  focusMode = !focusMode;
  app.classList.toggle('is-focus', focusMode);
  const collapse = document.querySelector<HTMLButtonElement>('#sidebar-collapse');
  collapse?.setAttribute('aria-pressed', String(focusMode));
  renderEditor();
}

function toggleTheme() {
  setThemePreference(getEffectiveTheme() === 'dark' ? 'light' : 'dark');
}

function renderThemeToggle() {
  const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
  if (!button) return;
  const dark = getEffectiveTheme() === 'dark';
  button.innerHTML = uiIcon(dark ? 'sun' : 'moon', 15);
  button.title = dark ? 'Switch to light theme (⌘⇧D)' : 'Switch to dark theme (⌘⇧D)';
}

function paletteActions(): PaletteAction[] {
  const dark = getEffectiveTheme() === 'dark';
  return [
    { id: 'new', label: 'New note', hint: isUserFolder(selectedFolder) ? `in ${folders.find((f) => f.id === selectedFolder)?.name ?? 'folder'}` : undefined, shortcut: '⌘N', icon: uiIcon('compose', 15), run: createNote },
    { id: 'journal-today', label: 'Open today’s journal', hint: formatDay(todayKey()), shortcut: '⌘⇧J', icon: uiIcon('calendar', 15), run: () => openJournal(todayKey()) },
    { id: 'journal-yesterday', label: 'Open yesterday’s journal', icon: uiIcon('calendar', 15), run: () => openJournal(shiftDay(todayKey(), -1)) },
    ...(selectedNote?.journal ? [
      { id: 'journal-previous', label: 'Previous day', hint: formatDay(shiftDay(selectedNote.journal, -1)), shortcut: '⌥⌘←', icon: uiIcon('chevronLeft', 15), run: () => openJournal(shiftDay(selectedNote!.journal!, -1)) },
      { id: 'journal-next', label: 'Next day', hint: formatDay(shiftDay(selectedNote.journal, 1)), shortcut: '⌥⌘→', icon: uiIcon('chevronRight', 15), run: () => openJournal(shiftDay(selectedNote!.journal!, 1)) },
    ] : []),
    { id: 'source', label: 'Show source', shortcut: '⌘1', icon: uiIcon('source', 15), run: () => setViewMode('source') },
    { id: 'split', label: 'Show source and preview', shortcut: '⌘2', icon: uiIcon('split', 15), run: () => setViewMode('split') },
    { id: 'preview', label: 'Show preview', shortcut: '⌘3', icon: uiIcon('eye', 15), run: () => setViewMode('preview') },
    { id: 'focus', label: focusMode ? 'Exit focus mode' : 'Enter focus mode', hint: 'Hide the sidebar and note list', shortcut: '⌘\\', icon: uiIcon('focus', 15), run: toggleFocusMode },
    { id: 'theme', label: dark ? 'Switch to light theme' : 'Switch to dark theme', shortcut: '⌘⇧D', icon: uiIcon(dark ? 'sun' : 'moon', 15), run: toggleTheme },
    ...(selectedNote ? [
      { id: 'export-html', label: 'Export as HTML…', hint: 'A standalone page that opens anywhere', shortcut: '⌘⇧E', icon: uiIcon('globe', 15), run: exportNoteHtml },
      { id: 'export-pdf', label: 'Print or save as PDF…', shortcut: '⌘P', icon: uiIcon('printer', 15), run: exportNotePdf },
      { id: 'publish', label: 'Publish as website…', hint: 'Notes as web pages for any host', icon: uiIcon('globe', 15), run: showPublish },
      { id: 'present', label: 'Present as slides', hint: 'Each --- starts a new slide', shortcut: '⌥⌘P', icon: uiIcon('play', 15), run: presentNote },
      { id: 'add-property', label: 'Add property', hint: 'A typed field in this note’s frontmatter', icon: uiIcon('sliders', 15), run: () => paintProperties('new') },
      { id: 'block-link', label: 'Copy link to block', hint: 'A [[link]] to the block at the caret', icon: uiIcon('share', 15), run: () => copyBlockReference(false) },
      { id: 'block-embed', label: 'Copy block embed', hint: 'Shows the block’s current text in another note', icon: uiIcon('share', 15), run: () => copyBlockReference(true) },
      { id: 'tasks', label: 'Show open tasks', hint: 'Every unticked task across your notes', shortcut: '⌘⇧T', icon: uiIcon('checklist', 15), run: showOpenTasks },
      { id: 'history', label: 'Show version history', hint: 'Restore an earlier version of this note', shortcut: '⌘⇧H', icon: uiIcon('clock', 15), run: showVersionHistory },
    ] : []),
    ...vaults.filter((vault) => !vault.active && vault.available).map((vault) => (
      { id: `vault-${vault.path}`, label: `Switch to vault “${vault.name}”`, hint: shortPath(vault.path), icon: uiIcon('folder', 15), run: () => switchVault(vault.path) }
    )),
    { id: 'open-vault', label: 'Open folder as vault…', hint: 'Keep notes in another folder', icon: uiIcon('folder', 15), run: chooseVaultFolder },
    { id: 'reference', label: 'Open Tagdown reference', hint: 'Syntax for callouts, tabs, math and more', icon: uiIcon('book', 15), run: () => openSettings('tagdown-reference') },
    { id: 'settings', label: 'Open settings', shortcut: '⌘,', icon: uiIcon('sliders', 15), run: () => openSettings('general') },
  ];
}

function openPalette() {
  void openCommandPalette({
    noteIcon: iconSvg('notes', 15),
    notes: async () => {
      const all = await invoke<Note[]>('list_notes', { folderId: null, sort: 'updatedDesc' satisfies SortOrder });
      return all.filter((note) => note.folderId !== 'archive').map((note) => ({
        id: note.id,
        title: note.title,
        preview: note.preview,
        tags: note.tags,
        folderName: folders.find((f) => f.id === note.folderId)?.name ?? null,
        updatedLabel: formatDate(note.updatedAt),
      }));
    },
    searchContent: async (query) => (await invoke<Array<{ note: Note; excerpt: string; highlights: Array<[number, number]> }>>('search', { query }))
      .map((r) => ({ id: r.note.id, excerpt: r.excerpt, highlights: r.highlights })),
    actions: paletteActions,
    openNote: revealNote,
  });
}

/** Open a note from anywhere, widening the note list if it isn't in view. */
async function revealNote(id: string) {
  const all = await invoke<Note[]>('list_notes', { folderId: null, sort: 'updatedDesc' satisfies SortOrder });
  const note = all.find((candidate) => candidate.id === id);
  if (!note) return;
  if (!notes.some((candidate) => candidate.id === id)) {
    selectedFolder = note.folderId === 'archive' ? 'archive' : note.journal ? 'journal' : null;
    selectedTag = null;
    activeFilter = 'all';
    renderFilterPills();
    await reloadNotes();
  }
  await openNote(note);
  document.querySelector<HTMLElement>(`.note-card[data-note="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function markerClass(selected: boolean) {
  if (!selected) return '';
  return performance.now() < markerAnimateUntil ? 'marker-swash is-new' : 'marker-swash';
}

function noteMarkerChange() {
  markerAnimateUntil = performance.now() + 400;
}

async function createNote() {
  const folderId = selectedFolder === 'journal' ? null : selectedFolder;
  const note = await invoke<Note>('create_note', { folderId });
  if (selectedFolder === 'journal') {
    // A page from the journal list lands in All Notes, which shows it.
    selectedFolder = null;
    renderFilterPills();
  }
  await reloadFolders();
  await reloadNotes();
  await openNote(note);
}

/** Folders the user made, as opposed to All Notes, the Journal and the Archive. */
function isUserFolder(id: string | null): id is string {
  return !!id && id !== 'archive' && id !== 'journal';
}

// ---- Journal ----

/** Open a day's journal page, creating it (from the "Journal Template" note, if any) the first time. */
async function openJournal(day: string) {
  await settlePendingWork();
  const note = await invoke<Note>('open_journal', { day });
  journalMonth = monthOf(day);
  if (selectedFolder !== 'journal' || selectedTag) {
    noteMarkerChange();
    selectedFolder = 'journal';
    selectedTag = null;
    activeFilter = 'all';
    renderFilterPills();
  }
  await reloadFolders();
  await reloadNotes();
  await openNote(notes.find((candidate) => candidate.id === note.id) ?? note);
  document.querySelector<HTMLElement>(`.note-card[data-note="${CSS.escape(note.id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function journalCalendarHtml() {
  const withPages = new Set(libraryNotes.flatMap((note) => note.journal ? [note.journal] : []));
  return calendarHtml(journalMonth, withPages, selectedNote?.journal ?? null);
}

function bindJournalCalendar(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((button) => {
    button.addEventListener('click', () => void openJournal(button.dataset.day!));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-month-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      journalMonth = shiftMonth(journalMonth, Number(button.dataset.monthShift));
      renderNotes();
    });
  });
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
  libraryNotes = allNotes.filter((note) => note.folderId !== 'archive');
  allNotesCount = libraryNotes.length;
  renderFolders();
}

async function reloadNotes() {
  // Any change to the notes can change what query blocks list.
  invalidateQueries();
  notes = await invoke<Note[]>('list_notes', { folderId: selectedFolder, sort: 'updatedDesc' satisfies SortOrder });
  // Archived notes only show up in the Archive itself, not in All.
  if (!selectedFolder) notes = notes.filter((note) => note.folderId !== 'archive');
  // The newest day first.
  if (selectedFolder === 'journal') notes.sort((a, b) => (b.journal ?? '').localeCompare(a.journal ?? ''));
  if (selectedNote && !notes.some((note) => note.id === selectedNote!.id)) {
    selectedNote = null;
    content = '';
    setDocumentTitle('Tagdown Editor');
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
          <span class="folder-name"><span class="${markerClass(selected)}">${escapeHtml(folder.name)}</span></span>
          <span class="folder-count">${folder.noteCount ?? 0}</span>
          <span class="folder-child-add" data-new-child="${folder.id}" role="button" tabindex="-1" title="New nested folder" aria-label="New nested folder">${uiIcon('plus', 12)}</span>
          <span class="folder-delete" data-delete-folder="${folder.id}" role="button" tabindex="-1" title="Delete folder" aria-label="Delete folder">${uiIcon('trash', 12)}</span>
        </button>
        ${isExpanded ? (createRow(folder.id, depth + 1) + children.map((child) => renderFolderRow(child, depth + 1)).join('')) : ''}
      </div>
    `;
  };

  folderEl.innerHTML = `
    <button class="folder system-folder ${selectedFolder === null && !selectedTag ? 'selected' : ''}" data-folder="" style="padding-left: ${rowInset(0)}px" type="button">
      <span class="folder-disclosure is-empty" aria-hidden="true"></span>
      <span class="folder-icon" aria-hidden="true">${iconSvg('notes', 13)}</span>
      <span class="folder-name"><span class="${markerClass(selectedFolder === null && !selectedTag)}">All Notes</span></span>
      <span class="folder-count">${allNotesCount}</span>
    </button>
    <button class="folder system-folder ${selectedFolder === 'journal' ? 'selected' : ''}" data-folder="journal" style="padding-left: ${rowInset(0)}px" type="button" title="Journal (⌘⇧J for today)">
      <span class="folder-disclosure is-empty" aria-hidden="true"></span>
      <span class="folder-icon" aria-hidden="true">${iconSvg('calendar', 13)}</span>
      <span class="folder-name"><span class="${markerClass(selectedFolder === 'journal')}">Journal</span></span>
      <span class="folder-count">${libraryNotes.filter((note) => note.journal).length}</span>
    </button>
    <button class="folder system-folder ${selectedFolder === 'archive' ? 'selected' : ''}" data-folder="archive" style="padding-left: ${rowInset(0)}px" type="button">
      <span class="folder-disclosure is-empty" aria-hidden="true"></span>
      <span class="folder-icon" aria-hidden="true">${iconSvg('archive', 13)}</span>
      <span class="folder-name"><span class="${markerClass(selectedFolder === 'archive')}">Archive</span></span>
      <span class="folder-count">${archive?.noteCount ?? 0}</span>
    </button>
    ${createRow(null, 0)}
    ${(childrenByParent.get(null) ?? []).map((folder) => renderFolderRow(folder, 0)).join('')}
  `;

  folderEl.querySelectorAll<HTMLButtonElement>('.folder').forEach((button) => {
    button.addEventListener('click', async () => {
      // The Journal opens on today's page, the way a diary falls open.
      if (button.dataset.folder === 'journal') { await openJournal(todayKey()); return; }
      noteMarkerChange();
      selectedFolder = button.dataset.folder || null;
      selectedTag = null;
      activeFilter = 'all';
      renderFilterPills();
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
  noteListTitleEl.textContent = currentFolder?.name ?? (selectedFolder === 'journal' ? 'Journal' : 'All Notes');
  scopeIconEl.innerHTML = currentFolder ? folderIconSvg(currentFolder.icon) : iconSvg(selectedFolder === 'archive' ? 'archive' : selectedFolder === 'journal' ? 'calendar' : 'notes');
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
  const isUserFolder = !isArchive && !isAllNotes && id !== 'journal';

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

  // Folders can't be dropped into the Archive or the Journal.
  if (!isUserFolder && !isAllNotes) return;

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

function renderFilterPills() {
  document.querySelectorAll<HTMLButtonElement>('.filter-pills button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === activeFilter);
  });
}

function applyQuickFilter(list: Note[]): Note[] {
  switch (activeFilter) {
    case 'pinned':   return list.filter((n) => n.starred);
    case 'untagged': return list.filter((n) => n.tags.length === 0);
    case 'recent':   return list.slice(0, 10); // already sorted updatedDesc
    default:         return list;
  }
}

function renderNotes() {
  const visible = applyQuickFilter(notes);
  noteListCountEl.textContent = `${visible.length}`;
  const inJournal = selectedFolder === 'journal';
  const calendar = inJournal ? journalCalendarHtml() : '';
  if (!visible.length) {
    const filtered = activeFilter !== 'all';
    noteEl.innerHTML = `${calendar}<div class="empty"><div class="empty-icon">${iconSvg('notes', 22)}</div><strong>${filtered ? 'Nothing matches this filter' : 'This list is empty'}</strong><span>${filtered ? 'Switch back to All to see every note here.' : 'Write the first note here. It saves as plain text in your vault.'}</span>${filtered ? '' : `<button type="button" class="empty-action" data-empty-list-new>${uiIcon('plus', 13)}New note</button>`}</div>`;
    noteEl.querySelector('[data-empty-list-new]')?.addEventListener('click', createNote);
    bindJournalCalendar(noteEl);
    renderTags();
    return;
  }
  let lastGroup = '';
  noteEl.innerHTML = calendar + visible.map((note) => {
    const day = inJournal ? note.journal ?? null : null;
    const group = day ? monthGroup(day) : dateGroup(note.updatedAt);
    const heading = group !== lastGroup ? `<h2 class="note-group">${group}</h2>` : '';
    lastGroup = group;
    const tagMarkup = note.tags.slice(0, 3).map((tag) => `<span style="--tag-dot:${colorForTag(tag).dot}"><i></i>${escapeHtml(tag.split('/').pop() ?? tag)}</span>`).join('');
    const extraTags = note.tags.length > 3 ? `<span class="more">+${note.tags.length - 3}</span>` : '';
    const archived = note.folderId === 'archive';
    return `${heading}
      <article class="note-card ${selectedNote?.id === note.id ? 'selected' : ''}" data-note="${note.id}" tabindex="0" aria-current="${selectedNote?.id === note.id}">
        <div class="note-card-head">
          <h3>${escapeHtml(day ? formatDay(day, 'short') : note.title || 'Untitled')}</h3>
          ${day ? `<time datetime="${escapeHtml(day)}">${relativeDay(day) ?? ''}</time>` : `<time datetime="${escapeHtml(note.updatedAt)}">${formatCardDate(note.updatedAt)}</time>`}
        </div>
        <p>${escapeHtml(note.preview || (day ? 'Nothing written yet' : 'Empty note'))}</p>
        ${tagMarkup || note.starred ? `<footer>${note.starred ? `<span class="starred" title="Pinned" aria-label="Pinned">${uiIcon('pin', 11)}</span>` : ''}${tagMarkup}${extraTags}</footer>` : ''}
        <button class="note-delete" data-delete-note="${note.id}" type="button" title="${archived ? 'Delete permanently' : 'Move to Archive'}" aria-label="${archived ? 'Delete permanently' : 'Move to Archive'}">${archived ? uiIcon('trash', 13) : iconSvg('archive', 13)}</button>
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
  bindJournalCalendar(noteEl);
  noteEl.querySelectorAll<HTMLButtonElement>('.note-delete').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = button.dataset.deleteNote;
      if (!id) return;
      const note = notes.find((candidate) => candidate.id === id);
      const archived = note?.folderId === 'archive';
      const ok = !archived && !getPreference('confirmArchive') ? true : await confirmDialog({
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
  for (const note of libraryNotes) {
    if (note.folderId === 'archive') continue;
    for (const t of note.tags) set.add(t);
  }
  return [...set];
}

function buildTagTree(): TagNode[] {
  const recordNames = new Set(tags.map((t) => t.name.toLowerCase()));
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
  return libraryNotes.filter(
    (note) =>
      note.folderId !== 'archive' &&
      note.tags.some((t) => t === path || t.startsWith(`${path}/`)),
  ).length;
}

function colorForTag(path: string) {
  const record = tags.find((t) => t.name.toLowerCase() === path);
  if (record) return TAG_COLORS[record.color] ?? TAG_COLORS.slate;
  // Stable pseudo-random color derived from the tag path.
  let hash = 0;
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) | 0;
  const key = TAG_COLOR_KEYS[Math.abs(hash) % TAG_COLOR_KEYS.length];
  return TAG_COLORS[key];
}

async function selectTag(path: string) {
  noteMarkerChange();
  selectedTag = path;
  selectedFolder = null;
  activeFilter = 'all';
  renderFilterPills();
  const all = await invoke<Note[]>('list_notes', { folderId: null, sort: 'updatedDesc' satisfies SortOrder });
  notes = all.filter(
    (note) =>
      note.folderId !== 'archive' &&
      note.tags.some((t) => t === path || t.startsWith(`${path}/`)),
  );
  if (selectedNote && !notes.some((n) => n.id === selectedNote!.id)) {
    selectedNote = null;
    content = '';
    setDocumentTitle('Tagdown Editor');
    renderEditor();
  }
  renderFolders();
  renderNotes();
  noteListTitleEl.textContent = `#${path}`;
  scopeIconEl.innerHTML = uiIcon('hash', 16);
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
        <div class="tag-row ${selected ? 'selected' : ''}" data-tag-path="${escapeHtml(node.path)}" role="button" tabindex="0" aria-pressed="${selected}" style="padding-left: ${rowInset(depth)}px">
          <span class="tag-disclosure ${isExpanded ? 'open' : ''} ${node.children.length ? '' : 'is-empty'}" data-toggle-tag="${escapeHtml(node.path)}" aria-hidden="true">${iconSvg('chevron', 10)}</span>
          <span class="tag-dot" style="background:${c.dot}"></span>
          <span class="tag-name"><span class="${markerClass(selected)}">${escapeHtml(node.name)}</span></span>
          <span class="tag-count">${count}</span>
          ${deletable ? `<button class="tag-delete" data-delete-tag-name="${escapeHtml(node.path)}" type="button" title="Delete tag" aria-label="Delete tag">${uiIcon('close', 11)}</button>` : ''}
        </div>
        ${isExpanded ? node.children.map((child) => renderTagRow(child, depth + 1)).join('') : ''}
      </div>
    `;
  };

  // Like Notion's sidebar sections: show the first few, tuck the rest behind "More".
  const selectedRoot = selectedTag?.split('/')[0];
  const hiddenCount = Math.max(0, roots.length - TAG_PREVIEW_LIMIT);
  const visibleRoots = showAllTags || !hiddenCount
    ? roots
    : roots.filter((node, index) => index < TAG_PREVIEW_LIMIT || node.path === selectedRoot);
  const moreRow = hiddenCount
    ? `<button type="button" class="tag-row more-row" data-tags-more aria-expanded="${showAllTags}"><span class="more-dots" aria-hidden="true">···</span><span class="tag-name">${showAllTags ? 'Show less' : `More`}</span></button>`
    : '';
  const rows = visibleRoots.map((node) => renderTagRow(node, 0)).join('') + moreRow;

  const empty = !creatingTag && totalNodes === 0
    ? '<div class="tag-empty">Type <kbd>#tag</kbd> in a note, or press <kbd>+</kbd>.</div>'
    : '';

  tagEl.innerHTML = createCard + rows + empty;

  tagEl.querySelector('[data-tags-more]')?.addEventListener('click', () => {
    showAllTags = !showAllTags;
    renderTags();
  });
  tagEl.querySelectorAll<HTMLElement>('.tag-row:not(.more-row)').forEach((row) => {
    row.addEventListener('click', () => selectTag(row.dataset.tagPath!));
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectTag(row.dataset.tagPath!); }
    });
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
      const record = tags.find((t) => t.name.toLowerCase() === path);
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
  await settlePendingWork();
  selectedNote = note;
  setPreference('lastNoteId', note.id);
  linkNoteId = note.id;
  linkTitle = note.title;
  const noteContent = await invoke<NoteContent>('get_note_content', { id: note.id });
  content = noteContent.content;
  setDocumentTitle(note.title || 'Untitled');
  renderNotes();
  renderEditor();
  void loadBacklinks(note.id);
}

/** Save pending edits and link renames before leaving the open note. */
async function settlePendingWork() {
  if (selectedNote && savedMessage === 'Saving…') {
    window.clearTimeout(saveTimer);
    await flushSave();
  }
  if (linkSyncTimer !== undefined) await syncLinks();
}

// ---- Wikilinks ----

function scheduleLinkSync() {
  window.clearTimeout(linkSyncTimer);
  linkSyncTimer = window.setTimeout(() => void syncLinks(), 1200);
}

/**
 * Point links in other notes at the open note's new title. Runs once the title
 * settles; the backend declines titles that are empty or belong to another
 * note, in which case the old title is kept and a later save retries.
 */
async function syncLinks() {
  window.clearTimeout(linkSyncTimer);
  linkSyncTimer = undefined;
  const id = linkNoteId;
  const oldTitle = linkTitle;
  const newTitle = selectedNote?.id === id ? selectedNote.title : null;
  if (!id || newTitle === null || newTitle === oldTitle) return;
  const outcome = await invoke<{ applied: boolean; updated: number }>('rename_links', { id, oldTitle, newTitle });
  if (!outcome.applied) return;
  if (linkNoteId === id) linkTitle = newTitle;
  if (outcome.updated) {
    savedMessage = `Updated links in ${outcome.updated} ${outcome.updated === 1 ? 'note' : 'notes'}`;
    renderStatus();
    await reloadNotes();
  }
  if (selectedNote?.id === id) void loadBacklinks(id);
}

async function followWikilink(target: string) {
  const { title, anchor } = splitTarget(target);
  if (!title) return;
  let note = resolveTarget(target, libraryNotes);
  // A link to a date is a link to that day's journal page.
  if (!note && isDayKey(title)) {
    await openJournal(title);
    if (anchor) scrollToAnchor(anchor);
    return;
  }
  if (!note) note = await createNoteTitled(title);
  if (note.id !== selectedNote?.id) await revealNote(note.id);
  if (anchor) scrollToAnchor(anchor);
}

/** `#Heading` scrolls to a heading, `#^id` to the block marked `^id`. */
function scrollToAnchor(anchor: string) {
  if (anchor.startsWith('^')) scrollToBlock(anchor.slice(1));
  else scrollToHeading(anchor);
}

/** A link to a note that doesn't exist yet creates it, next to the current one. */
async function createNoteTitled(title: string) {
  await settlePendingWork();
  const folderId = isUserFolder(selectedNote?.folderId ?? null) ? selectedNote!.folderId : null;
  const created = await invoke<Note>('create_note', { folderId });
  const note = await invoke<Note>('save_note', { id: created.id, content: `# ${title}\n\n` });
  await reloadFolders();
  await reloadNotes();
  return note;
}

function scrollToHeading(anchor: string) {
  const wanted = normalizeTitle(anchor);
  const headings = Array.from(editorRoot.querySelectorAll<HTMLElement>('.preview :is(h1, h2, h3, h4, h5, h6)'));
  const heading = headings.find((h) => h.id === anchor || normalizeTitle(h.textContent || '') === wanted);
  heading?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function scrollToBlock(id: string) {
  const wanted = id.toLowerCase();
  const marker = Array.from(editorRoot.querySelectorAll<HTMLElement>('.preview [data-block-id]'))
    .find((el) => el.dataset.blockId?.toLowerCase() === wanted && !el.closest('.td-transclusion'));
  const block = marker ? blockTarget(marker) : null;
  if (!block) {
    showNotice(`No block ^${id} in this note`);
    return;
  }
  block.scrollIntoView({ block: 'center', behavior: 'smooth' });
  block.classList.remove('is-block-target');
  void block.offsetWidth; // restart the highlight
  block.classList.add('is-block-target');
  block.addEventListener('animationend', () => block.classList.remove('is-block-target'), { once: true });
}

// ---- Properties ----

/** Draw the open note's properties panel. */
function paintProperties(focus?: Parameters<typeof renderPropertiesPanel>[1]['focus']) {
  const host = editorRoot.querySelector<HTMLElement>('[data-properties]');
  if (!host || !selectedNote) return;
  renderPropertiesPanel(host, {
    properties: selectedNote.properties ?? [],
    keySuggestions: () => vaultPropertyKeys(),
    valueSuggestions: propertyValueSuggestions,
    knownType: propertyKnownType,
    save: saveProperty,
    decorate: markWikilinks,
    openLink: (target) => void followWikilink(target),
    focus,
  });
}

/** Values the vault uses for the property `key`. */
function propertyValueSuggestions(key: string): string[] {
  const values = new Set<string>();
  for (const note of libraryNotes) {
    for (const p of note.properties ?? []) {
      if (p.key.toLowerCase() !== key.toLowerCase()) continue;
      if (p.type === 'text' && p.value) values.add(p.value);
      if (p.type === 'list') p.value.forEach((item) => values.add(item));
    }
  }
  return [...values].slice(0, 50);
}

/** The type the vault mostly gives the property `key`. */
function propertyKnownType(key: string): PropertyType | null {
  const counts = new Map<PropertyType, number>();
  for (const note of libraryNotes) for (const p of note.properties ?? []) if (p.key.toLowerCase() === key.toLowerCase()) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ---- Table views: <query show:table /> ----

/** Refill the open note's query blocks with fresh results. */
async function refreshQueries() {
  invalidateQueries();
  const preview = editorRoot.querySelector<HTMLDivElement>('.preview');
  if (preview) await fillQueries(preview, { excludeId: selectedNote?.id ?? null, table: tableActions });
}

/** Rewrite the `<query … />` reading `oldQuery` in the open note (a table's sort or columns). */
function replaceQuery(oldQuery: string, newQuery: string) {
  if (blockEdit) commitBlockEdit();
  let replaced = false;
  const next = content.replace(/<\s*query\b([^>]*?)\s*\/\s*>/gi, (whole, inner: string) => {
    if (replaced || inner.trim() !== oldQuery) return whole;
    replaced = true;
    return `<query ${newQuery} />`;
  });
  if (!replaced) return;
  content = next;
  syncSourceTextarea();
  scheduleSave();
  const preview = editorRoot.querySelector<HTMLDivElement>('.preview');
  if (preview) paintPreview(preview);
}

const tableActions: TableActions = {
  editProperty: async (noteId, key, value) => {
    try {
      const note = await invoke<Note>('set_property', { id: noteId, key, value, renameFrom: null });
      libraryNotes = libraryNotes.map((n) => (n.id === noteId ? note : n));
      if (selectedNote?.id === noteId) {
        selectedNote = note;
        paintProperties();
      }
      await refreshQueries();
      scheduleListRefresh();
      return true;
    } catch (error) {
      await message(String(error), { title: 'Could not change the property', kind: 'warning' });
      return false;
    }
  },
  editQuery: replaceQuery,
  createRow: async (newNote, title) => {
    try {
      await settlePendingWork();
      const folderId = newNote.folderId ?? (isUserFolder(selectedNote?.folderId ?? null) ? selectedNote!.folderId : null);
      const created = await invoke<Note>('create_note', { folderId });
      const tags = newNote.tags.length ? `${newNote.tags.map((tag) => `#${tag}`).join(' ')}\n` : '';
      await invoke<Note>('save_note', { id: created.id, content: `# ${title}\n\n${tags}` });
      for (const { key, ...value } of newNote.properties) {
        await invoke<Note>('set_property', { id: created.id, key, value, renameFrom: null });
      }
      await reloadFolders();
      await reloadNotes();
      await refreshQueries();
      return true;
    } catch (error) {
      await message(String(error), { title: 'Could not add the note', kind: 'warning' });
      return false;
    }
  },
  openLink: (target) => void followWikilink(target),
  decorate: markWikilinks,
  valueSuggestions: propertyValueSuggestions,
  knownType: propertyKnownType,
};

/** Property names across the vault, most used first. */
function vaultPropertyKeys(): string[] {
  const counts = new Map<string, number>();
  for (const note of libraryNotes) for (const p of note.properties ?? []) counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

async function saveProperty(key: string, value: PropertyValue | null, renameFrom?: string): Promise<boolean> {
  if (!selectedNote) return false;
  const id = selectedNote.id;
  const isNew = value !== null && !renameFrom && !(selectedNote.properties ?? []).some((p) => p.key === key);
  // Body edits go first, so the two writes don't race.
  if (savedMessage === 'Saving…') {
    window.clearTimeout(saveTimer);
    await flushSave();
  }
  try {
    const note = await invoke<Note>('set_property', { id, key, value, renameFrom: renameFrom ?? null });
    if (selectedNote?.id !== id) return true;
    selectedNote = note;
    libraryNotes = libraryNotes.map((n) => (n.id === id ? note : n));
    invalidateQueries();
    paintProperties(isNew ? { key, part: 'value' } : undefined);
    const preview = editorRoot.querySelector<HTMLDivElement>('.preview');
    if (preview) void fillQueries(preview, { excludeId: id, table: tableActions });
    scheduleListRefresh();
    return true;
  } catch (error) {
    await message(String(error), { title: 'Could not change the property', kind: 'warning' });
    return false;
  }
}

// ---- Block references ----

/** The note line the caret was last on, in the block editor or the source. */
let caretLine: number | null = null;

function rememberCaret(textarea: HTMLTextAreaElement) {
  const line = textarea.value.slice(0, textarea.selectionStart).split('\n').length - 1;
  if (textarea.id === 'source') caretLine = line;
  else if (blockEdit?.el === textarea) caretLine = blockEdit.start + line;
}

/**
 * Copy `[[Title#^id]]` (or its `![[…]]` embed) for the block at the caret,
 * first giving the block an id when it has none. Only that block's line changes.
 */
async function copyBlockReference(embed = false) {
  if (!selectedNote) return;
  const source = document.querySelector<HTMLTextAreaElement>('#source');
  const editing = blockEdit?.el ?? (source && document.activeElement === source ? source : null);
  let id: string | null = null;
  if (editing) {
    const caret = editing.selectionStart;
    const result = ensureBlockId(editing.value, caret, blockIds(content));
    if (result?.changed) {
      editing.value = result.text;
      editing.setSelectionRange(caret, caret);
      editing.dispatchEvent(new Event('input'));
    }
    id = result?.id ?? null;
  } else if (caretLine !== null) {
    const offset = content.split('\n').slice(0, caretLine).join('\n').length + (caretLine ? 1 : 0);
    const result = ensureBlockId(content, offset, blockIds(content));
    if (result?.changed) {
      content = result.text;
      syncSourceTextarea();
      scheduleSave();
      const preview = editorRoot.querySelector<HTMLDivElement>('.preview');
      if (preview) paintPreview(preview);
    }
    id = result?.id ?? null;
  }
  if (!id) {
    await message('Click into a paragraph, list item, task or heading first, then copy the reference again.', { title: 'No block to link to', kind: 'info' });
    return;
  }
  const reference = blockReference(selectedNote.title || 'Untitled', id, embed);
  await copyText(reference);
  showNotice(`Copied ${reference}`);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older WebKit without clipboard access outside a gesture.
    const active = document.activeElement as HTMLElement | null;
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.append(scratch);
    scratch.select();
    document.execCommand('copy');
    scratch.remove();
    active?.focus({ preventScroll: true });
  }
}

async function loadBacklinks(id: string) {
  const items = await invoke<Backlink[]>('backlinks', { id }).catch(() => [] as Backlink[]);
  if (selectedNote?.id !== id) return;
  backlinks = { id, items };
  const section = editorRoot.querySelector<HTMLElement>('.preview [data-backlinks]');
  if (!section) return;
  const holder = document.createElement('div');
  holder.innerHTML = backlinksHtml();
  const fresh = holder.firstElementChild as HTMLElement;
  section.replaceWith(fresh);
  resolveLocalImages(fresh);
  void applyExternals(fresh, getEffectiveTheme());
}

function backlinksHtml() {
  if (!selectedNote || backlinks?.id !== selectedNote.id) return '<section class="backlinks" data-backlinks hidden></section>';
  const { items } = backlinks;
  const self = normalizeTitle(selectedNote.title);
  const mention = (line: string) => {
    const holder = document.createElement('div');
    holder.innerHTML = renderPreview(line);
    holder.querySelectorAll<HTMLElement>('.td-wikilink').forEach((link) => {
      if (normalizeTitle(splitTarget(link.dataset.target || '').title) === self) link.classList.add('is-self');
    });
    // Tasks nested under the link show their state; ticking them happens in their note.
    holder.querySelectorAll('input').forEach((box) => box.setAttribute('disabled', ''));
    // One line of context: unwrap the paragraph the renderer adds.
    const only = holder.children.length === 1 && holder.firstElementChild?.tagName === 'P' ? holder.firstElementChild : null;
    return only ? `<div class="backlink-line">${only.innerHTML}</div>` : `<div class="backlink-line has-children">${holder.innerHTML}</div>`;
  };
  const list = items.map(({ note, mentions }) => `
    <div class="backlink" role="link" tabindex="0" data-open-note="${escapeHtml(note.id)}">
      <div class="backlink-title">${iconSvg('notes', 13)}<strong>${escapeHtml(note.title || 'Untitled')}</strong></div>
      ${mentions.map(mention).join('')}
    </div>`).join('');
  return `
    <section class="backlinks" data-backlinks aria-label="Linked mentions">
      <h2>Linked mentions${items.length ? `<span>${items.length}</span>` : ''}</h2>
      ${list || `<p class="backlinks-empty">No other notes link here yet. Link to this note with <code>[[${escapeHtml(selectedNote.title || 'Untitled')}]]</code>.</p>`}
    </section>`;
}

/** Mark links whose target note doesn't exist (clicking one creates it). */
function markWikilinks(el: HTMLElement) {
  el.querySelectorAll<HTMLAnchorElement>('.td-wikilink').forEach((link) => {
    const target = link.dataset.target || '';
    const note = resolveTarget(target, libraryNotes);
    link.classList.toggle('is-missing', !note);
    const title = splitTarget(target).title;
    link.title = note ? `Open “${note.title}”` : isDayKey(title) ? `Start the journal page for ${formatDay(title)}` : `Create note “${title}”`;
    const id = blockIdOfTarget(target);
    // Embeds say so themselves when their block is gone.
    if (note && id && !link.classList.contains('td-transclusion-source')) {
      const mark = (found: boolean) => {
        link.classList.toggle('is-missing-block', !found);
        if (!found) link.title = `No block ^${id} in “${note.title}” any more. Opens the note.`;
      };
      const known = cachedBlock(title, id);
      if (known !== undefined) mark(!!known);
      void lookupBlock(title, id).then((ref) => mark(!!ref));
    }
  });
}

function paintPreview(el: HTMLElement) {
  const { html, blocks } = renderEditablePreview(content);
  previewBlocks = blocks;
  const empty = !content.trim();
  // Only offer in-place editing when the source could be mapped to blocks.
  const append = blocks.length || empty
    ? `<div class="td-block-append" data-append-block>${empty ? 'Start writing, or type / for commands' : 'Click to add a block'}</div>`
    : '';
  el.innerHTML = html + append + backlinksHtml();
  resolveLocalImages(el);
  markDocTitle(el);
  markWikilinks(el);
  void fillQueries(el, { excludeId: selectedNote?.id ?? null, table: tableActions });
  void fillBlockEmbeds(el, decorateEmbed);
  void applyExternals(el, getEffectiveTheme());
}

function decorateEmbed(body: HTMLElement) {
  resolveLocalImages(body);
  markWikilinks(body);
  void applyExternals(body, getEffectiveTheme());
}

// The document header already shows the note title in large type; hide the
// preview's leading heading block when it only repeats that title.
function markDocTitle(el: HTMLElement) {
  const first = el.querySelector<HTMLElement>(':scope > .td-block');
  const only = first?.children.length === 1 ? first.firstElementChild : null;
  if (only?.tagName === 'H1' && only.textContent?.trim() === (selectedNote?.title || '').trim()) first!.classList.add('is-doc-title');
}

function scheduleSave() {
  savedMessage = 'Saving…';
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 500);
  renderStatus();
}

function syncSourceTextarea() {
  const source = document.querySelector<HTMLTextAreaElement>('#source');
  if (!source || source.value === content) return;
  const { scrollTop } = source;
  source.value = content;
  source.scrollTop = scrollTop;
}

function textAroundPoint(x: number, y: number): { before: string; after: string } | null {
  const range = document.caretRangeFromPoint?.(x, y);
  const node = range?.startContainer;
  if (!range || !node || node.nodeType !== Node.TEXT_NODE) return null;
  const data = (node as Text).data;
  return { before: data.slice(Math.max(0, range.startOffset - 16), range.startOffset), after: data.slice(range.startOffset, range.startOffset + 16) };
}

// Place the caret where the click landed by finding the clicked words in the source.
function caretOffset(text: string, hint: { before: string; after: string } | null) {
  if (!hint) return text.length;
  for (let n = hint.before.length; n >= 3; n--) {
    const at = text.indexOf(hint.before.slice(-n));
    if (at >= 0) return at + n;
  }
  for (let n = hint.after.length; n >= 3; n--) {
    const at = text.indexOf(hint.after.slice(0, n));
    if (at >= 0) return at;
  }
  return text.length;
}

function autoGrow(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * Close the open block editor, if any, and return where block `index` (of the
 * layout painted before it opened) is now; -1 if it is gone.
 */
function closeBlockEditFor(index: number): number {
  const block = previewBlocks[index];
  if (!block) return -1;
  if (!blockEdit) return index;
  // Lines after the open block shift by however much it grew.
  const delta = blockEdit.lineCount - blockEdit.originalCount;
  const targetStart = block.start + (block.start > blockEdit.start ? delta : 0);
  commitBlockEdit();
  return previewBlocks.findIndex((candidate) => candidate.start === targetStart);
}

const previewBlockEl = (index: number) => editorRoot.querySelector<HTMLElement>(`.preview .td-block[data-block="${index}"]`);

function startBlockEdit(blockEl: HTMLElement, hint: { before: string; after: string } | null = null) {
  const index = closeBlockEditFor(Number(blockEl.dataset.block));
  const fresh = index < 0 ? null : previewBlockEl(index);
  if (!fresh) return;
  const block = previewBlocks[index];
  openBlockEditor(fresh, block.start, block.end - block.start, hint, null);
}

/** How many blocks move with block `index`: its section, for a heading, when that's turned on. */
function moveSpan(index: number) {
  return getPreference('dragHeadingSections') ? sectionSpan(content, previewBlocks, index) : 1;
}

/** Move `count` blocks from `from` to sit before block `to`; returns the first moved block's new index, or -1. */
function moveBlockTo(from: number, to: number, count = 1): number {
  const moved = moveBlock(content, previewBlocks, from, to, count);
  if (!moved) return -1;
  content = moved.source;
  syncSourceTextarea();
  scheduleSave();
  const preview = editorRoot.querySelector<HTMLDivElement>('.preview');
  if (preview) paintPreview(preview);
  const index = previewBlocks.findIndex((block) => block.start === moved.start);
  const el = previewBlockEl(index);
  if (el) {
    el.classList.add('is-just-moved');
    el.addEventListener('animationend', () => el.classList.remove('is-just-moved'), { once: true });
    el.scrollIntoView({ block: 'nearest' });
  }
  return index;
}

// With sections on, a heading steps past a whole sibling section instead of
// a single block.
function stepUpTarget(index: number) {
  const level = getPreference('dragHeadingSections') ? headingLevel(content, previewBlocks, index) : 0;
  if (level) {
    for (let i = index - 1; i >= 0; i--) {
      const other = headingLevel(content, previewBlocks, i);
      if (other && other <= level) return other === level ? i : index - 1;
    }
  }
  return index - 1;
}

function stepDownTarget(index: number, count: number) {
  const next = index + count;
  // Nothing below: an out-of-range target, which the caller ignores.
  if (next >= previewBlocks.length) return next + 1;
  const level = getPreference('dragHeadingSections') ? headingLevel(content, previewBlocks, index) : 0;
  // Past a whole sibling section; past just the heading of a bigger one, so
  // this section becomes its first subsection.
  return next + (level && headingLevel(content, previewBlocks, next) === level ? moveSpan(next) : 1);
}

/** ⌘⇧↑ / ⌘⇧↓ while editing a block: move it past its neighbour and keep editing. */
function moveOpenBlock(direction: -1 | 1) {
  if (!blockEdit) return;
  const { start, el } = blockEdit;
  const caret = el.selectionStart;
  commitBlockEdit();
  let index = previewBlocks.findIndex((block) => block.start === start);
  if (index < 0) return;
  const count = moveSpan(index);
  const to = direction < 0 ? stepUpTarget(index) : stepDownTarget(index, count);
  const first = firstMovableBlock(content, previewBlocks);
  if (index >= first && to >= first && to <= previewBlocks.length) {
    const moved = moveBlockTo(index, to, count);
    if (moved >= 0) index = moved;
  }
  const fresh = previewBlockEl(index);
  const block = previewBlocks[index];
  if (fresh && block) openBlockEditor(fresh, block.start, block.end - block.start, null, null, caret);
}

function startAppendBlock(preview: HTMLElement) {
  if (blockEdit) commitBlockEdit();
  const original = content;
  const trimmed = content.replace(/\s+$/, '');
  content = trimmed ? `${trimmed}\n\n` : '';
  const wrap = document.createElement('div');
  wrap.className = 'td-block';
  preview.querySelector('[data-append-block]')?.before(wrap);
  openBlockEditor(wrap, content.split('\n').length - 1, 1, null, original);
}

function openBlockEditor(wrap: HTMLElement, start: number, lineCount: number, hint: { before: string; after: string } | null, restoreIfEmpty: string | null, caretAt?: number) {
  const text = content.split('\n').slice(start, start + lineCount).join('\n');
  const textarea = document.createElement('textarea');
  textarea.className = 'td-block-editor';
  textarea.value = text;
  textarea.spellcheck = getPreference('spellcheck');
  textarea.placeholder = SLASH_HINT;
  textarea.setAttribute('aria-label', 'Edit block. Press Escape to finish.');
  wrap.classList.remove('is-doc-title');
  wrap.classList.add('is-editing');
  wrap.replaceChildren(textarea);
  blockEdit = { el: textarea, start, lineCount, originalCount: lineCount, restoreIfEmpty };
  editorRoot.classList.add('is-block-editing');
  autoGrow(textarea);
  textarea.focus({ preventScroll: true });
  const caret = caretAt === undefined ? caretOffset(text, hint) : Math.min(caretAt, text.length);
  textarea.setSelectionRange(caret, caret);

  attachEditingAids(textarea);
  textarea.addEventListener('input', () => {
    if (blockEdit?.el !== textarea) return;
    const lines = content.split('\n');
    const next = textarea.value.split('\n');
    lines.splice(blockEdit.start, blockEdit.lineCount, ...next);
    blockEdit.lineCount = next.length;
    content = lines.join('\n');
    autoGrow(textarea);
    syncSourceTextarea();
    scheduleSave();
  });
  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveOpenBlock(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    const finish = event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey));
    if (finish || (event.key === 'Backspace' && !textarea.value)) {
      event.preventDefault();
      event.stopPropagation();
      commitBlockEdit();
    }
  });
  textarea.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (blockEdit?.el !== textarea) return;
      // Formatting from the dock or the components menu keeps the block open.
      const active = document.activeElement;
      if (active === textarea || active?.closest('.format-dock, .toolbar-menu')) return;
      // Choosing images in the file dialog keeps the block open for them.
      if (pickingImages) return;
      commitBlockEdit();
    }, 0);
  });
}

function commitBlockEdit() {
  if (!blockEdit) return;
  const edit = blockEdit;
  blockEdit = null;
  editorRoot.classList.remove('is-block-editing');
  if (!edit.el.value.trim()) {
    if (edit.restoreIfEmpty !== null) {
      content = edit.restoreIfEmpty;
    } else {
      // An emptied block is removed, along with the blank line that separated it.
      const lines = content.split('\n');
      lines.splice(edit.start, edit.lineCount);
      if (lines[edit.start - 1]?.trim() === '' && (lines[edit.start] === undefined || lines[edit.start].trim() === '')) lines.splice(edit.start - 1, 1);
      content = lines.join('\n');
      scheduleSave();
    }
    syncSourceTextarea();
  }
  const preview = editorRoot.querySelector<HTMLDivElement>('.preview');
  if (preview) paintPreview(preview);
}

function renderEditor() {
  blockEdit = null;
  caretLine = null;
  const title = selectedNote?.title || 'Untitled';
  const preview = '<div class="preview td-note-root"></div>';
  const textarea = `<textarea id="source" spellcheck="${getPreference('spellcheck')}" placeholder="${SLASH_HINT}" aria-label="Tagdown source">${escapeHtml(content)}</textarea>`;
  editorRoot.className = `editor-root mode-${viewMode}`;
  const folder = selectedNote ? folders.find((f) => f.id === selectedNote!.folderId) : null;
  const day = selectedNote?.journal ?? null;
  const crumbHome = day && !folder
    ? `<span class="crumb">${iconSvg('calendar', 14)}Journal</span>`
    : `<span class="crumb">${folder ? folderIconSvg(folder.icon) : iconSvg('notes', 14)}${escapeHtml(folder?.name ?? 'Notes')}</span>`;
  const dayNav = day ? `
    <div class="journal-day-nav" role="group" aria-label="Journal days">
      <button type="button" class="chrome-icon-button" data-journal-day="${shiftDay(day, -1)}" title="Previous day (⌥⌘←)" aria-label="Previous day">${uiIcon('chevronLeft', 14)}</button>
      <button type="button" class="journal-today-button" data-journal-day="${todayKey()}" title="Today’s journal (⌘⇧J)" ${day === todayKey() ? 'disabled' : ''}>Today</button>
      <button type="button" class="chrome-icon-button" data-journal-day="${shiftDay(day, 1)}" title="Next day (⌥⌘→)" aria-label="Next day">${uiIcon('chevronRight', 14)}</button>
    </div>` : '';
  const modeButton = (mode: ViewMode, icon: string, label: string, key: string) =>
    `<button data-mode="${mode}" type="button" title="${label} (⌘${key})" aria-label="${label}" class="${viewMode === mode ? 'selected' : ''}" aria-pressed="${viewMode === mode}">${uiIcon(icon, 14)}<span>${label}</span></button>`;
  editorRoot.innerHTML = selectedNote ? `
    <header class="editor-topbar" data-tauri-drag-region>
      ${focusMode ? `<button class="chrome-icon-button" type="button" data-exit-focus title="Exit focus mode (⌘\\)" aria-label="Exit focus mode">${uiIcon('sidebar', 15)}</button>` : ''}
      <nav class="crumbs" aria-label="Location" data-tauri-drag-region>
        ${crumbHome}
        <span class="crumb-sep" aria-hidden="true">/</span>
        <span class="crumb is-current">${escapeHtml(day ? formatDay(day, 'short') : title)}</span>
      </nav>
      <div class="topbar-right">
        <span id="saved"></span>
        <div class="mode-switch" role="group" aria-label="View mode">
          ${modeButton('source', 'source', 'Source', '1')}${modeButton('split', 'split', 'Split', '2')}${modeButton('preview', 'eye', 'Preview', '3')}
        </div>
        <button id="present-note" class="chrome-icon-button" type="button" title="Present as slides (⌥⌘P)" aria-label="Present as slides">${uiIcon('play', 15)}</button>
        <button id="note-history" class="chrome-icon-button" type="button" title="Version history (⌘⇧H)" aria-label="Version history">${uiIcon('clock', 15)}</button>
        <div class="export-dropdown">
          <button id="export-note" class="chrome-icon-button" type="button" aria-haspopup="menu" aria-expanded="false" title="Export" aria-label="Export">${uiIcon('share', 15)}</button>
          <div class="export-menu" role="menu" hidden>
            <button type="button" role="menuitem" data-export="html">${uiIcon('globe', 14)}<span>Export as HTML…</span><kbd>⌘⇧E</kbd></button>
            <button type="button" role="menuitem" data-export="pdf">${uiIcon('printer', 14)}<span>Print or save as PDF…</span><kbd>⌘P</kbd></button>
            <button type="button" role="menuitem" data-export="site">${uiIcon('globe', 14)}<span>Publish as website…</span></button>
          </div>
        </div>
        <button id="pin-note" class="chrome-icon-button pin-button ${selectedNote.starred ? 'active' : ''}" type="button" aria-pressed="${selectedNote.starred}" title="${selectedNote.starred ? 'Unpin note' : 'Pin note'}" aria-label="${selectedNote.starred ? 'Unpin note' : 'Pin note'}">${uiIcon('pin', 15)}</button>
      </div>
    </header>
    <div class="doc-header ${day ? 'is-journal' : ''}">
      ${day ? `<div class="journal-day-head"><h1 class="doc-title">${escapeHtml(formatDay(day))}</h1>${dayNav}</div>` : `<h1 class="doc-title">${escapeHtml(title)}</h1>`}
      <div class="doc-meta">
        ${day ? `<span class="journal-day-key">${relativeDay(day) ? `${relativeDay(day)} · ` : ''}${escapeHtml(title)}</span>` : ''}
        <span>Edited ${formatDate(selectedNote.updatedAt)}</span>
        <span id="counts"></span>
        ${selectedNote.tags.length ? `<span class="doc-tags">${selectedNote.tags.map((tag) => `<button type="button" class="doc-tag" data-doc-tag="${escapeHtml(tag)}" style="--tag-dot:${colorForTag(tag).dot}"><i></i>${escapeHtml(tag)}</button>`).join('')}</span>` : ''}
      </div>
      <div class="doc-properties" data-properties></div>
    </div>
    <div class="editor-body">${viewMode === 'source' ? textarea : viewMode === 'preview' ? preview : `<div class="split">${textarea}${preview}</div>`}</div>
    <div class="format-dock">${renderEditorToolbar()}</div>
  ` : `
    <header class="editor-topbar is-empty" data-tauri-drag-region>
      ${focusMode ? `<button class="chrome-icon-button" type="button" data-exit-focus title="Exit focus mode (⌘\\)" aria-label="Exit focus mode">${uiIcon('sidebar', 15)}</button>` : ''}
    </header>
    <div class="empty-editor">
      <h2>Pick a note, or start a fresh page.</h2>
      <p>Everything you write is saved as plain text in your vault.</p>
      <div class="empty-editor-actions">
        <button type="button" class="empty-editor-action is-primary" data-empty-new>${uiIcon('compose', 14)}New note<kbd>⌘N</kbd></button>
        <button type="button" class="empty-editor-action" data-empty-search>${uiIcon('search', 14)}Search<kbd>⌘K</kbd></button>
      </div>
    </div>`;

  editorRoot.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setViewMode(button.dataset.mode as ViewMode));
  });
  editorRoot.querySelector('[data-exit-focus]')?.addEventListener('click', toggleFocusMode);
  editorRoot.querySelector('[data-empty-search]')?.addEventListener('click', () => openPalette());
  editorRoot.querySelectorAll<HTMLButtonElement>('[data-doc-tag]').forEach((button) => {
    button.addEventListener('click', () => selectTag(button.dataset.docTag!));
  });

  editorRoot.querySelector('[data-empty-new]')?.addEventListener('click', createNote);
  paintProperties();
  editorRoot.querySelectorAll<HTMLButtonElement>('[data-journal-day]').forEach((button) => {
    button.addEventListener('click', () => void openJournal(button.dataset.journalDay!));
  });

  document.querySelector('#pin-note')?.addEventListener('click', async () => {
    if (!selectedNote) return;
    selectedNote = await invoke<Note>('star_note', { id: selectedNote.id, starred: !selectedNote.starred });
    await reloadNotes();
    renderEditor();
  });

  bindExportMenu();
  editorRoot.querySelector('#note-history')?.addEventListener('click', () => void showVersionHistory());
  editorRoot.querySelector('#present-note')?.addEventListener('click', () => void presentNote());

  // Keep focus in whichever editor is active when using the dock.
  editorRoot.querySelectorAll<HTMLButtonElement>('.format-dock button').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
  });
  editorRoot.querySelectorAll<HTMLButtonElement>('[data-insert], [data-wrap]').forEach((button) => {
    button.addEventListener('click', () => {
      const openMenu = button.closest<HTMLElement>('.toolbar-menu');
      if (openMenu) {
        openMenu.hidden = true;
        editorRoot.querySelector('#insert-module')?.setAttribute('aria-expanded', 'false');
      }
      if (button.dataset.wrap) {
        const [left, right] = button.dataset.wrap.split('|');
        wrapSelection(left, right);
      } else {
        insertText(button.dataset.insert || '', button.dataset.line === 'true');
      }
    });
  });

  const trigger = editorRoot.querySelector<HTMLButtonElement>('#insert-module');
  const menu = editorRoot.querySelector<HTMLElement>('.toolbar-menu');
  if (trigger && menu) {
    let docClick: ((e: MouseEvent) => void) | null = null;
    let docKey: ((e: KeyboardEvent) => void) | null = null;
    const close = () => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (docClick) document.removeEventListener('click', docClick);
      if (docKey) document.removeEventListener('keydown', docKey);
      docClick = null;
      docKey = null;
    };
    const open = () => {
      const rect = trigger.getBoundingClientRect();
      menu.hidden = false;
      const width = menu.offsetWidth;
      menu.style.left = `${Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8)}px`;
      menu.style.right = 'auto';
      if (rect.top > window.innerHeight / 2) {
        menu.style.top = 'auto';
        menu.style.bottom = `${window.innerHeight - rect.top + 10}px`;
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = `${rect.bottom + 10}px`;
      }
      trigger.setAttribute('aria-expanded', 'true');
      menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
      docClick = (e) => {
        if (!(e.target as Element).closest?.('.toolbar-dropdown')) close();
      };
      docKey = (e) => {
        if (e.key === 'Escape') {
          close();
          trigger.focus();
        }
      };
      document.addEventListener('click', docClick);
      document.addEventListener('keydown', docKey);
    };
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden ? open() : close();
    });
    menu.addEventListener('keydown', (e) => {
      const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      }
    });
  }

  const livePreviewInit = editorRoot.querySelector<HTMLDivElement>('.preview');
  if (livePreviewInit) {
    paintPreview(livePreviewInit);
    attachBlockDrag(livePreviewInit, editorRoot, {
      count: () => previewBlocks.length,
      firstMovable: () => firstMovableBlock(content, previewBlocks),
      prepare: closeBlockEditFor,
      span: moveSpan,
      move: moveBlockTo,
    });
  }

  editorRoot.querySelector('.doc-title')?.addEventListener('click', () => {
    const titleBlock = editorRoot.querySelector<HTMLElement>('.preview .td-block.is-doc-title');
    if (titleBlock) startBlockEdit(titleBlock);
  });

  livePreviewInit?.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  livePreviewInit?.addEventListener('drop', (event) => void dropImagesOnPreview(event, livePreviewInit));

  // While a block is open, a press elsewhere in the preview closes it (and opens
  // the pressed block) before focus moves, so the follow-up click is ignored.
  livePreviewInit?.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement;
    // Reset on every press: the click this flag suppresses may never arrive if
    // the pressed element was re-rendered away.
    suppressPreviewClick = false;
    // Ticking a task in a query block leaves an open block alone.
    if (!blockEdit || target.closest('.td-block-editor, input[data-task-note], .td-query-table, .td-qt-new')) return;
    event.preventDefault();
    suppressPreviewClick = true;
    const hint = textAroundPoint(event.clientX, event.clientY);
    const blockEl = target.closest<HTMLElement>('.td-block');
    if (target.closest('[data-append-block]')) { startAppendBlock(livePreviewInit); return; }
    if (blockEl && !isInteractive(target)) startBlockEdit(blockEl, hint);
    else commitBlockEdit();
  });

  editorRoot.querySelector<HTMLDivElement>('.preview')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (suppressPreviewClick) { suppressPreviewClick = false; return; }
    const queryTask = target.closest<HTMLInputElement>('input[data-task-note]');
    if (queryTask) {
      void toggleQueryTask(queryTask)
        .then(async () => {
          await reloadNotes();
          const preview = editorRoot.querySelector<HTMLElement>('.preview');
          if (preview) await fillQueries(preview, { excludeId: selectedNote?.id ?? null, table: tableActions });
        })
        .catch(async (error) => {
          queryTask.checked = !queryTask.checked;
          await message(String(error), { title: 'Could not update the task', kind: 'warning' });
        });
      return;
    }
    const backlink = target.closest<HTMLElement>('[data-open-note]');
    if (backlink) {
      event.preventDefault();
      void revealNote(backlink.dataset.openNote!);
      return;
    }
    const wikilink = target.closest<HTMLAnchorElement>('.td-wikilink');
    if (wikilink) {
      event.preventDefault();
      void followWikilink(wikilink.dataset.target || '');
      return;
    }
    // Video embeds / external links open in the system browser via the opener
    // plugin, so the WebView never navigates away from the app.
    const embed = target.closest<HTMLElement>('[data-embed-url]');
    if (embed) {
      event.preventDefault();
      const url = embed.getAttribute('data-embed-url');
      if (url) void openUrl(url);
      return;
    }
    const pill = target.closest<HTMLElement>('.td-tag');
    if (pill?.dataset.tag) { selectTag(pill.dataset.tag); return; }
    if (target.matches('.td-task input[type="checkbox"]')) {
      const preview = editorRoot.querySelector<HTMLDivElement>('.preview');
      if (!preview) return;
      const all = Array.from(preview.querySelectorAll<HTMLInputElement>('.td-task input[type="checkbox"]')).filter((box) => !box.closest('.td-transclusion'));
      const idx = all.indexOf(target as HTMLInputElement);
      if (idx >= 0) toggleTaskAt(idx);
      return;
    }
    const previewEl = event.currentTarget as HTMLElement;
    if (target.closest('[data-append-block]')) { startAppendBlock(previewEl); return; }
    if (isInteractive(target)) return;
    // Let people select text to copy without opening the editor.
    if (window.getSelection()?.isCollapsed === false) return;
    const blockEl = target.closest<HTMLElement>('.td-block');
    if (blockEl) startBlockEdit(blockEl, textAroundPoint(event.clientX, event.clientY));
  });

  editorRoot.querySelector('.preview')?.addEventListener('keydown', (event) => {
    const backlink = (event.target as HTMLElement).closest<HTMLElement>('[data-open-note]');
    if (backlink && ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ')) {
      event.preventDefault();
      void revealNote(backlink.dataset.openNote!);
    }
  });

  const source = document.querySelector<HTMLTextAreaElement>('#source');
  if (source) attachEditingAids(source);
  source?.addEventListener('input', () => {
    content = source.value;
    savedMessage = 'Saving…';
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushSave, 500);
    const livePreview = editorRoot.querySelector<HTMLDivElement>('.preview');
    if (livePreview) {
      paintPreview(livePreview);
    }
    renderStatus();
  });
  renderStatus();
}

function isInteractive(target: HTMLElement) {
  return !!target.closest('a, button, input, select, textarea, summary, label, iframe, video, audio, [data-embed-url], .td-tag, .backlinks, .td-query-table, .td-qt-new');
}

const wikilinkOptions = {
  notes: () => libraryNotes,
  currentId: () => selectedNote?.id ?? null,
};

// Popups first: while `[[` suggestions or the `/` menu are open they take
// ↩ and Tab before list editing (and the block editor's own keys) see them.
function attachEditingAids(textarea: HTMLTextAreaElement) {
  attachWikilinkAutocomplete(textarea, wikilinkOptions);
  attachSlashCommands(textarea);
  attachListEditing(textarea);
  attachImageInput(textarea);
  for (const type of ['keyup', 'mouseup', 'input', 'focus']) textarea.addEventListener(type, () => rememberCaret(textarea));
  textarea.addEventListener('tagdown:pick', (event) => {
    const pick = (event as CustomEvent<string>).detail;
    if (pick === 'block-link' || pick === 'block-embed') void copyBlockReference(pick === 'block-embed');
  });
}

let pickingImages = false;

/** Pasting, dropping or picking (`/image`) images adds them as figures below the caret. */
function attachImageInput(textarea: HTMLTextAreaElement) {
  const add = async (files: File[]) => insertFigures(textarea, await saveImages(files));
  textarea.addEventListener('paste', (event) => {
    const files = imageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    void add(files);
  });
  textarea.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  textarea.addEventListener('drop', (event) => {
    const files = imageFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void add(files);
  });
  textarea.addEventListener('tagdown:pick', (event) => {
    if ((event as CustomEvent<string>).detail !== 'image') return;
    pickingImages = true;
    pickImages()
      .then((paths) => insertFigures(textarea, paths))
      .catch((error) => message(String(error), { title: 'Could not add the image', kind: 'warning' }))
      .finally(() => {
        pickingImages = false;
        if (textarea.isConnected) textarea.focus();
      });
  });
}

/** Copy images into the vault; resolves to the paths of those that made it. */
async function saveImages(files: File[]): Promise<string[]> {
  const results = await Promise.allSettled(files.map(saveImage));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length) await message(failed.map((r) => String(r.reason)).join('\n'), { title: 'Could not add the image', kind: 'warning' });
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

const figureBlock = (paths: string[]): SlashCommand => ({ id: 'figure', label: 'Image', description: '', group: 'Media', icon: '', block: paths.map(figureMarkup).join('\n') });

function insertFigures(textarea: HTMLTextAreaElement, paths: string[]) {
  if (!paths.length || !textarea.isConnected) return;
  const caret = textarea.selectionEnd;
  applyEdit(textarea, applyCommand(textarea.value, caret, caret, figureBlock(paths)));
}

/** Images dropped on the preview go below the block they land on. */
async function dropImagesOnPreview(event: DragEvent, preview: HTMLElement) {
  const files = imageFiles(event.dataTransfer);
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  const blockEl = (event.target as HTMLElement).closest<HTMLElement>('.td-block[data-block]');
  const startLine = blockEl ? previewBlocks[Number(blockEl.dataset.block)]?.start : undefined;
  const paths = await saveImages(files);
  if (!paths.length) return;
  if (blockEdit) commitBlockEdit();
  const lines = content.split('\n');
  const block = previewBlocks.find((b) => b.start === startLine);
  let at = block ? block.end : lines.length;
  while (!block && at > 0 && !lines[at - 1].trim()) at--;
  const figures = paths.map(figureMarkup);
  const before = at > 0 && lines[at - 1].trim() ? [''] : [];
  const after = at < lines.length && lines[at].trim() ? [''] : [];
  lines.splice(at, 0, ...before, ...figures, ...after);
  content = lines.join('\n');
  syncSourceTextarea();
  scheduleSave();
  paintPreview(preview);
}

function insertText(text: string, atLineStart = false) {
  if (blockEdit) {
    const textarea = blockEdit.el;
    let start = textarea.selectionStart;
    if (atLineStart) while (start > 0 && textarea.value[start - 1] !== '\n') start--;
    textarea.focus();
    textarea.setRangeText(text, start, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input'));
    return;
  }
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
  if (blockEdit) {
    const textarea = blockEdit.el;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const selected = textarea.value.slice(start, end);
    textarea.focus();
    textarea.setRangeText(left + selected + right, start, end);
    textarea.setSelectionRange(start + left.length, start + left.length + selected.length);
    textarea.dispatchEvent(new Event('input'));
    return;
  }
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

function toggleTaskAt(taskIndex: number) {
  const lines = content.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*[-*]\s+\[)([ xX])(\]\s+.+)$/);
    if (!m) continue;
    if (seen === taskIndex) {
      const next = m[2] === ' ' ? 'x' : ' ';
      lines[i] = m[1] + next + m[3];
      content = lines.join('\n');
      const source = document.querySelector<HTMLTextAreaElement>('#source');
      if (source) source.value = content;
      const livePreview = editorRoot.querySelector<HTMLDivElement>('.preview');
      if (livePreview) {
        paintPreview(livePreview);
      }
      savedMessage = 'Saving…';
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(flushSave, 500);
      renderStatus();
      return;
    }
    seen++;
  }
}

async function flushSave() {
  if (!selectedNote) return;
  selectedNote = await invoke<Note>('save_note', { id: selectedNote.id, content });
  const saved = selectedNote;
  libraryNotes = libraryNotes.map((note) => (note.id === saved.id ? saved : note));
  if (saved.id === linkNoteId && saved.title !== linkTitle) scheduleLinkSync();
  await reloadNotes();
  savedMessage = 'Saved';
  setDocumentTitle(selectedNote.title || 'Untitled');
  // Journal pages are headed by their day, whatever their title says.
  if (!selectedNote.journal) {
    const titleText = selectedNote.title || 'Untitled';
    editorRoot.querySelectorAll('.doc-title, .crumb.is-current').forEach((el) => { el.textContent = titleText; });
  }
  renderStatus();
}

function bindExportMenu() {
  const trigger = editorRoot.querySelector<HTMLButtonElement>('#export-note');
  const menu = editorRoot.querySelector<HTMLElement>('.export-menu');
  if (!trigger || !menu) return;
  const onDocClick = (event: MouseEvent) => {
    if (!(event.target as Element).closest?.('.export-dropdown')) close();
  };
  const onDocKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { close(); trigger.focus(); }
  };
  function close() {
    menu!.hidden = true;
    trigger!.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKey);
  }
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!menu.hidden) return close();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKey);
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(idx + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });
  menu.querySelectorAll<HTMLButtonElement>('[data-export]').forEach((item) => {
    item.addEventListener('click', () => {
      close();
      const kind = item.dataset.export;
      void (kind === 'pdf' ? exportNotePdf() : kind === 'site' ? showPublish() : exportNoteHtml());
    });
  });
}

/** Present the open note as slides, starting from the one the cursor is in. */
async function presentNote() {
  if (!selectedNote) return;
  const source = document.querySelector<HTMLTextAreaElement>('#source');
  const fromLine = blockEdit ? blockEdit.start : source ? content.slice(0, source.selectionStart).split('\n').length - 1 : 0;
  if (blockEdit) commitBlockEdit();
  const noteId = selectedNote.id;
  await startPresentation({
    title: selectedNote.title,
    source: content,
    fromLine,
    theme: getEffectiveTheme(),
    decorate: async (root) => {
      await fillQueries(root, { excludeId: noteId, interactive: false });
      await fillBlockEmbeds(root, (body) => applyExternals(body, getEffectiveTheme()));
    },
  });
}

async function showPublish() {
  await settlePendingWork();
  const folder = folders.find((f) => f.id === selectedFolder && f.id !== 'archive');
  openPublishDialog({
    folders: folders.filter((f) => f.id !== 'archive').map((f) => ({ id: f.id, name: f.name })),
    tags: noteTagPaths().sort(),
    defaultTitle: folder?.name ?? 'My Notes',
    confirm: (title, message, detail, confirmLabel) => confirmDialog({ title, message, detail, confirmLabel }),
  });
}

async function showOpenTasks() {
  await settlePendingWork();
  openTaskList({
    openNote: (id) => revealNote(id),
    afterToggle: () => reloadNotes(),
  });
}

async function showVersionHistory() {
  if (!selectedNote) return;
  if (blockEdit) commitBlockEdit();
  await settlePendingWork();
  const note = selectedNote;
  await openVersionHistory({
    noteId: note.id,
    title: note.title,
    content,
    updatedAt: note.updatedAt,
    restore: async (versionId, label) => {
      const restored = await invoke<Note>('restore_version', { id: note.id, versionId });
      if (selectedNote?.id !== note.id) return;
      selectedNote = restored;
      content = (await invoke<NoteContent>('get_note_content', { id: note.id })).content;
      setDocumentTitle(restored.title || 'Untitled');
      renderEditor();
      await reloadNotes();
      if (restored.title !== linkTitle) scheduleLinkSync();
      void loadBacklinks(note.id);
      savedMessage = `Restored version from ${label}`;
      renderStatus();
    },
  });
}

/** Exports show a snapshot of each query block's current results and embedded block. */
async function exportQueries(root: HTMLElement) {
  invalidateQueries();
  invalidateBlockEmbeds();
  await fillQueries(root, { excludeId: selectedNote?.id ?? null, interactive: false });
  await fillBlockEmbeds(root, (body) => applyExternals(body, 'light'));
}

async function exportNoteHtml() {
  if (!selectedNote) return;
  const title = selectedNote.title || 'Untitled';
  const destPath = await save({
    title: 'Export as HTML',
    defaultPath: exportFileName(title, 'html'),
    filters: [{ name: 'HTML document', extensions: ['html'] }],
  });
  if (!destPath) return;
  try {
    await invoke('export_html', { html: await buildStandaloneHtml(title, content, exportQueries), destPath });
    savedMessage = `Exported ${destPath.split('/').pop()}`;
    renderStatus();
  } catch (err) {
    await message(String(err), { title: 'Export failed', kind: 'error' });
  }
}

async function exportNotePdf() {
  if (!selectedNote) return;
  try {
    await printNote(selectedNote.title || 'Untitled', content, exportQueries);
  } catch (err) {
    await message(String(err), { title: 'Print failed', kind: 'error' });
  }
}

/** A message the status line shows for a few seconds over the save state. */
let notice: { text: string; until: number } | null = null;

function showNotice(text: string) {
  notice = { text, until: Date.now() + 4000 };
  renderStatus();
  window.setTimeout(renderStatus, 4100);
}

function renderStatus() {
  const countsEl = document.querySelector<HTMLSpanElement>('#counts');
  const savedEl = document.querySelector<HTMLSpanElement>('#saved');
  const words = wordCount(content);
  if (countsEl) countsEl.textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`;
  if (!savedEl) return;
  const state = savedMessage === 'Saving…' ? 'saving' : savedMessage === 'Ready' ? 'idle' : 'saved';
  const shown = notice && Date.now() < notice.until ? notice.text : state === 'idle' ? 'Saved to vault' : savedMessage;
  savedEl.className = `save-state is-${state}`;
  savedEl.innerHTML = `<i aria-hidden="true"></i><span>${escapeHtml(shown)}</span>`;
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

function setDocumentTitle(title: string) {
  document.title = title === 'Tagdown Editor' ? title : `${title} — Tagdown`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysAgo(value: string) {
  return Math.round((startOfDay(new Date()) - startOfDay(new Date(value))) / 86_400_000);
}

function dateGroup(value: string) {
  const days = daysAgo(value);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'long', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function monthGroup(day: string) {
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: 'long', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function formatCardDate(value: string) {
  const date = new Date(value);
  const days = daysAgo(value);
  if (days <= 0) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : '2-digit' });
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
