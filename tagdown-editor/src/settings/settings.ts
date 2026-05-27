import rootHtml from '../../../tagdown-live.html?raw';
import { renderPreview } from '../tagdown/renderer';
import { getEffectiveTheme, getThemePreference, onThemePreferenceChange, setThemePreference, type ThemePreference } from './theme';

const SETTINGS_PANELS = [
  { id: 'general', title: 'General', body: 'Vault location, default view mode, autosave delay, and delete confirmations will appear here.' },
  { id: 'editor', title: 'Editor', body: 'Editor font size, line height, line numbers, tab size, spell check, and soft wrap will appear here.' },
  { id: 'appearance', title: 'Appearance', body: 'Theme and display controls.' },
  { id: 'export', title: 'Export', body: 'Default export folder and standalone HTML options will appear here.' },
] as const;

let dialog: HTMLDialogElement | null = null;

export function initSettings() {
  if (dialog) return;

  document.body.insertAdjacentHTML('beforeend', renderSettingsDialog());
  dialog = document.querySelector<HTMLDialogElement>('#settings-dialog');
  if (!dialog) throw new Error('Settings dialog failed to mount');

  dialog.querySelector<HTMLButtonElement>('[data-settings-close]')?.addEventListener('click', () => dialog?.close());

  bindAppearanceControls();
  onThemePreferenceChange(updateThemeControls);

  dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab));
  });

  dialog.querySelector<HTMLElement>('[role="tablist"]')?.addEventListener('keydown', (event) => {
    const tabs = [...dialog!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') activateTab(tabs[currentIndex]);
    else return;

    event.preventDefault();
    tabs[nextIndex].focus();
  });
}

export function openSettings(panelId = 'tagdown-reference') {
  initSettings();
  const tab = dialog?.querySelector<HTMLButtonElement>(`[role="tab"][data-panel="${panelId}"]`);
  if (tab) activateTab(tab);
  if (!dialog?.open) dialog?.showModal();
}

function activateTab(targetTab: HTMLButtonElement) {
  if (!dialog) return;
  const targetPanelId = targetTab.getAttribute('aria-controls');
  if (!targetPanelId) return;

  dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((tab) => {
    const selected = tab === targetTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });

  dialog.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach((panel) => {
    panel.hidden = panel.id !== targetPanelId;
  });
}

function renderSettingsDialog() {
  const tabs = [
    ...SETTINGS_PANELS.map((panel) => ({ id: panel.id, title: panel.title })),
    { id: 'tagdown-reference', title: 'Tagdown Reference' },
  ];

  return `
    <dialog class="settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
      <div class="settings-shell">
        <header class="settings-header">
          <div>
            <p class="settings-eyebrow">Preferences</p>
            <h1 id="settings-title">Settings</h1>
          </div>
          <button class="settings-close" type="button" data-settings-close aria-label="Close settings">×</button>
        </header>
        <div class="settings-body">
          <nav class="settings-tabs" role="tablist" aria-label="Settings sections">
            ${tabs.map((tab, index) => `
              <button
                role="tab"
                id="settings-tab-${tab.id}"
                aria-controls="settings-panel-${tab.id}"
                aria-selected="${index === tabs.length - 1}"
                tabindex="${index === tabs.length - 1 ? '0' : '-1'}"
                data-panel="${tab.id}"
                type="button"
              >${escapeHtml(tab.title)}</button>
            `).join('')}
          </nav>
          <section class="settings-panels">
            ${SETTINGS_PANELS.map((panel) => renderPlaceholderPanel(panel)).join('')}
            ${renderDocumentationPanel()}
          </section>
        </div>
      </div>
    </dialog>
  `;
}

function renderPlaceholderPanel(panel: (typeof SETTINGS_PANELS)[number]) {
  if (panel.id === 'appearance') return renderAppearancePanel();

  return `
    <article
      id="settings-panel-${panel.id}"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="settings-tab-${panel.id}"
      hidden
      class="settings-panel settings-placeholder"
    >
      <p class="settings-eyebrow">Coming soon</p>
      <h2>${escapeHtml(panel.title)}</h2>
      <p>${escapeHtml(panel.body)}</p>
    </article>
  `;
}

