import { invoke } from '@tauri-apps/api/core';
import { renderPreview } from '../tagdown/renderer';
import { tagdownDocumentation } from '../tagdown/documentation';
import { uiIcon, UI_ICONS } from '../icons';
import { getEffectiveTheme, getThemePreference, onThemePreferenceChange, setThemePreference, type ThemePreference } from './theme';
import { ACCENTS, getPreference, onPreferenceChange, setPreference, type Preferences } from './preferences';
import { SHORTCUT_GROUPS } from './shortcuts';

// ---- What the pages hold ----
//
// Each page is a list of groups, each group a card of rows: a label (and an
// optional line of explanation) on the left, its control on the right. Controls
// read and write preferences directly, so a change applies as soon as it's made.

type Option = { value: string; label: string; swatch?: string };

type Control =
  | { kind: 'switch'; name: keyof Preferences }
  | { kind: 'segmented'; name: keyof Preferences; options: Option[] }
  | { kind: 'swatches'; name: keyof Preferences; options: Option[] }
  | { kind: 'select'; name: keyof Preferences; options: Option[] }
  | { kind: 'range'; name: keyof Preferences; min: number; max: number; unit: string }
  | { kind: 'html'; render: () => string };

type Row = { label: string; description?: string; control: Control; stacked?: boolean };
type Group = { title: string; rows: Row[] };
type Page = { id: string; title: string; icon: keyof typeof UI_ICONS; intro: string; groups?: Group[]; body?: () => string };

const VIEW_OPTIONS: Option[] = [
  { value: 'source', label: 'Source' },
  { value: 'split', label: 'Split' },
  { value: 'preview', label: 'Preview' },
];

