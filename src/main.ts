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
import { propertiesFolded, renderPropertiesPanel, setPropertiesFolded } from './propertiesPanel';
import { showContextMenu, type MenuItem } from './contextMenu';
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
import './styles/workspace.css';

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
  /** The note's file relative to the vault, `/`-separated. */
  path?: string;
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

/** A note type: the `type:` notes give themselves, and its "<Type> Template" note. */
type NoteType = { name: string; icon: string | null; templateId: string | null; count: number };

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
let selectedType: string | null = null;
let noteTypes: NoteType[] = [];
let creatingType = false;
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
// Every note in the vault, archived ones too, as of the last full reload.
const knownNotes = new Map<string, Note>();
let previewBlocks: SourceBlock[] = [];
let suppressPreviewClick = false;
// Links follow a renamed note: for each open note, the title other notes link
// to, and pending syncs (with the title to sync to).
const linkTitles = new Map<string, string>();
const linkSyncs = new Map<string, { timer: number; title: string }>();
// "Linked mentions" for the open note, once loaded.
let backlinks: { id: string; items: Backlink[] } | null = null;
const TAG_PREVIEW_LIMIT = 6;
let tagDraftColor: TagColorKey = 'blue';
// The month the journal calendar shows.
let journalMonth: CalendarMonth = monthOf(todayKey());

initializeTheme();
applyPreferences();

// Images in notes are stored relative to the vault; the open tabs are remembered per vault.
const vaultPath = invoke<string>('vault_path').then((path) => {
  setVaultRoot(path);
  forEachPane(() => {
    const preview = editorRoot.querySelector<HTMLDivElement>('.preview');
    if (preview && !blockEdit) paintPreview(preview);
  });
  return path;
}).catch(() => '');

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
  if (name === 'hiddenProperties' || name === 'propertiesFold') forEachPane(() => paintProperties());
  if (name !== 'spellcheck') return;
  document.querySelectorAll<HTMLTextAreaElement>('#source, .td-block-editor').forEach((textarea) => {
    textarea.spellcheck = getPreference('spellcheck');
  });
});

// Re-render the live preview when the user toggles dark/light so KaTeX and
// Mermaid pick up the new theme. Other DOM is theme-agnostic via CSS variables.
onThemePreferenceChange(() => forEachPane(() => {
  const lp = editorRoot.querySelector<HTMLDivElement>('.preview');
  if (!lp) return;
  if (blockEdit) commitBlockEdit();
  else paintPreview(lp);
}));

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
        <h2 class="section-header"><span>Types</span><button id="new-type" class="section-add" type="button" title="New note type" aria-label="New note type">${uiIcon('plus', 13)}</button></h2>
        <div id="types"></div>
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
    <section class="editor-pane"><div class="workspace" id="workspace"></div></section>
  </main>
