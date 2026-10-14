// App preferences, saved locally like the theme.

export type ViewMode = 'source' | 'split' | 'preview';

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
}

export function onPreferenceChange(callback: (name: keyof Preferences) => void) {
  const handler = (event: Event) => callback((event as CustomEvent<keyof Preferences>).detail);
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
