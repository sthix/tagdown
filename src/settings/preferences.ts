// Editor preferences, saved locally like the theme.

export type Preferences = {
  /** Dragging a heading in the preview moves its whole section. */
  dragHeadingSections: boolean;
};

const DEFAULTS: Preferences = {
  dragHeadingSections: true,
};

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
}