function renderAppearancePanel() {
  const currentTheme = getThemePreference();
  const choices: Array<{ value: ThemePreference; title: string; description: string }> = [
    { value: 'system', title: 'System', description: 'Match your macOS, Windows, or Linux appearance.' },
    { value: 'light', title: 'Light', description: 'Use the bright editorial workspace.' },
    { value: 'dark', title: 'Dark', description: 'Use the low-light writing workspace.' },
  ];

  return `
    <article
      id="settings-panel-appearance"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="settings-tab-appearance"
      hidden
      class="settings-panel settings-appearance"
    >
      <p class="settings-eyebrow">Display</p>
      <h2>Appearance</h2>
      <p class="settings-intro">Choose how Tagdown looks. The setting is saved locally and applied on launch.</p>
      <fieldset class="theme-options" aria-describedby="theme-summary">
        <legend>Theme</legend>
        ${choices.map((choice) => `
          <label class="theme-option">
            <input type="radio" name="theme-preference" value="${choice.value}" ${choice.value === currentTheme ? 'checked' : ''} />
            <span>
              <strong>${choice.title}</strong>
              <small>${choice.description}</small>
            </span>
          </label>
        `).join('')}
      </fieldset>
      <p id="theme-summary" class="theme-summary">Current effective theme: <strong data-theme-summary>${getEffectiveTheme(currentTheme)}</strong>.</p>
    </article>
  `;
}

function bindAppearanceControls() {
  dialog?.querySelectorAll<HTMLInputElement>('input[name="theme-preference"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) setThemePreference(input.value as ThemePreference);
    });
  });
  updateThemeControls();
}

function updateThemeControls() {
  if (!dialog) return;
  const preference = getThemePreference();
  dialog.querySelectorAll<HTMLInputElement>('input[name="theme-preference"]').forEach((input) => {
    input.checked = input.value === preference;
  });
  const summary = dialog.querySelector<HTMLElement>('[data-theme-summary]');
  if (summary) summary.textContent = getEffectiveTheme(preference);
}

function renderDocumentationPanel() {
  const reference = extractTagdownReference(rootHtml);
  if (!reference) {
    return `
      <article
        id="settings-panel-tagdown-reference"
        role="tabpanel"
        tabindex="0"
        aria-labelledby="settings-tab-tagdown-reference"
        class="settings-panel tagdown-docs"
      >
        ${renderReferenceFallback()}
      </article>
    `;
  }

  const source = escapeHtml(reference);
  const rendered = renderPreview(reference);

  return `
    <article
      id="settings-panel-tagdown-reference"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="settings-tab-tagdown-reference"
      class="settings-panel tagdown-docs"
    >
      <p class="settings-eyebrow">Loaded from tagdown-live.html</p>
      <div class="tagdown-reference-split">
        <div class="tagdown-reference-source">
          <div class="tagdown-reference-pane-label">Tagdown</div>
          <pre><code>${source}</code></pre>
        </div>
        <div class="tagdown-reference-rendered">
          <div class="tagdown-reference-pane-label">Preview</div>
          <div class="tagdown-reference-preview">${rendered}</div>
        </div>
      </div>
    </article>
  `;
}

function extractTagdownReference(html: string) {
  const marker = 'reference: `';
  const start = html.indexOf(marker);
  if (start === -1) return null;

  let cursor = start + marker.length;
  let value = '';

  while (cursor < html.length) {
    const char = html[cursor];
    const next = html[cursor + 1];

    if (char === '`') return unescapeTemplateLiteral(value).trim();

    if (char === '\\' && next !== undefined) {
      value += char + next;
      cursor += 2;
      continue;
    }

    value += char;
    cursor += 1;
  }

  return null;
}

function unescapeTemplateLiteral(value: string) {
  return value
    .replaceAll('\\`', '`')
    .replaceAll('\\${', '${')
    .replaceAll('\\\\', '\\');
}

function renderReferenceFallback() {
  return `
    <div class="settings-reference-error">
      <h2>Tagdown Reference</h2>
      <p>The syntax reference could not be extracted from <code>tagdown-live.html</code>.</p>
    </div>
  `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