`;

const folderEl = document.querySelector<HTMLDivElement>('#folders')!;
const noteEl = document.querySelector<HTMLDivElement>('#notes')!;
const tagEl = document.querySelector<HTMLDivElement>('#tags')!;
const typeEl = document.querySelector<HTMLDivElement>('#types')!;
const workspaceEl = document.querySelector<HTMLDivElement>('#workspace')!;
// The open pane's editor; see "Panes and tabs".
let editorRoot: HTMLDivElement;
const noteListTitleEl = document.querySelector<HTMLHeadingElement>('#note-list-title')!;
const noteListCountEl = document.querySelector<HTMLSpanElement>('#note-list-count')!;
const scopeIconEl = document.querySelector<HTMLSpanElement>('.scope-icon')!;
const tagCountEl = document.querySelector<HTMLSpanElement>('#tag-count')!;

async function boot() {
  initSettings();
  activePane = createPane();
  panes = [activePane];
  load(activePane);
  layoutPanes();
  bindChrome();
  await reloadFolders();
  await reloadTags();
  await reloadNotes();
  renderFilterPills();
  await openStartupNote();
  await listen('note-saved', () => { savedMessage = 'Saved'; renderStatus(); });
  await listen<{ note: Note; content: string }>('note-changed-externally', (event) => void onExternalChange(event.payload.note, event.payload.content));
  await listen<{ id: string }>('note-removed-externally', (event) => onExternalRemoval(event.payload.id));
  // Folders are directories: ones made, renamed or removed in Finder show up here.
  await listen('folders-changed-externally', scheduleListRefresh);
  // The app menu's File → New Tab / Close Tab (⌘T / ⌘W never reach the page).
  await listen<string>('menu', (event) => void runMenuCommand(event.payload));
}

async function runMenuCommand(id: string) {
  // Not behind an open dialog (the palette, Settings, a confirmation).
  if (document.querySelector('dialog[open]')) return;
  if (id === 'new-tab') await newTab();
  else if (id === 'close-tab') await closeTab(activePane, activePane.active);
}

/** Run a folder change on disk; tell the user when it can't be done (a name taken, say). */
async function folderAction(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    await message(String(error), { title: 'Couldn’t change the folder', kind: 'warning' });
    await reloadFolders();
    return false;
  }
}

/** Open what Settings → General → "On launch" asks for. */
async function openStartupNote() {
  workspaceVault = await vaultPath;
  const startup = getPreference('startupOpen');
  if (startup === 'journal') {
    await openJournal(todayKey());
    return;
  }
  if (startup === 'last' && await restoreWorkspace()) return;
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
  knownNotes.set(note.id, note);
  if (linkTitles.has(note.id) && !linkSyncs.has(note.id)) linkTitles.set(note.id, note.title);
  // Panes in the background never hold unsaved edits: take the disk version.
  for (const pane of panes) {
    if (pane === activePane) continue;
    withPane(pane, () => {
      if (!selectedNote) return;
      if (selectedNote.id !== note.id) { void loadBacklinks(selectedNote.id); return; }
      const propertiesChanged = JSON.stringify(note.properties ?? []) !== JSON.stringify(selectedNote.properties ?? []);
      selectedNote = note;
      if (diskContent !== content) showDiskContent(diskContent);
      else if (propertiesChanged) paintProperties();
    });
  }
  paintAllTabs();
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
  showDiskContent(diskContent);
  savedMessage = 'Reloaded from disk';
  renderStatus();
}

/** Swap in new content for the open note, keeping scroll and caret where they were. */
function showDiskContent(next: string) {
  const source = editorRoot.querySelector<HTMLTextAreaElement>('#source');
  const caret = source && document.activeElement === source ? [source.selectionStart, source.selectionEnd] : null;
  const sourceScroll = source?.scrollTop ?? 0;
  const previewScroll = editorRoot.querySelector('.preview')?.scrollTop ?? 0;
  content = next;
  setDocumentTitle(selectedNote?.title || 'Untitled');
  renderEditor();
  const nextSource = editorRoot.querySelector<HTMLTextAreaElement>('#source');
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
  document.querySelector('#new-type')?.addEventListener('click', () => {
    creatingType = true;
    renderTypes();
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
    // Tabs and splits.
    if (event.metaKey && event.altKey && event.code === 'Backslash') { event.preventDefault(); await splitPane(selectedNote); return; }
    if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 't') { event.preventDefault(); await newTab(); return; }
    if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'w') { event.preventDefault(); await closeTab(activePane, activePane.active); return; }
    if (event.ctrlKey && !event.metaKey && event.key === 'Tab') { event.preventDefault(); await cycleTab(event.shiftKey ? -1 : 1); return; }
    if (event.metaKey && event.shiftKey && (event.code === 'BracketLeft' || event.code === 'BracketRight')) { event.preventDefault(); await cycleTab(event.code === 'BracketLeft' ? -1 : 1); return; }
    if (event.metaKey && event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); focusPane(event.key === 'ArrowLeft' ? -1 : 1); return; }
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'i') { event.preventDefault(); toggleProperties(); return; }
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
  saveWorkspace();
}

function toggleFocusMode() {
  focusMode = !focusMode;
  app.classList.toggle('is-focus', focusMode);
  const collapse = document.querySelector<HTMLButtonElement>('#sidebar-collapse');
  collapse?.setAttribute('aria-pressed', String(focusMode));
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
    { id: 'new', label: selectedType ? `New ${selectedType}` : 'New note', hint: isUserFolder(selectedFolder) ? `in ${folders.find((f) => f.id === selectedFolder)?.name ?? 'folder'}` : undefined, shortcut: '⌘N', icon: uiIcon('compose', 15), run: createNote },
    ...noteTypes.filter((t) => t.name !== selectedType).map((t) => (
      { id: `new-type-${t.name}`, label: `New ${t.name}`, hint: t.templateId ? `From “${t.name} Template”` : 'A note of this type', icon: typeIconHtml(t, 15), run: () => createTypedNote(t.name) }
    )),
    { id: 'new-note-type', label: 'New note type…', hint: 'Like Book or Person, with a template', icon: uiIcon('type', 15), run: () => { creatingType = true; renderTypes(); } },
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
    { id: 'new-tab', label: 'New tab', shortcut: '⌘T', icon: uiIcon('plus', 15), run: newTab },
    { id: 'close-tab', label: 'Close tab', shortcut: '⌘W', icon: uiIcon('close', 15), run: () => closeTab(activePane, activePane.active) },
    ...(activePane.tabs.length > 1 ? [
      { id: 'next-tab', label: 'Next tab', shortcut: '⌃⇥', icon: uiIcon('chevronRight', 15), run: () => cycleTab(1) },
      { id: 'previous-tab', label: 'Previous tab', shortcut: '⌃⇧⇥', icon: uiIcon('chevronLeft', 15), run: () => cycleTab(-1) },
    ] : []),
    { id: 'split-right', label: 'Split right', hint: selectedNote ? 'This note again, side by side' : 'An empty pane beside this one', shortcut: '⌥⌘\\', icon: uiIcon('splitRight', 15), run: () => splitPane(selectedNote) },
    ...(panes.length > 1 ? [
      { id: 'close-pane', label: 'Close this pane', hint: 'Its tabs close with it', icon: uiIcon('split', 15), run: () => closePane(activePane) },
      { id: 'focus-pane-next', label: 'Focus the pane to the right', shortcut: '⌃⌘→', icon: uiIcon('chevronRight', 15), run: () => focusPane(1) },
      { id: 'focus-pane-previous', label: 'Focus the pane to the left', shortcut: '⌃⌘←', icon: uiIcon('chevronLeft', 15), run: () => focusPane(-1) },
    ] : []),
    ...(selectedNote?.properties?.length ? [
      { id: 'fold-properties', label: propertiesAreFolded() ? 'Show properties' : 'Fold properties', hint: 'Fold them to one line, or open them up', shortcut: '⌘⇧I', icon: uiIcon('sliders', 15), run: toggleProperties },
    ] : []),
    ...(getPreference('hiddenProperties').length ? [
      { id: 'unhide-properties', label: 'Show all hidden properties again', hint: getPreference('hiddenProperties').join(', '), icon: uiIcon('eye', 15), run: () => setPreference('hiddenProperties', []) },
    ] : []),
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
    openNote: (id, where) => revealNote(id, where),
  });
}

/** Open a note from anywhere, widening the note list if it isn't in view. */
async function revealNote(id: string, where: OpenTarget = 'here') {
  const all = await invoke<Note[]>('list_notes', { folderId: null, sort: 'updatedDesc' satisfies SortOrder });
  const note = all.find((candidate) => candidate.id === id);
  if (!note) return;
  if (!notes.some((candidate) => candidate.id === id)) {
    selectedFolder = note.folderId === 'archive' ? 'archive' : note.journal ? 'journal' : null;
    selectedTag = null;
    selectedType = null;
    activeFilter = 'all';
    renderFilterPills();
    await reloadNotes();
  }
  await openNote(note, where);
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
  if (selectedType) { await createTypedNote(selectedType); return; }
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

// ---- Panes and tabs ----
//
// The editor area holds up to four panes side by side, each with its own tabs.
// The editor state of the active pane (its note, text, open block, save
// timer…) lives in the module variables above; every other pane keeps its own
// in `pane.state` until it becomes active. `withPane` swaps a background pane
// in for one synchronous moment, so the usual render functions repaint it.

type OpenTarget = 'here' | 'tab' | 'split';
type Tab = { noteId: string | null; title: string; scroll?: [number, number] };
type PaneEditor = {
  note: Note | null;
  content: string;
  viewMode: ViewMode;
  blockEdit: BlockEdit | null;
  previewBlocks: SourceBlock[];
  suppressPreviewClick: boolean;
  backlinks: { id: string; items: Backlink[] } | null;
  saveTimer: number | undefined;
  savedMessage: string;
  caretLine: number | null;
  notice: { text: string; until: number } | null;
};
type Pane = { id: number; el: HTMLElement; root: HTMLDivElement; tabs: Tab[]; active: number; size: number; state: PaneEditor };

const MAX_PANES = 4;
const MIN_PANE_WIDTH = 300;
const NOTE_MIME = 'application/x-tagdown-note';
let panes: Pane[] = [];
let activePane: Pane;
let paneIds = 0;
// While a background pane is swapped in, focus moving into it must not activate it.
let swapping = 0;
// The tab being dragged, if a drag started on a tab rather than a note card.
let draggedTab: { pane: Pane; index: number } | null = null;

const blankTab = (): Tab => ({ noteId: null, title: 'New tab' });

/** ⌘-click opens in a new tab, ⌥⌘-click in a split beside this one. */
function openTarget(event: MouseEvent | KeyboardEvent): OpenTarget {
  return event.metaKey ? (event.altKey ? 'split' : 'tab') : 'here';
}

function createPane(mode: ViewMode = viewMode): Pane {
  const el = document.createElement('div');
  el.className = 'pane';
  const root = document.createElement('div');
  root.className = 'editor-root';
  el.append(root);
  const pane: Pane = {
    id: ++paneIds, el, root, tabs: [blankTab()], active: 0, size: 1,
    state: {
      note: null, content: '', viewMode: mode, blockEdit: null, previewBlocks: [], suppressPreviewClick: false,
      backlinks: null, saveTimer: undefined, savedMessage: 'Ready', caretLine: null, notice: null,
    },
  };
  // Pressing or focusing anything in a pane makes it the one keys, the palette and the note list act on.
  el.addEventListener('mousedown', () => activatePane(pane), true);
  el.addEventListener('focusin', () => activatePane(pane), true);
  bindPaneDrop(pane);
  return pane;
}

function stash(pane: Pane) {
  pane.state = { note: selectedNote, content, viewMode, blockEdit, previewBlocks, suppressPreviewClick, backlinks, saveTimer, savedMessage, caretLine, notice };
}

function load(pane: Pane) {
  ({ note: selectedNote, content, viewMode, blockEdit, previewBlocks, suppressPreviewClick, backlinks, saveTimer, savedMessage, caretLine, notice } = pane.state);
  editorRoot = pane.root;
}

/** Run `work` with `pane`'s editor state swapped in. `work` must not await. */
function withPane<T>(pane: Pane, work: () => T): T {
  if (pane === activePane) return work();
  const current = activePane;
  stash(current);
  load(pane);
  activePane = pane;
  swapping++;
  try {
    return work();
  } finally {
    swapping--;
    stash(pane);
    load(current);
    activePane = current;
  }
}

function forEachPane(work: () => void) {
  for (const pane of [...panes]) withPane(pane, work);
}

function activatePane(pane: Pane) {
  if (pane === activePane || swapping || !panes.includes(pane)) return;
  // Leave the pane with nothing pending: background panes never hold unsaved edits.
  if (blockEdit) commitBlockEdit();
  if (saveTimer !== undefined) void flushSave();
  stash(activePane);
  load(pane);
  activePane = pane;
  markActivePane();
  setDocumentTitle(selectedNote ? selectedNote.title || 'Untitled' : 'Tagdown Editor');
  renderNotes();
  saveWorkspace();
}

function markActivePane() {
  workspaceEl.classList.toggle('has-splits', panes.length > 1);
  for (const pane of panes) pane.el.classList.toggle('is-active', pane === activePane);
}

function layoutPanes() {
  const children: HTMLElement[] = [];
  panes.forEach((pane, index) => {
    if (index) children.push(paneDivider(panes[index - 1], pane));
    pane.el.style.flex = `${pane.size} 1 0`;
    children.push(pane.el);
  });
  // Re-adding a pane that's already in place would reload its embeds; skip those.
  workspaceEl.querySelectorAll(':scope > .pane-divider').forEach((bar) => bar.remove());
  for (const child of [...workspaceEl.children]) if (!children.includes(child as HTMLElement)) child.remove();
  children.forEach((child, index) => {
    if (workspaceEl.children[index] !== child) workspaceEl.insertBefore(child, workspaceEl.children[index] ?? null);
  });
  markActivePane();
}

/** The bar between two panes: drag to resize, double-click to even them out. */
function paneDivider(left: Pane, right: Pane): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'pane-divider';
  bar.setAttribute('role', 'separator');
  bar.setAttribute('aria-orientation', 'vertical');
  bar.title = 'Drag to resize · double-click to even out';
  bar.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    bar.setPointerCapture(event.pointerId);
    const a = left.el.getBoundingClientRect();
    const total = a.width + right.el.getBoundingClientRect().width;
    const sizes = left.size + right.size;
    bar.classList.add('is-dragging');
    document.body.classList.add('is-resizing-panes');
    const move = (e: PointerEvent) => {
      const width = Math.max(Math.min(e.clientX - a.left, total - MIN_PANE_WIDTH), Math.min(MIN_PANE_WIDTH, total / 2));
      left.size = (sizes * width) / total;
      right.size = sizes - left.size;
      left.el.style.flex = `${left.size} 1 0`;
      right.el.style.flex = `${right.size} 1 0`;
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      bar.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-panes');
      saveWorkspace();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
  bar.addEventListener('dblclick', () => {
    for (const pane of panes) { pane.size = 1; pane.el.style.flex = '1 1 0'; }
    saveWorkspace();
  });
  return bar;
}

/** Open a new pane beside `from`, showing `note` (or a new tab). */
async function splitPane(note: Note | null = null, side: 'left' | 'right' = 'right', from: Pane = activePane) {
  if (!panes.includes(from)) from = activePane;
  if (panes.length >= MAX_PANES) {
    // No room for another: use the pane beside instead.
    const at = panes.indexOf(from);
    const step = side === 'right' ? 1 : -1;
    const neighbour = panes[at + step] ?? panes[at - step];
    activatePane(neighbour);
    if (note) await openNote(note, 'tab');
    showNotice(`${MAX_PANES} panes is the most; opened it in a tab here`);
    return;
  }
  activatePane(from);
  await settlePendingWork();
  // Two source-and-preview splits side by side would be four columns; the new one starts as a preview.
  const pane = createPane(viewMode === 'split' ? 'preview' : viewMode);
  from.size /= 2;
  pane.size = from.size;
  panes.splice(panes.indexOf(from) + (side === 'right' ? 1 : 0), 0, pane);
  layoutPanes();
  activatePane(pane);
  renderEditor();
  if (note) await openNote(note);
  else { saveWorkspace(); openPalette(); }
}

async function closePane(pane: Pane) {
  if (panes.length < 2 || !panes.includes(pane)) return;
  if (pane === activePane) await settlePendingWork();
  const index = panes.indexOf(pane);
  const neighbour = panes[index - 1] ?? panes[index + 1];
  activatePane(neighbour);
  neighbour.size += pane.size;
  panes.splice(index, 1);
  layoutPanes();
  saveWorkspace();
}

/** ⌃⌘← / ⌃⌘→: move to the pane on that side. */
function focusPane(step: -1 | 1) {
  const next = panes[panes.indexOf(activePane) + step];
  if (!next) return;
  activatePane(next);
  (next.root.querySelector<HTMLElement>('#source') ?? next.root.querySelector<HTMLElement>('.tab.is-current'))?.focus({ preventScroll: true });
}

/** ⌘T: a new tab, with the palette open to pick what goes in it. */
async function newTab(pane: Pane = activePane) {
  activatePane(pane);
  if (pane.tabs[pane.active]?.noteId) {
    await settlePendingWork();
    rememberScroll(pane);
    pane.tabs.splice(++pane.active, 0, blankTab());
    await displayTab(pane);
  }
  openPalette();
}

async function closeTab(pane: Pane, index: number) {
  if (!panes.includes(pane) || !pane.tabs[index]) return;
  activatePane(pane);
  const shown = index === pane.active;
  if (shown) {
    if (blockEdit) commitBlockEdit();
    await settlePendingWork();
  }
  if (pane.tabs.length === 1) {
    if (panes.length > 1) { await closePane(pane); return; }
    if (!pane.tabs[0].noteId) return;
    pane.tabs[0] = blankTab();
    await displayTab(pane);
    return;
  }
  pane.tabs.splice(index, 1);
  if (index < pane.active) pane.active--;
  else if (shown) pane.active = Math.min(index, pane.tabs.length - 1);
  if (shown) await displayTab(pane);
  else { paintTabs(pane); saveWorkspace(); }
}

async function closeOtherTabs(pane: Pane, keep: number) {
  activatePane(pane);
  const tab = pane.tabs[keep];
  if (keep !== pane.active) await switchTab(pane, keep);
  pane.tabs = [tab];
  pane.active = 0;
  paintTabs(pane);
  saveWorkspace();
}

async function closeTabsToRight(pane: Pane, index: number) {
  activatePane(pane);
  if (pane.active > index) await switchTab(pane, index);
  pane.tabs.splice(index + 1);
  paintTabs(pane);
  saveWorkspace();
}

async function cycleTab(step: -1 | 1) {
  const pane = activePane;
  const count = pane.tabs.length;
  if (count > 1) await switchTab(pane, (pane.active + step + count) % count);
}

async function switchTab(pane: Pane, index: number) {
  activatePane(pane);
  if (index === pane.active || !pane.tabs[index]) return;
  if (blockEdit) commitBlockEdit();
  await settlePendingWork();
  rememberScroll(pane);
  pane.active = index;
  paintTabs(pane);
  await displayTab(pane);
}

async function findNote(id: string): Promise<Note | null> {
  const known = knownNotes.get(id);
  if (known) return known;
  const all = await invoke<Note[]>('list_notes', { folderId: null, sort: 'updatedDesc' satisfies SortOrder });
  for (const note of all) knownNotes.set(note.id, note);
  return knownNotes.get(id) ?? null;
}

/** Show `pane`'s current tab: fetch its note and draw it. Works on panes in the background too. */
async function displayTab(pane: Pane, fresh?: Note) {
  const tab = pane.tabs[pane.active];
  let note = tab?.noteId ? fresh ?? await findNote(tab.noteId) : null;
  let text = '';
  if (note) {
    try {
      text = (await invoke<NoteContent>('get_note_content', { id: note.id })).content;
    } catch {
      note = null; // gone in the meantime
    }
  }
  if (!panes.includes(pane) || pane.tabs[pane.active] !== tab) return;
  if (!note) Object.assign(tab, blankTab());
  // Inside withPane the swapped-in pane is always the "active" one; ask before.
  const isActive = pane === activePane;
  withPane(pane, () => {
    selectedNote = note;
    content = text;
    backlinks = null;
    if (note) {
      tab.title = tabTitleOf(note);
      if (!linkSyncs.has(note.id)) linkTitles.set(note.id, note.title);
    }
    if (isActive) {
      setDocumentTitle(note ? note.title || 'Untitled' : 'Tagdown Editor');
      if (note) setPreference('lastNoteId', note.id);
    }
    renderEditor();
    restoreScroll(pane, tab);
    if (note) void loadBacklinks(note.id);
  });
  if (isActive) renderNotes();
  saveWorkspace();
}

function rememberScroll(pane: Pane) {
  const tab = pane.tabs[pane.active];
  if (!tab?.noteId) return;
  tab.scroll = [pane.root.querySelector('#source')?.scrollTop ?? 0, pane.root.querySelector('.preview')?.scrollTop ?? 0];
}

function restoreScroll(pane: Pane, tab: Tab) {
  if (!tab.scroll) return;
  const [source, preview] = tab.scroll;
  const apply = () => {
    const sourceEl = pane.root.querySelector('#source');
    const previewEl = pane.root.querySelector('.preview');
    if (sourceEl) sourceEl.scrollTop = source;
    if (previewEl) previewEl.scrollTop = preview;
  };
  apply();
  // Diagrams and images grow the preview after the first paint.
  requestAnimationFrame(apply);
}

function tabTitleOf(note: Note) {
  return note.journal ? formatDay(note.journal, 'short') : note.title || 'Untitled';
}

function openNoteIds() {
  return new Set(panes.flatMap((pane) => pane.tabs.flatMap((tab) => (tab.noteId ? [tab.noteId] : []))));
}

function paintAllTabs() {
  for (const pane of panes) paintTabs(pane);
}

function paintTabs(pane: Pane) {
  const strip = pane.root.querySelector<HTMLElement>('[data-tabs]');
  if (!strip) return;
  const lone = pane.tabs.length === 1 && !pane.tabs[0].noteId;
  strip.innerHTML = pane.tabs.map((tab, index) => {
    const note = tab.noteId ? knownNotes.get(tab.noteId) : null;
    const title = note ? tabTitleOf(note) : tab.title;
    const current = index === pane.active;
    const folder = note ? folders.find((f) => f.id === note.folderId)?.name : null;
    const tip = tab.noteId ? `${title}${folder ? ` · ${folder}` : ''}` : 'New tab: find a note with ⌘K';
    const icon = !tab.noteId ? uiIcon('search', 12) : iconSvg(note?.journal ? 'calendar' : 'notes', 12);
    return `<div class="tab ${current ? 'is-current' : ''} ${tab.noteId ? '' : 'is-blank'}" role="tab" aria-selected="${current}" tabindex="${current ? 0 : -1}" draggable="${tab.noteId ? 'true' : 'false'}" data-tab="${index}" title="${escapeHtml(tip)}">
      <span class="tab-icon" aria-hidden="true">${icon}</span><span class="tab-title">${escapeHtml(title)}</span>
      ${lone ? '' : `<button type="button" class="tab-close" data-close-tab="${index}" tabindex="-1" title="Close tab (⌘W)" aria-label="Close ${escapeHtml(title)}">${uiIcon('close', 10)}</button>`}
    </div>`;
  }).join('');
  strip.querySelectorAll<HTMLElement>('.tab').forEach((el) => {
    const index = Number(el.dataset.tab);
    el.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('.tab-close')) void switchTab(pane, index);
    });
    el.addEventListener('auxclick', (event) => {
      if (event.button === 1) { event.preventDefault(); void closeTab(pane, index); }
    });
    el.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
        if (pane.tabs[next]) void switchTab(pane, next).then(() => pane.root.querySelector<HTMLElement>('.tab.is-current')?.focus());
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void switchTab(pane, index);
      }
    });
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, tabMenuItems(pane, index));
    });
    el.addEventListener('dragstart', (event) => {
      const tab = pane.tabs[index];
      const note = tab?.noteId ? knownNotes.get(tab.noteId) : null;
      if (!note || !event.dataTransfer) { event.preventDefault(); return; }
      startNoteDrag(event.dataTransfer, note);
      draggedTab = { pane, index };
      el.classList.add('is-dragging');
    });
  });
  strip.querySelectorAll<HTMLButtonElement>('[data-close-tab]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void closeTab(pane, Number(button.dataset.closeTab));
    });
  });
  // Keep the current tab in view when there are more than fit.
  const current = strip.querySelector<HTMLElement>('.tab.is-current');
  if (current) {
    const left = current.offsetLeft;
    const right = left + current.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }
}

/** Drops on the tab strip: reorder, bring a tab over from another pane, or open a dragged note. */
function bindTabStrip(pane: Pane) {
  const strip = pane.root.querySelector<HTMLElement>('[data-tabs]');
  if (!strip) return;
  const dropIndex = (x: number) => {
    const tabs = [...strip.querySelectorAll<HTMLElement>('.tab')];
    const index = tabs.findIndex((tab) => { const r = tab.getBoundingClientRect(); return x < r.left + r.width / 2; });
    return index < 0 ? tabs.length : index;
  };
  strip.addEventListener('wheel', (event) => {
    // A mouse wheel scrolls a crowded strip sideways.
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) strip.scrollLeft += event.deltaY;
  }, { passive: true });
  strip.addEventListener('dragover', (event) => {
    if (!isNoteDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    hidePaneDrops();
    event.dataTransfer!.dropEffect = draggedTab ? 'move' : 'copy';
    const at = dropIndex(event.clientX);
    const tabs = strip.querySelectorAll<HTMLElement>('.tab');
    tabs.forEach((tab, index) => {
      tab.classList.toggle('drop-before', index === at);
      tab.classList.toggle('drop-after', at === tabs.length && index === tabs.length - 1);
    });
  });
  strip.addEventListener('dragleave', (event) => {
    if (!strip.contains(event.relatedTarget as Node)) clearDropMarks();
  });
  strip.addEventListener('drop', (event) => {
    if (!isNoteDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const at = dropIndex(event.clientX);
    clearDropMarks();
    void dropNote(event.dataTransfer!, pane, 'center', at);
  });
}

function isNoteDrag(event: DragEvent) {
  return !!event.dataTransfer?.types.includes(NOTE_MIME);
}

function startNoteDrag(data: DataTransfer, note: Note) {
  draggedTab = null;
  data.effectAllowed = 'copyMove';
  data.setData(NOTE_MIME, note.id);
  // Dropped into another app (or a text field), it's a link to the note.
  data.setData('text/plain', `[[${note.title || 'Untitled'}]]`);
  document.addEventListener('dragend', () => {
    draggedTab = null;
    clearDropMarks();
    document.querySelectorAll('.tab.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
  }, { once: true });
}

function hidePaneDrops() {
  document.querySelectorAll<HTMLElement>('.pane-drop').forEach((overlay) => { overlay.hidden = true; });
}

function clearDropMarks() {
  hidePaneDrops();
  document.querySelectorAll('.tab.drop-before, .tab.drop-after').forEach((tab) => tab.classList.remove('drop-before', 'drop-after'));
}

/** Dragging a note or tab over a pane: the middle opens it here, the sides split. */
function bindPaneDrop(pane: Pane) {
  const overlay = document.createElement('div');
  overlay.className = 'pane-drop';
  overlay.hidden = true;
  overlay.innerHTML = '<div class="pane-drop-zone"><span></span></div>';
  pane.el.append(overlay);
  const label = overlay.querySelector('span')!;
  const zoneAt = (event: DragEvent): 'left' | 'center' | 'right' => {
    const rect = pane.el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    return x < 0.3 ? 'left' : x > 0.7 ? 'right' : 'center';
  };
  pane.el.addEventListener('dragover', (event) => {
    if (!isNoteDrag(event)) return;
    event.preventDefault();
    const zone = zoneAt(event);
    const fromHere = draggedTab?.pane === pane;
    const nothing = fromHere && (zone === 'center' || pane.tabs.length === 1);
    event.dataTransfer!.dropEffect = nothing ? 'none' : draggedTab ? 'move' : 'copy';
    overlay.hidden = nothing;
    overlay.dataset.zone = zone;
    label.textContent = zone === 'center' ? 'Open in a tab here' : panes.length >= MAX_PANES ? 'Open in the pane beside' : `Split ${zone}`;
  });
  pane.el.addEventListener('dragleave', (event) => {
    if (!pane.el.contains(event.relatedTarget as Node)) overlay.hidden = true;
  });
  pane.el.addEventListener('drop', (event) => {
    if (!isNoteDrag(event)) return;
    event.preventDefault();
    clearDropMarks();
    void dropNote(event.dataTransfer!, pane, zoneAt(event));
  });
}

/** A note or tab dropped on `target`: into its tabs (at `at`), or into a new split on one side. */
async function dropNote(data: DataTransfer, target: Pane, zone: 'left' | 'center' | 'right', at?: number) {
  const source = draggedTab;
  draggedTab = null;
  const id = data.getData(NOTE_MIME);
  const note = id ? await findNote(id) : null;
  if (!note) return;
  if (source && source.pane === target) {
    if (zone === 'center') {
      if (at !== undefined) moveTabWithin(target, source.index, at);
      return;
    }
    if (target.tabs.length === 1) return;
  }
  // A tab moves; a note card opens a copy.
  if (source) await closeTab(source.pane, source.index);
  if (!panes.includes(target)) target = activePane;
  if (zone !== 'center') { await splitPane(note, zone, target); return; }
  activatePane(target);
  await settlePendingWork();
  rememberScroll(target);
  const existing = target.tabs.findIndex((tab) => tab.noteId === note.id);
  if (existing >= 0) target.active = existing;
  else if (!target.tabs[target.active]?.noteId) target.tabs[target.active] = { noteId: note.id, title: tabTitleOf(note) };
  else {
    const index = Math.min(at ?? target.active + 1, target.tabs.length);
    target.tabs.splice(index, 0, { noteId: note.id, title: tabTitleOf(note) });
    target.active = index;
  }
  await displayTab(target, note);
}

function moveTabWithin(pane: Pane, from: number, to: number) {
  const current = pane.tabs[pane.active];
  const [tab] = pane.tabs.splice(from, 1);
  pane.tabs.splice(to > from ? to - 1 : to, 0, tab);
  pane.active = pane.tabs.indexOf(current);
  paintTabs(pane);
  saveWorkspace();
}

function tabMenuItems(pane: Pane, index: number): MenuItem[] {
  const tab = pane.tabs[index];
  const note = tab?.noteId ? knownNotes.get(tab.noteId) ?? null : null;
  const items: MenuItem[] = [
    { label: 'Close tab', icon: uiIcon('close', 14), shortcut: '⌘W', run: () => closeTab(pane, index) },
    { label: 'Close other tabs', icon: uiIcon('close', 14), disabled: pane.tabs.length < 2, run: () => closeOtherTabs(pane, index) },
    { label: 'Close tabs to the right', icon: uiIcon('close', 14), disabled: index >= pane.tabs.length - 1, run: () => closeTabsToRight(pane, index) },
  ];
  if (note) {
    items.push(
      'separator',
      { label: 'Open in a pane to the right', icon: uiIcon('splitRight', 14), shortcut: '⌥⌘\\', run: () => splitPane(note, 'right', pane) },
      {
        label: 'Move to a new pane', icon: uiIcon('split', 14), disabled: pane.tabs.length < 2,
        run: async () => { await closeTab(pane, index); await splitPane(note, 'right', pane); },
      },
      'separator',
      ...noteActionItems(note),
    );
  }
  if (panes.length > 1) items.push('separator', { label: 'Close this pane', icon: uiIcon('close', 14), run: () => closePane(pane) });
  return items;
}

/** Right-click on a note card: where to open it. */
function openMenuItems(note: Note): MenuItem[] {
  return [
    { label: 'Open', icon: uiIcon('eye', 14), run: () => openNote(note) },
    { label: 'Open in new tab', icon: uiIcon('plus', 14), shortcut: '⌘-click', run: () => openNote(note, 'tab') },
    { label: 'Open to the right', icon: uiIcon('splitRight', 14), shortcut: '⌥⌘-click', run: () => openNote(note, 'split') },
    'separator',
    ...noteActionItems(note),
  ];
}

function noteActionItems(note: Note): MenuItem[] {
  return [
    {
      label: 'Copy link', icon: uiIcon('share', 14),
      run: async () => {
        const link = `[[${note.title || 'Untitled'}]]`;
        await copyText(link);
        showNotice(`Copied ${link}`);
      },
    },
    { label: 'Show in note list', icon: iconSvg('notes', 14), run: () => revealInList(note.id) },
  ];
}

/** Widen the note list to show the note, without opening it. */
async function revealInList(id: string) {
  const note = await findNote(id);
  if (!note) return;
  if (!notes.some((candidate) => candidate.id === id)) {
    selectedFolder = note.folderId === 'archive' ? 'archive' : note.journal ? 'journal' : note.folderId;
    selectedTag = null;
    selectedType = null;
    activeFilter = 'all';
    renderFilterPills();
    await reloadNotes();
  }
  const card = document.querySelector<HTMLElement>(`.note-card[data-note="${CSS.escape(id)}"]`);
  card?.scrollIntoView({ block: 'nearest' });
  card?.focus({ preventScroll: true });
}

/** Close every tab showing `id` (it's being archived or deleted). */
async function closeNoteEverywhere(id: string) {
  const back = activePane;
  for (const pane of [...panes]) {
    for (let index = pane.tabs.length - 1; index >= 0; index--) {
      if (pane.tabs[index]?.noteId === id) await closeTab(pane, index);
    }
  }
  if (panes.includes(back)) activatePane(back);
}

/** After a full reload: drop tabs whose note is gone (deleted outside the app, say). */
function closeMissingTabs() {
  let changed = false;
  for (const pane of panes) {
    const shown = pane.tabs[pane.active];
    const kept = pane.tabs.filter((tab) => !tab.noteId || knownNotes.has(tab.noteId));
    if (kept.length === pane.tabs.length) continue;
    changed = true;
    if (!kept.length) kept.push(blankTab());
    pane.tabs = kept;
    if (kept.includes(shown)) {
      pane.active = kept.indexOf(shown);
      paintTabs(pane);
      continue;
    }
    pane.active = Math.min(pane.active, kept.length - 1);
    // The note on screen is gone: there's nothing left to save into.
    withPane(pane, () => { window.clearTimeout(saveTimer); saveTimer = undefined; savedMessage = 'Ready'; });
    void displayTab(pane);
  }
  if (changed) saveWorkspace();
}

/** The new-tab page: the latest notes that aren't open yet. */
function recentNotesHtml() {
  const open = openNoteIds();
  const recent = libraryNotes.filter((note) => !open.has(note.id)).slice(0, 6);
  if (!recent.length) return '';
  return `
      <div class="empty-recent">
        <h3>Recent</h3>
        ${recent.map((note) => `<button type="button" class="empty-recent-row" data-recent="${escapeHtml(note.id)}" title="⌘-click: new tab · ⌥⌘-click: split">${iconSvg(note.journal ? 'calendar' : 'notes', 13)}<span>${escapeHtml(tabTitleOf(note))}</span><time>${formatCardDate(note.updatedAt)}</time></button>`).join('')}
      </div>`;
}

// ---- Remembering the open tabs ----

const WORKSPACE_KEY = 'tagdown.workspace';
type SavedPane = { tabs: string[]; active: number; size: number; mode: ViewMode };
type SavedWorkspace = { active: number; panes: SavedPane[] };
// Set once launch has read the saved layout, so nothing overwrites it before then.
let workspaceVault: string | null = null;

function readWorkspaces(): Record<string, SavedWorkspace> {
  try { return JSON.parse(localStorage.getItem(WORKSPACE_KEY) || '{}') ?? {}; } catch { return {}; }
}

function saveWorkspace() {
  if (workspaceVault === null) return;
  const saved: SavedWorkspace = {
    active: panes.indexOf(activePane),
    panes: panes.map((pane) => {
      const tabs = pane.tabs.flatMap((tab) => (tab.noteId ? [tab.noteId] : []));
      return {
        tabs,
        active: Math.max(0, tabs.indexOf(pane.tabs[pane.active]?.noteId ?? '')),
        size: pane.size,
        mode: pane === activePane ? viewMode : pane.state.viewMode,
      };
    }),
  };
  const all = readWorkspaces();
  all[workspaceVault] = saved;
  try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(all)); } catch { /* not remembered */ }
}

/** Reopen the tabs and splits from last time. False when there's nothing to reopen. */
async function restoreWorkspace(): Promise<boolean> {
  const saved = workspaceVault === null ? undefined : readWorkspaces()[workspaceVault];
  const layouts = (saved?.panes ?? [])
    .map((layout) => ({ ...layout, tabs: (layout.tabs ?? []).filter((id) => knownNotes.has(id)) }))
    .filter((layout) => layout.tabs.length)
    .slice(0, MAX_PANES);
  if (!layouts.length) return false;
  // The first pane starts in the view Settings asks for; the others keep theirs.
  layouts.forEach((layout, index) => {
    const pane = index === 0 ? panes[0] : createPane(layout.mode || viewMode);
    if (index) panes.push(pane);
    pane.tabs = layout.tabs.map((id) => ({ noteId: id, title: tabTitleOf(knownNotes.get(id)!) }));
    pane.active = Math.min(Math.max(0, layout.active || 0), pane.tabs.length - 1);
    pane.size = layout.size > 0 ? layout.size : 1;
  });
  layoutPanes();
  for (const pane of [...panes]) await displayTab(pane);
  const active = panes[saved?.active ?? 0];
  if (active) activatePane(active);
  return true;
}

// ---- Journal ----

/** Open a day's journal page, creating it (from the "Journal Template" note, if any) the first time. */
async function openJournal(day: string) {
  await settlePendingWork();
  const note = await invoke<Note>('open_journal', { day });
  journalMonth = monthOf(day);
  if (selectedFolder !== 'journal' || selectedTag || selectedType) {
    noteMarkerChange();
    selectedFolder = 'journal';
    selectedTag = null;
    selectedType = null;
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
  let folder: Folder | undefined;
  const created = await folderAction(async () => { folder = await invoke<Folder>('create_folder', { name: trimmed, parentId, icon: 'folder' }); });
  creatingFolderParent = undefined;
  if (!created || !folder) return;
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
  knownNotes.clear();
  for (const note of allNotes) knownNotes.set(note.id, note);
  closeMissingTabs();
  renderFolders();
  await reloadTypes();
}

async function reloadNotes() {
  // Any change to the notes can change what query blocks list.
  invalidateQueries();
  notes = await invoke<Note[]>('list_notes', { folderId: selectedFolder, sort: 'updatedDesc' satisfies SortOrder });
  // Archived notes only show up in the Archive itself, not in All.
  if (!selectedFolder) notes = notes.filter((note) => note.folderId !== 'archive');
  // A tag or a type narrows All Notes.
  if (selectedTag) notes = notes.filter((note) => hasTag(note, selectedTag!));
  if (selectedType) notes = notes.filter((note) => isOfType(note, selectedType!));
  // The newest day first.
  if (selectedFolder === 'journal') notes.sort((a, b) => (b.journal ?? '').localeCompare(a.journal ?? ''));
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
    <button class="folder system-folder ${selectedFolder === null && !selectedTag && !selectedType ? 'selected' : ''}" data-folder="" style="padding-left: ${rowInset(0)}px" type="button">
      <span class="folder-disclosure is-empty" aria-hidden="true"></span>
      <span class="folder-icon" aria-hidden="true">${iconSvg('notes', 13)}</span>
      <span class="folder-name"><span class="${markerClass(selectedFolder === null && !selectedTag && !selectedType)}">All Notes</span></span>
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
      selectedType = null;
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
        ? `This folder contains ${parts.join(' and ')}. The notes move to the top of your vault; the folder is removed from disk.`
        : 'This folder is empty.';
      const ok = await confirmDialog({
        title: 'Delete folder',
        message: `Delete "${folder?.name ?? 'this folder'}"?`,
        detail,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      if (!await folderAction(() => invoke('delete_folder', { id: deletedId }))) return;
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
  const currentType = selectedType ? noteTypes.find((t) => normalizeTitle(t.name) === normalizeTitle(selectedType!)) : null;
  noteListTitleEl.textContent = selectedTag ? `#${selectedTag}` : selectedType ? (currentType?.name ?? selectedType) : currentFolder?.name ?? (selectedFolder === 'journal' ? 'Journal' : 'All Notes');
  scopeIconEl.innerHTML = selectedTag ? uiIcon('hash', 16)
    : selectedType ? typeIconHtml(currentType ?? { name: selectedType, icon: null }, 16)
    : currentFolder ? folderIconSvg(currentFolder.icon) : iconSvg(selectedFolder === 'archive' ? 'archive' : selectedFolder === 'journal' ? 'calendar' : 'notes');
  const newButton = document.querySelector<HTMLButtonElement>('#note-list-new');
  if (newButton) {
    const label = selectedType ? `New ${currentType?.name ?? selectedType}` : 'New note';
    newButton.title = `${label} (⌘N)`;
    newButton.setAttribute('aria-label', label);
  }
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

    if (!await folderAction(() => invoke('move_folder', { id: draggedId, parentId, position }))) return;
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
    renderTypes();
    return;
  }
  let lastGroup = '';
  const open = openNoteIds();
  noteEl.innerHTML = calendar + visible.map((note) => {
    const day = inJournal ? note.journal ?? null : null;
    const group = day ? monthGroup(day) : dateGroup(note.updatedAt);
    const heading = group !== lastGroup ? `<h2 class="note-group">${group}</h2>` : '';
    lastGroup = group;
    const tagMarkup = note.tags.slice(0, 3).map((tag) => `<span style="--tag-dot:${colorForTag(tag).dot}"><i></i>${escapeHtml(tag.split('/').pop() ?? tag)}</span>`).join('');
    const extraTags = note.tags.length > 3 ? `<span class="more">+${note.tags.length - 3}</span>` : '';
    const archived = note.folderId === 'archive';
    return `${heading}
      <article class="note-card ${selectedNote?.id === note.id ? 'selected' : open.has(note.id) ? 'is-open' : ''}" data-note="${note.id}" tabindex="0" draggable="true" aria-current="${selectedNote?.id === note.id}" title="${open.has(note.id) && selectedNote?.id !== note.id ? 'Open in a tab. ' : ''}⌘-click: new tab · ⌥⌘-click: split">
        <div class="note-card-head">
          <h3>${typeIcon(note)}${escapeHtml(day ? formatDay(day, 'short') : note.title || 'Untitled')}</h3>
          ${day ? `<time datetime="${escapeHtml(day)}">${relativeDay(day) ?? ''}</time>` : `<time datetime="${escapeHtml(note.updatedAt)}">${formatCardDate(note.updatedAt)}</time>`}
        </div>
        <p>${escapeHtml(note.preview || (day ? 'Nothing written yet' : 'Empty note'))}</p>
        ${tagMarkup || note.starred ? `<footer>${note.starred ? `<span class="starred" title="Pinned" aria-label="Pinned">${uiIcon('pin', 11)}</span>` : ''}${tagMarkup}${extraTags}</footer>` : ''}
        <button class="note-delete" data-delete-note="${note.id}" type="button" title="${archived ? 'Delete permanently' : 'Move to Archive'}" aria-label="${archived ? 'Delete permanently' : 'Move to Archive'}">${archived ? uiIcon('trash', 13) : iconSvg('archive', 13)}</button>
      </article>
    `;
  }).join('');
  noteEl.querySelectorAll<HTMLElement>('.note-card').forEach((card) => {
    const note = () => notes.find((candidate) => candidate.id === card.dataset.note);
    const choose = async (where: OpenTarget) => {
      const found = note();
      if (found) await openNote(found, where);
    };
    card.addEventListener('click', (event) => void choose(openTarget(event)));
    card.addEventListener('auxclick', (event) => {
      if (event.button === 1) { event.preventDefault(); void choose('tab'); }
    });
    card.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); await choose(openTarget(event)); }
    });
    card.addEventListener('contextmenu', (event) => {
      const found = note();
      if (!found) return;
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, openMenuItems(found));
    });
    card.addEventListener('dragstart', (event) => {
      const found = note();
      if (found && event.dataTransfer) startNoteDrag(event.dataTransfer, found);
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
      await closeNoteEverywhere(id);
      await invoke(archived ? 'destroy_note' : 'delete_note', { id });
      await reloadFolders();
      await reloadNotes();
      renderTags();
    });
  });
  renderTags();
  renderTypes();
}