const PAGES: Page[] = [
  {
    id: 'general',
    title: 'General',
    icon: 'sliders',
    intro: 'How Tagdown starts and how careful it is with your notes.',
    groups: [
      {
        title: 'On launch',
        rows: [
          {
            label: 'Open',
            control: {
              kind: 'select',
              name: 'startupOpen',
              options: [
                { value: 'last', label: 'The last note I had open' },
                { value: 'journal', label: 'Today’s journal page' },
                { value: 'first', label: 'The most recent note' },
              ],
            },
          },
          { label: 'Start in', description: 'The view a note opens in. ⌘1, ⌘2 and ⌘3 switch at any time.', control: { kind: 'segmented', name: 'defaultViewMode', options: VIEW_OPTIONS } },
          { label: 'Remember the last view', description: 'Start in whichever view you used last instead.', control: { kind: 'switch', name: 'rememberViewMode' } },
        ],
      },
      {
        title: 'Safety',
        rows: [
          {
            label: 'Ask before archiving a note',
            description: 'Archived notes can be restored from the Archive. Deleting a note for good always asks first.',
            control: { kind: 'switch', name: 'confirmArchive' },
          },
        ],
      },
      {
        title: 'Vault',
        rows: [
          {
            label: 'Location',
            description: 'Your notes are plain Markdown files in this folder.',
            control: { kind: 'html', render: renderVaultControl },
          },
        ],
      },
    ],
  },
  {
    id: 'editor',
    title: 'Editor',
    icon: 'compose',
    intro: 'How writing and editing behave.',
    groups: [
      {
        title: 'Writing',
        rows: [
          { label: 'Check spelling', control: { kind: 'switch', name: 'spellcheck' } },
          { label: 'Source text size', description: 'The Markdown editor, and blocks you edit in the preview.', control: { kind: 'range', name: 'editorFontSize', min: 11, max: 20, unit: 'px' } },
        ],
      },
      {
        title: 'Reordering blocks',
        rows: [
          {
            label: 'Headings move their section',
            description: 'Dragging a heading in the preview (or moving it with ⌘⇧↑ / ⌘⇧↓) takes everything under it along, up to the next heading of the same or a higher level.',
            control: { kind: 'switch', name: 'dragHeadingSections' },
          },
        ],
      },
    ],
  },
  {
    id: 'appearance',
    title: 'Appearance',
    icon: 'sun',
    intro: 'How Tagdown looks. ⌘⇧D switches between light and dark.',
    groups: [
      {
        title: 'Theme',
        rows: [
          { label: 'Theme', stacked: true, control: { kind: 'html', render: renderThemePicker } },
          {
            label: 'Accent',
            description: 'The highlighter colour for selections, markers and the window tint.',
            control: { kind: 'swatches', name: 'accent', options: [...ACCENTS] },
          },
          { label: 'Paper grain', description: 'A faint texture on the window background.', control: { kind: 'switch', name: 'grain' } },
        ],
      },
      {
        title: 'Reading',
        rows: [
          { label: 'Preview text size', control: { kind: 'range', name: 'previewFontSize', min: 13, max: 20, unit: 'px' } },
          {
            label: 'Line length',
            description: 'How wide text runs in the full preview (⌘3).',
            control: {
              kind: 'segmented',
              name: 'previewWidth',
              options: [
                { value: 'narrow', label: 'Narrow' },
                { value: 'medium', label: 'Medium' },
                { value: 'wide', label: 'Wide' },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    icon: 'keyboard',
    intro: 'Every key you can press. ⌘K finds the rest by name.',
    body: renderShortcuts,
  },
];

const REFERENCE = { id: 'tagdown-reference', title: 'Tagdown Reference', icon: 'book' as const };

let dialog: HTMLDialogElement | null = null;
let closeTimer: number | undefined;

export function initSettings() {
  if (dialog) return;

  document.body.insertAdjacentHTML('beforeend', renderSettingsDialog());
  dialog = document.querySelector<HTMLDialogElement>('#settings-dialog');
  if (!dialog) throw new Error('Settings dialog failed to mount');

  dialog.querySelector<HTMLButtonElement>('[data-settings-close]')?.addEventListener('click', closeSettings);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeSettings();
  });
  dialog.addEventListener('click', (event) => {
    // A click on the backdrop lands on the dialog element itself.
    if (event.target === dialog) closeSettings();
  });

  bindControls();
  bindThemePicker();
  onThemePreferenceChange(updateThemeControls);
  onPreferenceChange(syncControl);
  dialog.querySelector('[data-reveal-vault]')?.addEventListener('click', () => {
    void invoke('reveal_vault').catch(() => undefined);
  });

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

  bindReferenceNav();
  bindReferenceExpand();
  bindReferenceAnchors();
}

// The reference reads better with room: expanding hides the settings sidebar
// and grows the dialog to fill the window.
function bindReferenceExpand() {
  const button = dialog?.querySelector<HTMLButtonElement>('[data-settings-expand]');
  button?.addEventListener('click', () => setReferenceExpanded(!dialog!.classList.contains('is-expanded')));
}

function setReferenceExpanded(expanded: boolean) {
  if (!dialog) return;
  dialog.classList.toggle('is-expanded', expanded);
  const button = dialog.querySelector<HTMLButtonElement>('[data-settings-expand]');
  if (!button) return;
  const label = expanded ? 'Collapse reference' : 'Expand reference';
  button.setAttribute('aria-pressed', String(expanded));
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = uiIcon(expanded ? 'collapse' : 'expand', 15);
}

// Anchor links in an example (a <toc />, a [jump](#section)) scroll within that
// example's preview instead of navigating the app.
function bindReferenceAnchors() {
  dialog?.querySelector('#settings-panel-tagdown-reference')?.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('.tagdown-reference-preview a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    const id = decodeURIComponent(link.getAttribute('href')!.slice(1));
    const preview = link.closest('.tagdown-reference-preview');
    preview?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function bindReferenceNav() {
  if (!dialog) return;
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('[data-ref-component]')];
  if (!buttons.length) return;

  const selectComponent = (target: HTMLButtonElement) => {
    const id = target.getAttribute('data-ref-component');
    if (!id) return;
    buttons.forEach((button) => {
      const selected = button === target;
      button.setAttribute('aria-pressed', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    dialog!.querySelectorAll<HTMLElement>('[data-ref-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-ref-panel') !== id;
    });
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => selectComponent(button));
  });

  buttons[0].parentElement?.addEventListener('keydown', (event) => {
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = buttons.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') { selectComponent(buttons[currentIndex]); event.preventDefault(); return; }
    else return;

    event.preventDefault();
    buttons[nextIndex].focus();
    selectComponent(buttons[nextIndex]);
  });
}

export function openSettings(panelId = 'general') {
  initSettings();
  const tab = dialog?.querySelector<HTMLButtonElement>(`[role="tab"][data-panel="${panelId}"]`);
  if (tab) activateTab(tab);
  void loadVaultPath();
  window.clearTimeout(closeTimer);
  dialog?.classList.remove('is-closing');
  if (!dialog?.open) dialog?.showModal();
}

function closeSettings() {
  if (!dialog?.open || dialog.classList.contains('is-closing')) return;
  const el = dialog;
  el.classList.add('is-closing');
  closeTimer = window.setTimeout(() => {
    el.close();
    el.classList.remove('is-closing');
  }, 110);
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

  const panelName = targetTab.getAttribute('data-panel') ?? '';
  dialog.dataset.panel = panelName;
  if (panelName !== REFERENCE.id) setReferenceExpanded(false);
}

// ---- Rendering ----

function renderSettingsDialog() {
  const tabs = [...PAGES, REFERENCE];

  return `
    <dialog class="settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
      <div class="settings-body">
        <nav class="settings-tabs" aria-label="Settings sections">
          <h1 id="settings-title" class="settings-title">Settings</h1>
          <div role="tablist" aria-orientation="vertical" aria-labelledby="settings-title">
            ${tabs.map((tab, index) => `
              <button
                role="tab"
                id="settings-tab-${tab.id}"
                aria-controls="settings-panel-${tab.id}"
                aria-selected="${index === 0}"
                tabindex="${index === 0 ? '0' : '-1'}"
                data-panel="${tab.id}"
                type="button"
              >${uiIcon(tab.icon, 15)}<span>${escapeHtml(tab.title)}</span></button>
            `).join('')}
          </div>
        </nav>
        <section class="settings-panels">
          ${PAGES.map((page, index) => renderPage(page, index === 0)).join('')}
          ${renderDocumentationPanel()}
        </section>
      </div>
      <button class="settings-expand chrome-icon-button" type="button" data-settings-expand aria-pressed="false" aria-label="Expand reference" title="Expand reference">${uiIcon('expand', 15)}</button>
      <button class="settings-close chrome-icon-button" type="button" data-settings-close aria-label="Close settings" title="Close (Esc)">${uiIcon('close', 15)}</button>
    </dialog>
  `;
}

function renderPage(page: Page, visible: boolean) {
  return `
    <article
      id="settings-panel-${page.id}"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="settings-tab-${page.id}"
      ${visible ? '' : 'hidden'}
      class="settings-panel"
    >
      <header class="settings-page-head">
        <h2>${escapeHtml(page.title)}</h2>
        <p>${escapeHtml(page.intro)}</p>
      </header>
      ${page.groups ? page.groups.map(renderGroup).join('') : page.body?.() ?? ''}
    </article>
  `;
}

function renderGroup(group: Group) {
  return `
    <section class="settings-group">
      <h3>${escapeHtml(group.title)}</h3>
      <div class="settings-card">
        ${group.rows.map(renderRow).join('')}
      </div>
    </section>
  `;
}

function renderRow(row: Row) {
  const id = 'name' in row.control ? `setting-${row.control.name}` : '';
  const labelTag = id && row.control.kind !== 'segmented' && row.control.kind !== 'swatches' ? `label for="${id}"` : 'span';
  return `
    <div class="settings-row ${row.stacked ? 'is-stacked' : ''}">
      <div class="settings-row-text">
        <${labelTag} class="settings-row-label" ${id ? `id="${id}-label"` : ''}>${escapeHtml(row.label)}</${labelTag.split(' ')[0]}>
        ${row.description ? `<p>${escapeHtml(row.description)}</p>` : ''}
      </div>
      <div class="settings-row-control">${renderControl(row.control)}</div>
    </div>
  `;
}

function renderControl(control: Control) {
  if (control.kind === 'html') return control.render();
  const id = `setting-${control.name}`;
  const value = getPreference(control.name);

  if (control.kind === 'switch') {
    return `<input id="${id}" class="td-switch" type="checkbox" role="switch" data-pref="${control.name}" data-kind="switch" ${value ? 'checked' : ''} />`;
  }
  if (control.kind === 'select') {
    return `
      <select id="${id}" class="td-select" data-pref="${control.name}" data-kind="select">
        ${control.options.map((option) => `<option value="${option.value}" ${option.value === value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
      </select>
    `;
  }
  if (control.kind === 'segmented') {
    return `
      <div class="td-segmented" role="radiogroup" aria-labelledby="${id}-label" data-pref="${control.name}" data-kind="segmented">
        ${control.options.map((option) => `
          <button type="button" role="radio" data-value="${option.value}" aria-checked="${option.value === value}" tabindex="${option.value === value ? '0' : '-1'}">${escapeHtml(option.label)}</button>
        `).join('')}
      </div>
    `;
  }
  if (control.kind === 'swatches') {
    return `
      <div class="td-swatches" role="radiogroup" aria-labelledby="${id}-label" data-pref="${control.name}" data-kind="swatches">
        ${control.options.map((option) => `
          <button type="button" role="radio" data-value="${option.value}" aria-checked="${option.value === value}" tabindex="${option.value === value ? '0' : '-1'}" aria-label="${escapeHtml(option.label)}" title="${escapeHtml(option.label)}" style="--swatch: ${option.swatch}"></button>
        `).join('')}
      </div>
    `;
  }
  return `
    <div class="td-range">
      <input id="${id}" type="range" min="${control.min}" max="${control.max}" step="1" value="${value}" data-pref="${control.name}" data-kind="range" style="--fill: ${rangeFill(control.min, control.max, Number(value))}" />
      <output for="${id}" data-range-output="${control.name}">${value}${control.unit}</output>
    </div>
  `;
}

function rangeFill(min: number, max: number, value: number) {
  return `${((value - min) / (max - min)) * 100}%`;
}

function renderVaultControl() {
  return `
    <div class="settings-vault">
      <code data-vault-path title="">~/Documents/Tagdown</code>
      <button type="button" class="td-button" data-reveal-vault>${uiIcon('folder', 14)}<span>Reveal in Finder</span></button>
    </div>
  `;
}

function renderThemePicker() {
  const current = getThemePreference();
  const choices: Array<{ value: ThemePreference; title: string }> = [
    { value: 'system', title: 'System' },
    { value: 'light', title: 'Light' },
    { value: 'dark', title: 'Dark' },
  ];
  return `
    <div class="theme-picker" role="radiogroup" aria-label="Theme">
      ${choices.map((choice) => `
        <label class="theme-card">
          <input type="radio" name="theme-preference" value="${choice.value}" ${choice.value === current ? 'checked' : ''} />
          <span class="theme-thumb theme-thumb-${choice.value}" aria-hidden="true">
            <span class="theme-thumb-side"></span>
            <span class="theme-thumb-page"><i></i><i></i><i></i></span>
          </span>
          <span class="theme-card-label">${choice.title}</span>
        </label>
      `).join('')}
    </div>
    <p class="theme-summary">System follows macOS — currently <strong data-theme-summary>${getEffectiveTheme('system')}</strong>.</p>
  `;
}

function renderShortcuts() {
  return SHORTCUT_GROUPS.map((group) => `
    <section class="settings-group">
      <h3>${escapeHtml(group.title)}</h3>
      <div class="settings-card">
        ${group.shortcuts.map((shortcut) => `
          <div class="settings-row is-shortcut">
            <span class="settings-row-label">${escapeHtml(shortcut.action)}</span>
            <span class="settings-keys">${shortcut.keys.map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join('<span>or</span>')}</span>
          </div>
        `).join('')}
      </div>
    </section>
  `).join('');
}

// ---- Behaviour ----

function bindControls() {
  dialog?.querySelectorAll<HTMLElement>('[data-pref]').forEach((el) => {
    const name = el.dataset.pref as keyof Preferences;
    const kind = el.dataset.kind;

    if (kind === 'switch') {
      el.addEventListener('change', () => setPreference(name, (el as HTMLInputElement).checked as never));
    } else if (kind === 'select') {
      el.addEventListener('change', () => setPreference(name, (el as HTMLSelectElement).value as never));
    } else if (kind === 'range') {
      el.addEventListener('input', () => setPreference(name, Number((el as HTMLInputElement).value) as never));
    } else if (kind === 'segmented' || kind === 'swatches') {
      const options = [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
      options.forEach((option) => option.addEventListener('click', () => setPreference(name, option.dataset.value as never)));
      el.addEventListener('keydown', (event) => {
        const current = options.findIndex((option) => option === document.activeElement);
        if (current === -1) return;
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = options[(current + step + options.length) % options.length];
        next.focus();
        setPreference(name, next.dataset.value as never);
      });
    }
  });
}

/** Bring a control back in line with its preference, whoever changed it. */
function syncControl(name: keyof Preferences) {
  const el = dialog?.querySelector<HTMLElement>(`[data-pref="${name}"]`);
  if (!el) return;
  const value = getPreference(name);
  const kind = el.dataset.kind;
  if (kind === 'switch') (el as HTMLInputElement).checked = Boolean(value);
  else if (kind === 'select') (el as HTMLSelectElement).value = String(value);
  else if (kind === 'range') {
    const input = el as HTMLInputElement;
    input.value = String(value);
    input.style.setProperty('--fill', rangeFill(Number(input.min), Number(input.max), Number(value)));
  }
  else if (kind === 'segmented' || kind === 'swatches') {
    el.querySelectorAll<HTMLButtonElement>('[role="radio"]').forEach((option) => {
      const checked = option.dataset.value === value;
      option.setAttribute('aria-checked', String(checked));
      option.tabIndex = checked ? 0 : -1;
    });
  }
  const output = dialog?.querySelector<HTMLOutputElement>(`[data-range-output="${name}"]`);
  if (output) output.textContent = `${value}px`;
}

async function loadVaultPath() {
  const el = dialog?.querySelector<HTMLElement>('[data-vault-path]');
  if (!el) return;
  try {
    const path = await invoke<string>('vault_path');
    el.textContent = path.replace(/^\/Users\/[^/]+/, '~');
    el.title = path;
  } catch {
    // Outside the app (the browser preview) there is no vault to ask about.
  }
}

function bindThemePicker() {
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
  if (summary) summary.textContent = getEffectiveTheme('system');
}

function renderDocumentationPanel() {
  const nav = tagdownDocumentation.map((section, index) => `
    <button
      type="button"
      data-ref-component="${section.id}"
      aria-pressed="${index === 0}"
      tabindex="${index === 0 ? '0' : '-1'}"
    >${escapeHtml(section.title)}</button>
  `).join('');

  const detail = tagdownDocumentation.map((section, index) => `
    <section data-ref-panel="${section.id}" class="tagdown-ref-section" ${index === 0 ? '' : 'hidden'}>
      <h2>${escapeHtml(section.title)}</h2>
      <p class="tagdown-ref-summary">${escapeHtml(section.summary)}</p>
      ${section.examples.map((example) => `
        <div class="tagdown-ref-example">
          <h3>${escapeHtml(example.title)}</h3>
          <p class="tagdown-ref-example-desc">${escapeHtml(example.description)}</p>
          <div class="tagdown-reference-split">
            <div class="tagdown-reference-source">
              <div class="tagdown-reference-pane-label">Tagdown</div>
              <pre><code>${escapeHtml(example.syntax)}</code></pre>
            </div>
            <div class="tagdown-reference-rendered">
              <div class="tagdown-reference-pane-label">Preview</div>
              <div class="tagdown-reference-preview">${renderPreview(example.syntax)}</div>
            </div>
          </div>
        </div>
      `).join('')}
    </section>
  `).join('');

  return `
    <article
      id="settings-panel-tagdown-reference"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="settings-tab-tagdown-reference"
      hidden
      class="settings-panel tagdown-docs"
    >
      <nav class="tagdown-ref-nav" aria-label="Tagdown components">
        ${nav}
      </nav>
      <div class="tagdown-ref-detail">
        ${detail}
      </div>
    </article>
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
