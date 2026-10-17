// App preferences, saved locally like the theme.

export type ViewMode = 'source' | 'split' | 'preview';

export const ACCENTS = [
  { value: 'yellow', label: 'Yellow', swatch: '#ffd60a' },
  { value: 'lime', label: 'Lime', swatch: '#d4ec5c' },
  { value: 'green', label: 'Green', swatch: '#a8e07a' },
  { value: 'mint', label: 'Mint', swatch: '#9ae8b8' },
  { value: 'teal', label: 'Teal', swatch: '#7fe0cf' },
  { value: 'cyan', label: 'Cyan', swatch: '#7fd6f0' },
  { value: 'blue', label: 'Blue', swatch: '#93c5ff' },
  { value: 'indigo', label: 'Indigo', swatch: '#aab4ff' },
  { value: 'purple', label: 'Purple', swatch: '#c9a8ff' },
  { value: 'magenta', label: 'Magenta', swatch: '#f0a0f0' },
  { value: 'pink', label: 'Pink', swatch: '#ffa3cf' },
  { value: 'red', label: 'Red', swatch: '#ff7a7a' },
  { value: 'coral', label: 'Coral', swatch: '#ff9a85' },
  { value: 'orange', label: 'Orange', swatch: '#ffb54d' },
  { value: 'peach', label: 'Peach', swatch: '#ffc8a2' },
  { value: 'graphite', label: 'Graphite', swatch: '#c9c4b8' },
] as const;

export type Accent = (typeof ACCENTS)[number]['value'];

export type Preferences = {
  /** What to show when the app starts. */
  startupOpen: 'last' | 'journal' | 'first';
  /** The note open when the app last closed, for `startupOpen: 'last'`. */
  lastNoteId: string | null;
  /** The view a fresh launch starts in, unless `rememberViewMode` is on. */
  defaultViewMode: ViewMode;
  /** Start in whichever view was last used instead of `defaultViewMode`. */
  rememberViewMode: boolean;
  lastViewMode: ViewMode;
  /** Ask before moving a note to the Archive. Permanent deletes always ask. */
  confirmArchive: boolean;
  spellcheck: boolean;
  /** Source editor text size, in px. */
  editorFontSize: number;
  /** Preview text size, in px. */
  previewFontSize: number;
  /** How wide the text runs in the full-width preview. */
  previewWidth: 'narrow' | 'medium' | 'wide';
  /** Dragging a heading in the preview moves its whole section. */
  dragHeadingSections: boolean;
  /** The highlighter colour the whole app is tinted with. */
  accent: Accent;
  /** The faint paper texture on the window background. */
  grain: boolean;
  /** Whether a note's properties start folded to one line; `auto` folds more than three. */
  propertiesFold: 'auto' | 'expanded' | 'collapsed';
  /** Property names kept out of sight in every note, until “Show hidden”. */
  hiddenProperties: string[];
};

export const DEFAULTS: Preferences = {
  startupOpen: 'last',
  lastNoteId: null,
  defaultViewMode: 'split',
  rememberViewMode: false,
  lastViewMode: 'split',
  confirmArchive: true,
  spellcheck: true,
  editorFontSize: 13,
  previewFontSize: 15,
  previewWidth: 'medium',
  dragHeadingSections: true,
  accent: 'yellow',
  grain: true,
  propertiesFold: 'auto',
  hiddenProperties: [],
};

const PREVIEW_WIDTHS: Record<Preferences['previewWidth'], string> = { narrow: '640px', medium: '760px', wide: '920px' };

const CHANGE_EVENT = 'tagdown-preference-change';
const key = (name: keyof Preferences) => `tagdown.${name}`;

export function getPreference<K extends keyof Preferences>(name: K): Preferences[K] {
  try {
    const stored = localStorage.getItem(key(name));
    if (stored !== null) return JSON.parse(stored) as Preferences[K];
  } catch {
    // Storage can be unavailable or hold something unreadable; fall back to the default.
  }
  return DEFAULTS[name];
}

export function setPreference<K extends keyof Preferences>(name: K, value: Preferences[K]) {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    // Not saved, but the caller reads it again on next use either way.
  }
  applyPreferences();
  window.dispatchEvent(new CustomEvent<keyof Preferences>(CHANGE_EVENT, { detail: name }));
}

/** Put the look-and-feel preferences on the root element as CSS variables. */
export function applyPreferences() {
  const root = document.documentElement.style;
  root.setProperty('--editor-font-size', `${getPreference('editorFontSize')}px`);
  root.setProperty('--preview-font-size', `${getPreference('previewFontSize')}px`);
  root.setProperty('--preview-measure', PREVIEW_WIDTHS[getPreference('previewWidth')] ?? PREVIEW_WIDTHS.medium);
  // Yellow is the stylesheet's own palette; every other accent is a data attribute.
  const accent = getPreference('accent');
  if (accent !== 'yellow' && ACCENTS.some((option) => option.value === accent)) document.documentElement.dataset.accent = accent;
  else delete document.documentElement.dataset.accent;
  if (getPreference('grain')) delete document.documentElement.dataset.grain;
  else document.documentElement.dataset.grain = 'off';
}

export function onPreferenceChange(callback: (name: keyof Preferences) => void) {
  const handler = (event: Event) => callback((event as CustomEvent<keyof Preferences>).detail);
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