/** The emoji of a note's type, before its title in the list. */
function typeIcon(note: Note) {
  const icon = findType(typeOfNote(note))?.icon;
  return icon && !templateTypeOf(note.title) ? `<span class="note-type-icon" aria-hidden="true">${escapeHtml(icon)}</span>` : '';
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
  selectedType = null;
  selectedFolder = null;
  activeFilter = 'all';
  renderFilterPills();
  await reloadNotes();
  renderTypes();
}

function hasTag(note: Note, path: string) {
  return note.tags.some((t) => t === path || t.startsWith(`${path}/`));
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

// ---- Note types ----
//
// A note's type is its `type:` property; a note titled "<Type> Template" holds
// what new notes of that type start with (see types.rs). The sidebar lists the
// types; choosing one lists its notes, and new notes there are of that type.

const TEMPLATE_SUFFIX = ' template';

/** The type a note says it is: its `type:` text, a [[link]] by its title. */
function typeOfNote(note: Note): string | null {
  const property = note.properties?.find((p) => p.key.toLowerCase() === 'type');
  if (property?.type !== 'text') return null;
  const text = property.value.trim();
  const link = text.match(/^\[\[([^\]|#]+)(?:[^\]]*)\]\]$/);
  return (link ? link[1] : text).trim() || null;
}

/** The type a template note defines ("Book Template" → "Book"); the Journal Template defines none. */
function templateTypeOf(title: string): string | null {
  const t = title.trim();
  if (normalizeTitle(t) === 'journal template' || !t.toLowerCase().endsWith(TEMPLATE_SUFFIX)) return null;
  return t.slice(0, -TEMPLATE_SUFFIX.length).trim() || null;
}

function isOfType(note: Note, name: string) {
  const type = typeOfNote(note);
  return !!type && normalizeTitle(type) === normalizeTitle(name) && !templateTypeOf(note.title);
}

function findType(name: string | null): NoteType | undefined {
  return name ? noteTypes.find((t) => normalizeTitle(t.name) === normalizeTitle(name)) : undefined;
}

/** A type's icon: its emoji, else a generic shape. */
function typeIconHtml(type: { name: string; icon: string | null }, size = 13) {
  if (type.icon) return `<span class="type-emoji" style="font-size:${Math.round(size * 0.9)}px" aria-hidden="true">${escapeHtml(type.icon)}</span>`;
  return `<svg class="folder-svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="5" r="2.3" /><rect x="9.2" y="2.7" width="4.6" height="4.6" rx="1" /><path d="M5 9.3l2.6 4.4H2.4L5 9.3z" /><path d="M11.5 9.4l2.2 2.2-2.2 2.2-2.2-2.2z" /></svg>`;
}

async function reloadTypes() {
  noteTypes = await invoke<NoteType[]>('list_types').catch(() => [] as NoteType[]);
  renderTypes();
}

function renderTypes() {
  const rows = noteTypes.map((t) => {
    const selected = !!selectedType && normalizeTitle(t.name) === normalizeTitle(selectedType);
    return `
      <button class="folder type-row ${selected ? 'selected' : ''}" data-type-name="${escapeHtml(t.name)}" style="padding-left: 12px" type="button" title="${escapeHtml(t.templateId ? `${t.name} notes start from “${t.name} Template”` : `Notes with type: ${t.name}`)}">
        <span class="folder-disclosure is-empty" aria-hidden="true"></span>
        <span class="folder-icon" aria-hidden="true">${typeIconHtml(t)}</span>
        <span class="folder-name"><span class="${markerClass(selected)}">${escapeHtml(t.name)}</span></span>
        <span class="folder-count">${t.count}</span>
      </button>`;
  }).join('');
  const create = creatingType ? `
    <div class="folder-create-row" style="padding-left: 31px">
      <span class="folder-icon" aria-hidden="true">${typeIconHtml({ name: '', icon: null })}</span>
      <input id="type-create-input" placeholder="Type name, like Book" autocomplete="off" spellcheck="false" aria-label="Type name" />
    </div>` : '';
  const empty = !creatingType && !noteTypes.length
    ? '<div class="tag-empty">Give a note a <kbd>type</kbd> property, or press <kbd>+</kbd>.</div>'
    : '';
  typeEl.innerHTML = rows + create + empty;
  typeEl.querySelectorAll<HTMLButtonElement>('[data-type-name]').forEach((row) => {
    row.addEventListener('click', () => void selectType(row.dataset.typeName!));
    row.addEventListener('contextmenu', (event) => {
      const type = findType(row.dataset.typeName!);
      if (!type) return;
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, [
        { label: `New ${type.name}`, icon: uiIcon('compose', 14), run: () => createTypedNote(type.name) },
        type.templateId
          ? { label: 'Edit template', icon: uiIcon('source', 14), run: () => revealNote(type.templateId!) }
          : { label: 'Make a template', icon: uiIcon('plus', 14), run: () => createTypeTemplate(type.name) },
      ]);
    });
  });
  const input = typeEl.querySelector<HTMLInputElement>('#type-create-input');
  if (!input) return;
  requestAnimationFrame(() => input.focus());
  let committed = false;
  const commit = async (keep: boolean) => {
    if (committed) return;
    committed = true;
    creatingType = false;
    const name = input.value.trim();
    if (keep && name) await createTypeTemplate(name);
    else renderTypes();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void commit(true); }
    else if (event.key === 'Escape') { event.preventDefault(); void commit(false); }
  });
  input.addEventListener('blur', () => void commit(true));
}

/** List the notes of a type. */
async function selectType(name: string) {
  noteMarkerChange();
  selectedType = findType(name)?.name ?? name;
  selectedTag = null;
  selectedFolder = null;
  activeFilter = 'all';
  renderFilterPills();
  await reloadNotes();
}

/** A new note of the type `name`, from its template, in the folder being viewed. */
async function createTypedNote(name: string) {
  await settlePendingWork();
  const folderId = isUserFolder(selectedFolder) ? selectedFolder : null;
  const note = await invoke<Note>('create_typed_note', { typeName: name, title: 'Untitled', folderId });
  if (selectedFolder === 'journal' || selectedFolder === 'archive') selectedFolder = null;
  await reloadFolders();
  await reloadNotes();
  await openNote(note);
  // Ready to type the title over "Untitled".
  if (viewMode !== 'preview') {
    const source = editorRoot.querySelector<HTMLTextAreaElement>('#source');
    if (source) { source.focus(); source.setSelectionRange(2, 2 + 'Untitled'.length); }
  }
}

/** Start a type: its "<Name> Template" note, with an icon property to fill in. */
async function createTypeTemplate(name: string) {
  await settlePendingWork();
  const existing = findType(name);
  if (existing?.templateId) { await revealNote(existing.templateId); return; }
  const typeName = existing?.name ?? name;
  const created = await invoke<Note>('create_note', { folderId: null });
  await invoke<Note>('save_note', { id: created.id, content: `# ${typeName} Template\n\n` });
  const note = await invoke<Note>('set_property', { id: created.id, key: 'icon', value: { type: 'text', value: '' }, renameFrom: null });
  selectedType = typeName;
  selectedTag = null;
  selectedFolder = null;
  await reloadFolders();
  await reloadNotes();
  await openNote(note);
  showNotice(`New ${typeName} notes start with this template’s properties and text`);
}

/** Open `note` in the open tab, a new tab, or a new split beside the open one. */
async function openNote(note: Note, where: OpenTarget = 'here') {
  if (where === 'split') { await splitPane(note); return; }
  await settlePendingWork();
  const pane = activePane;
  rememberScroll(pane);
  const tab: Tab = { noteId: note.id, title: tabTitleOf(note) };
  const existing = pane.tabs.findIndex((candidate) => candidate.noteId === note.id);
  if (existing >= 0) pane.active = existing;
  else if (where === 'tab' && pane.tabs[pane.active]?.noteId) pane.tabs.splice(++pane.active, 0, tab);
  else pane.tabs[pane.active] = tab;
  knownNotes.set(note.id, note);
  paintTabs(pane);
  await displayTab(pane, note);
}

/** Save pending edits and link renames before leaving the open note. */
async function settlePendingWork() {
  if (selectedNote && (saveTimer !== undefined || savedMessage === 'Saving…')) await flushSave();
  await Promise.all([...linkSyncs.keys()].map(syncLinks));
}

// ---- Wikilinks ----

function scheduleLinkSync(id: string, title: string) {
  window.clearTimeout(linkSyncs.get(id)?.timer);
  linkSyncs.set(id, { title, timer: window.setTimeout(() => void syncLinks(id), 1200) });
}

/**
 * Point links in other notes at a note's new title. Runs once the title
 * settles; the backend declines titles that are empty or belong to another
 * note, in which case the old title is kept and a later save retries.
 */
async function syncLinks(id: string) {
  const pending = linkSyncs.get(id);
  if (!pending) return;
  window.clearTimeout(pending.timer);
  linkSyncs.delete(id);
  const oldTitle = linkTitles.get(id);
  const newTitle = pending.title;
  if (oldTitle === undefined || newTitle === oldTitle) return;
  const outcome = await invoke<{ applied: boolean; updated: number }>('rename_links', { id, oldTitle, newTitle });
  if (!outcome.applied) return;
  linkTitles.set(id, newTitle);
  if (outcome.updated) {
    showNotice(`Updated links in ${outcome.updated} ${outcome.updated === 1 ? 'note' : 'notes'}`);
    await reloadNotes();
  }
  forEachPane(() => { if (selectedNote) void loadBacklinks(selectedNote.id); });
}

async function followWikilink(target: string, where: OpenTarget = 'here') {
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
  if (note.id !== selectedNote?.id || where !== 'here') await revealNote(note.id, where);
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
  const id = selectedNote.id;
  renderPropertiesPanel(host, {
    properties: selectedNote.properties ?? [],
    keySuggestions: () => vaultPropertyKeys(),
    valueSuggestions: propertyValueSuggestions,
    knownType: propertyKnownType,
    save: saveProperty,
    decorate: markWikilinks,
    openLink: (target) => void followWikilink(target),
    focus,
    folded: propertiesAreFolded(),
    onFold: (folded) => setPropertiesFolded(id, folded),
    hidden: getPreference('hiddenProperties'),
    onHide: hideProperty,
  });
}

function propertiesAreFolded() {
  if (!selectedNote) return false;
  const hidden = new Set(getPreference('hiddenProperties').map((key) => key.toLowerCase()));
  const shown = (selectedNote.properties ?? []).filter((p) => !hidden.has(p.key.toLowerCase())).length;
  return propertiesFolded(selectedNote.id, shown, getPreference('propertiesFold'));
}

/** ⌘⇧I: fold the open note's properties to one line, or open them up. */
function toggleProperties() {
  if (!selectedNote) return;
  if (!selectedNote.properties?.length) { paintProperties('new'); return; }
  setPropertiesFolded(selectedNote.id, !propertiesAreFolded());
  paintProperties();
}

/** Keep a property out of sight in every note (or bring it back). */
function hideProperty(key: string, hide: boolean) {
  const others = getPreference('hiddenProperties').filter((k) => k.toLowerCase() !== key.toLowerCase());
  setPreference('hiddenProperties', hide ? [...others, key] : others);
  showNotice(hide ? `“${key}” hidden in every note` : `“${key}” shown in every note`);
}

/** Values the vault uses for the property `key`. */
function propertyValueSuggestions(key: string): string[] {
  const values = new Set<string>();
  // Types with a template are offered even before a note uses them.
  if (key.toLowerCase() === 'type') noteTypes.forEach((t) => values.add(t.name));
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
      const tags = newNote.tags.length ? `${newNote.tags.map((tag) => `#${tag}`).join(' ')}\n` : '';
      // A query for a type adds a note of that type, from its template.
      const type = newNote.properties.find((p) => p.key.toLowerCase() === 'type' && p.type === 'text');
      let created: Note;
      if (type?.type === 'text' && type.value.trim()) {
        created = await invoke<Note>('create_typed_note', { typeName: type.value, title, folderId });
        if (tags) {
          const { content: body } = await invoke<NoteContent>('get_note_content', { id: created.id });
          await invoke<Note>('save_note', { id: created.id, content: `${body.trimEnd()}\n\n${tags}` });
        }
      } else {
        created = await invoke<Note>('create_note', { folderId });
        await invoke<Note>('save_note', { id: created.id, content: `# ${title}\n\n${tags}` });
      }
      for (const { key, ...value } of newNote.properties.filter((p) => p !== type)) {
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
  if (saveTimer !== undefined || savedMessage === 'Saving…') await flushSave();
  try {
    const note = await invoke<Note>('set_property', { id, key, value, renameFrom: renameFrom ?? null });
    libraryNotes = libraryNotes.map((n) => (n.id === id ? note : n));
    knownNotes.set(id, note);
    // The same note open in another split shows the change too.
    for (const pane of panes) if (pane !== activePane) withPane(pane, () => { if (selectedNote?.id === id) { selectedNote = note; paintProperties(); } });
    if (selectedNote?.id !== id) return true;
    selectedNote = note;
    invalidateQueries();
    if (key.toLowerCase() === 'type' && value?.type === 'text' && value.value.trim()) await applyType(id);
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

/** After a note's type is set, give it the type's properties it lacks. */
async function applyType(id: string) {
  const [note, added] = await invoke<[Note, string[]]>('apply_type', { id }).catch(() => [null, []] as [null, string[]]);
  if (!note || !added.length) return;
  libraryNotes = libraryNotes.map((n) => (n.id === id ? note : n));
  knownNotes.set(id, note);
  if (selectedNote?.id === id) selectedNote = note;
  showNotice(`Added ${added.join(', ')} from the ${typeOfNote(note) ?? ''} template`);
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
  const source = editorRoot.querySelector<HTMLTextAreaElement>('#source');
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
  const pane = activePane;
  const items = await invoke<Backlink[]>('backlinks', { id }).catch(() => [] as Backlink[]);
  if (!panes.includes(pane)) return;
  withPane(pane, () => {
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
  });
}

function backlinksHtml() {
  if (!selectedNote || backlinks?.id !== selectedNote.id) return '<section class="backlinks" data-backlinks hidden></section>';
  const { items } = backlinks;
  const self = selectedNote;
  const candidates = [self, ...libraryNotes.filter((note) => note.id !== self.id)];
  const mention = (line: string) => {
    const holder = document.createElement('div');
    holder.innerHTML = renderPreview(line);
    holder.querySelectorAll<HTMLElement>('.td-wikilink').forEach((link) => {
      if (resolveTarget(link.dataset.target || '', candidates)?.id === self.id) link.classList.add('is-self');
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
  const source = editorRoot.querySelector<HTMLTextAreaElement>('#source');
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
  // Shown only in the first pane, in focus mode (see layout.css).
  const exitFocus = `<button class="chrome-icon-button exit-focus" type="button" data-exit-focus title="Exit focus mode (⌘\\)" aria-label="Exit focus mode">${uiIcon('sidebar', 15)}</button>`;
  const tabstrip = `
      <div class="tabstrip" data-tabs data-tauri-drag-region role="tablist" aria-label="Open notes"></div>
      <button class="mini-icon-button tab-new" type="button" data-new-tab title="New tab (⌘T)" aria-label="New tab">${uiIcon('plus', 14)}</button>`;
  const moreMenu = `
        <div class="export-dropdown">
          <button id="export-note" class="chrome-icon-button" type="button" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More">${uiIcon('more', 15)}</button>
          <div class="export-menu" role="menu" hidden>
            ${selectedNote ? `
            <button type="button" role="menuitem" data-export="html">${uiIcon('globe', 14)}<span>Export as HTML…</span><kbd>⌘⇧E</kbd></button>
            <button type="button" role="menuitem" data-export="pdf">${uiIcon('printer', 14)}<span>Print or save as PDF…</span><kbd>⌘P</kbd></button>
            <button type="button" role="menuitem" data-export="site">${uiIcon('globe', 14)}<span>Publish as website…</span></button>
            <hr>
            <button type="button" role="menuitem" data-export="present">${uiIcon('play', 14)}<span>Present as slides</span><kbd>⌥⌘P</kbd></button>
            <button type="button" role="menuitem" data-export="history">${uiIcon('clock', 14)}<span>Version history</span><kbd>⌘⇧H</kbd></button>
            <hr>` : ''}
            <button type="button" role="menuitem" data-export="split">${uiIcon('splitRight', 14)}<span>Split right</span><kbd>⌥⌘\\</kbd></button>
            <button type="button" role="menuitem" data-export="close-pane">${uiIcon('close', 14)}<span>Close this pane</span></button>
          </div>
        </div>`;
  const modeButton = (mode: ViewMode, icon: string, label: string, key: string) =>
    `<button data-mode="${mode}" type="button" title="${label} (⌘${key})" aria-label="${label}" class="${viewMode === mode ? 'selected' : ''}" aria-pressed="${viewMode === mode}">${uiIcon(icon, 14)}<span>${label}</span></button>`;
  editorRoot.innerHTML = selectedNote ? `
    <header class="editor-topbar" data-tauri-drag-region>
      ${exitFocus}${tabstrip}
      <div class="topbar-right">
        <span id="saved"></span>
        <div class="mode-switch" role="group" aria-label="View mode">
          ${modeButton('source', 'source', 'Source', '1')}${modeButton('split', 'split', 'Split', '2')}${modeButton('preview', 'eye', 'Preview', '3')}
        </div>
        <button id="present-note" class="chrome-icon-button topbar-extra" type="button" title="Present as slides (⌥⌘P)" aria-label="Present as slides">${uiIcon('play', 15)}</button>
        <button id="note-history" class="chrome-icon-button topbar-extra" type="button" title="Version history (⌘⇧H)" aria-label="Version history">${uiIcon('clock', 15)}</button>
        <button class="chrome-icon-button topbar-split" type="button" data-split-right title="Split right (⌥⌘\\). Or drag a note or tab to the edge" aria-label="Split right">${uiIcon('splitRight', 15)}</button>
        <button id="pin-note" class="chrome-icon-button pin-button ${selectedNote.starred ? 'active' : ''}" type="button" aria-pressed="${selectedNote.starred}" title="${selectedNote.starred ? 'Unpin note' : 'Pin note'}" aria-label="${selectedNote.starred ? 'Unpin note' : 'Pin note'}">${uiIcon('pin', 15)}</button>
        ${moreMenu}
      </div>
    </header>
    <div class="doc-header ${day ? 'is-journal' : ''}">
      ${day ? `<div class="journal-day-head"><h1 class="doc-title">${escapeHtml(formatDay(day))}</h1>${dayNav}</div>` : `<h1 class="doc-title">${escapeHtml(title)}</h1>`}
      <div class="doc-meta">
        <span class="doc-location">${crumbHome}</span>
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
      ${exitFocus}${tabstrip}
      <div class="topbar-right">${moreMenu}</div>
    </header>
    <div class="empty-editor">
      <h2>Pick a note, or start a fresh page.</h2>
      <p>Everything you write is saved as plain text in your vault. ⌘-click a note to open it in a new tab, or drag it to the edge to see two side by side.</p>
      <div class="empty-editor-actions">
        <button type="button" class="empty-editor-action is-primary" data-empty-new>${uiIcon('compose', 14)}New note<kbd>⌘N</kbd></button>
        <button type="button" class="empty-editor-action" data-empty-search>${uiIcon('search', 14)}Search<kbd>⌘K</kbd></button>
      </div>
      ${recentNotesHtml()}
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
  editorRoot.querySelectorAll<HTMLButtonElement>('[data-recent]').forEach((button) => {
    button.addEventListener('click', (event) => void revealNote(button.dataset.recent!, openTarget(event)));
  });
  editorRoot.querySelector('[data-new-tab]')?.addEventListener('click', () => void newTab());
  editorRoot.querySelector('[data-split-right]')?.addEventListener('click', () => void splitPane(selectedNote));
  bindTabStrip(activePane);
  paintTabs(activePane);
  paintProperties();
  editorRoot.querySelectorAll<HTMLButtonElement>('[data-journal-day]').forEach((button) => {
    button.addEventListener('click', () => void openJournal(button.dataset.journalDay!));
  });

  editorRoot.querySelector('#pin-note')?.addEventListener('click', async () => {
    if (!selectedNote) return;
    const updated = await invoke<Note>('star_note', { id: selectedNote.id, starred: !selectedNote.starred });
    knownNotes.set(updated.id, updated);
    forEachPane(() => {
      if (selectedNote?.id !== updated.id) return;
      selectedNote = updated;
      const pin = editorRoot.querySelector<HTMLButtonElement>('#pin-note');
      if (!pin) return;
      pin.classList.toggle('active', updated.starred);
      pin.setAttribute('aria-pressed', String(updated.starred));
      pin.title = updated.starred ? 'Unpin note' : 'Pin note';
      pin.setAttribute('aria-label', pin.title);
    });
    await reloadNotes();
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
    if (!blockEdit || target.closest('.td-block-editor, input[data-task-note], .td-query-table, .td-qt-new, .td-qb, .td-qc')) return;
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
      void revealNote(backlink.dataset.openNote!, openTarget(event));
      return;
    }
    const wikilink = target.closest<HTMLAnchorElement>('.td-wikilink');
    if (wikilink) {
      event.preventDefault();
      void followWikilink(wikilink.dataset.target || '', openTarget(event));
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

  // Middle-click opens a link in a new tab; right-click offers where to open it.
  livePreviewInit?.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLElement>('.td-wikilink');
    const backlink = target.closest<HTMLElement>('[data-open-note]');
    if (!link && !backlink) return;
    event.preventDefault();
    if (link) void followWikilink(link.dataset.target || '', 'tab');
    else void revealNote(backlink!.dataset.openNote!, 'tab');
  });
  livePreviewInit?.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLElement>('.td-wikilink');
    const backlink = target.closest<HTMLElement>('[data-open-note]');
    if (!link && !backlink) return;
    event.preventDefault();
    const open = (where: OpenTarget) => link ? followWikilink(link.dataset.target || '', where) : revealNote(backlink!.dataset.openNote!, where);
    showContextMenu(event.clientX, event.clientY, [
      { label: 'Open', icon: uiIcon('eye', 14), run: () => open('here') },
      { label: 'Open in new tab', icon: uiIcon('plus', 14), shortcut: '⌘-click', run: () => open('tab') },
      { label: 'Open to the right', icon: uiIcon('splitRight', 14), shortcut: '⌥⌘-click', run: () => open('split') },
    ]);
  });

  editorRoot.querySelector('.preview')?.addEventListener('keydown', (event) => {
    const backlink = (event.target as HTMLElement).closest<HTMLElement>('[data-open-note]');
    if (backlink && ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ')) {
      event.preventDefault();
      void revealNote(backlink.dataset.openNote!, openTarget(event as KeyboardEvent));
    }
  });

  const source = editorRoot.querySelector<HTMLTextAreaElement>('#source');
  if (source) attachEditingAids(source);
  source?.addEventListener('input', () => {
    content = source.value;
    const livePreview = editorRoot.querySelector<HTMLDivElement>('.preview');
    if (livePreview) {
      paintPreview(livePreview);
    }
    scheduleSave();
  });
  renderStatus();
}

function isInteractive(target: HTMLElement) {
  return !!target.closest('a, button, input, select, textarea, summary, label, iframe, video, audio, [data-embed-url], .td-tag, .backlinks, .td-query-table, .td-qt-new, .td-qb, .td-qc');
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
  const source = editorRoot.querySelector<HTMLTextAreaElement>('#source');
  if (!source) return;
  let start = source.selectionStart;
  const end = source.selectionEnd;
  if (atLineStart) while (start > 0 && content[start - 1] !== '\n') start--;
  content = content.slice(0, start) + text + content.slice(end);
  renderEditor();
  const next = editorRoot.querySelector<HTMLTextAreaElement>('#source');
  next?.focus();
  if (next) next.selectionStart = next.selectionEnd = start + text.length;
  scheduleSave();
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
  const source = editorRoot.querySelector<HTMLTextAreaElement>('#source');
  if (!source) return;
  const start = source.selectionStart;
  const end = source.selectionEnd;
  const selected = content.slice(start, end);
  content = content.slice(0, start) + left + selected + right + content.slice(end);
  renderEditor();
  const next = editorRoot.querySelector<HTMLTextAreaElement>('#source');
  next?.focus();
  if (next) { next.selectionStart = start + left.length; next.selectionEnd = start + left.length + selected.length; }
  scheduleSave();
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
      const source = editorRoot.querySelector<HTMLTextAreaElement>('#source');
      if (source) source.value = content;
      const livePreview = editorRoot.querySelector<HTMLDivElement>('.preview');
      if (livePreview) {
        paintPreview(livePreview);
      }
      scheduleSave();
      return;
    }
    seen++;
  }
}

async function flushSave() {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!selectedNote) return;
  const pane = activePane;
  const id = selectedNote.id;
  const text = content;
  const saved = await invoke<Note>('save_note', { id, content: text });
  libraryNotes = libraryNotes.map((note) => (note.id === id ? saved : note));
  knownNotes.set(id, saved);
  if (linkTitles.has(id) && saved.title !== (linkSyncs.get(id)?.title ?? linkTitles.get(id))) scheduleLinkSync(id, saved.title);
  // The same note open in another split shows what was just saved.
  for (const other of panes) {
    if (other === pane) continue;
    withPane(other, () => {
      if (selectedNote?.id !== id || saveTimer !== undefined) return;
      selectedNote = saved;
      if (content !== text) showDiskContent(text);
    });
  }
  if (panes.includes(pane)) {
    const isActive = pane === activePane;
    withPane(pane, () => {
      if (selectedNote?.id !== id) return;
      selectedNote = saved;
      // More typing since this save started: that save is still to come.
      if (saveTimer === undefined) savedMessage = 'Saved';
      if (isActive) setDocumentTitle(saved.title || 'Untitled');
      // Journal pages are headed by their day, whatever their title says.
      if (!saved.journal) {
        const titleText = saved.title || 'Untitled';
        editorRoot.querySelectorAll('.doc-title').forEach((el) => { el.textContent = titleText; });
      }
      renderStatus();
    });
  }
  for (const each of panes) for (const tab of each.tabs) if (tab.noteId === id) tab.title = tabTitleOf(saved);
  paintAllTabs();
  await reloadNotes();
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
    menu.querySelector<HTMLElement>('[data-export="close-pane"]')!.hidden = panes.length < 2;
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
      const run: Record<string, () => Promise<unknown> | void> = {
        html: exportNoteHtml, pdf: exportNotePdf, site: showPublish, present: presentNote, history: showVersionHistory,
        split: () => splitPane(selectedNote), 'close-pane': () => closePane(activePane),
      };
      void run[kind ?? 'html']?.();
    });
  });
}

/** Present the open note as slides, starting from the one the cursor is in. */
async function presentNote() {
  if (!selectedNote) return;
  const source = editorRoot.querySelector<HTMLTextAreaElement>('#source');
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
      if (linkTitles.has(note.id) && restored.title !== linkTitles.get(note.id)) scheduleLinkSync(note.id, restored.title);
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
  const countsEl = editorRoot.querySelector<HTMLSpanElement>('#counts');
  const savedEl = editorRoot.querySelector<HTMLSpanElement>('#saved');
  const words = wordCount(content);
  if (countsEl) countsEl.textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`;
  if (!savedEl) return;
  const state = savedMessage === 'Saving…' ? 'saving' : savedMessage === 'Ready' ? 'idle' : 'saved';
  const shown = notice && Date.now() < notice.until ? notice.text : state === 'idle' ? 'Saved to vault' : savedMessage;
  savedEl.className = `save-state is-${state}`;
  savedEl.title = shown;
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
