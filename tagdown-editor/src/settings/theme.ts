import { setTheme as setTauriTheme } from '@tauri-apps/api/app';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'tagdown.theme';
const THEME_EVENT = 'tagdown-theme-change';
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function getEffectiveTheme(preference = getThemePreference()): 'light' | 'dark' {
  if (preference === 'system') return mediaQuery.matches ? 'dark' : 'light';
  return preference;
}

export function applyTheme(preference = getThemePreference()) {
  const effectiveTheme = getEffectiveTheme(preference);

  if (effectiveTheme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;

  void setTauriTheme(preference === 'system' ? null : preference).catch(() => {
    // The web preview does not expose Tauri internals; CSS theme state is still applied.
  });

  window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_EVENT, { detail: preference }));
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable in private/restricted contexts; apply for this session anyway.
  }

  applyTheme(preference);
}

export function initializeTheme() {
  applyTheme(getThemePreference());
}

export function onThemePreferenceChange(callback: (preference: ThemePreference) => void) {
  const handler = (event: Event) => callback((event as CustomEvent<ThemePreference>).detail);
  window.addEventListener(THEME_EVENT, handler);
  return () => window.removeEventListener(THEME_EVENT, handler);
}

mediaQuery.addEventListener('change', () => {
  if (getThemePreference() === 'system') applyTheme('system');
});
