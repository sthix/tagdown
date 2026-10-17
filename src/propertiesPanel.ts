// The properties panel under a note's title: its custom frontmatter entries
// as typed fields. Every change is written straight to the note's frontmatter
// by the vault (`set_property`); the body is never touched.
//
// Text and list values show rendered, so a `[[link]]` in a property can be
// clicked; a click elsewhere on the value edits it. Raw YAML (nested maps,
// block text) is shown but only editable in the file.

import { renderPreview } from './tagdown/renderer';
import {
  convertValue, defaultValue, EDITABLE_TYPES, keyProblem, parseInput, valueText,
  type Property, type PropertyType, type PropertyValue,
} from './propertyValues';

export type PanelOptions = {
  properties: Property[];
  /** Property names used anywhere in the vault, for suggestions. */
  keySuggestions: () => string[];
  /** Values the vault uses for `key`, for suggestions. */
  valueSuggestions: (key: string) => string[];
  /** What an empty value of `key` should be (“A Person”), if it has a meaning. */
  valueHint?: (key: string) => string | null;
  /** The type other notes give `key`, so a new property starts as that. */
  knownType: (key: string) => PropertyType | null;
  /** Write a change; `value: null` removes the property. Resolves false when it failed. */
  save: (key: string, value: PropertyValue | null, renameFrom?: string) => Promise<boolean>;
  /** Wikilinks and the like in rendered values. */
  decorate: (el: HTMLElement) => void;
  openLink: (target: string) => void;
  /** What to focus once drawn, after a change. */
  focus?: { key: string; part: 'key' | 'value' } | 'new';
  /** Folded to one summary line. */
  folded: boolean;
  /** The user folded or unfolded the panel. */
  onFold: (folded: boolean) => void;
  /** Property names (any case) kept out of sight in every note. */
  hidden: string[];
  /** Hide `key` in every note, or show it again. */
  onHide: (key: string, hide: boolean) => void;
};

const typeInfo = (type: PropertyType) => EDITABLE_TYPES.find((t) => t.type === type) ?? { type, label: 'YAML', icon: '{}' };

// Datalist ids must be unique while several notes are open side by side.
let panelCount = 0;

const CHEVRON = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.4 3.8L9.1 8l-3.7 4.2" /></svg>';

/** Whether a note's properties are folded: what the user last chose for it, else the preference. */
export function propertiesFolded(noteId: string, count: number, fallback: 'auto' | 'expanded' | 'collapsed'): boolean {
  const chosen = foldChoices()[noteId];
  if (chosen !== undefined) return chosen;
  return fallback === 'collapsed' || (fallback === 'auto' && count > 3);
}

export function setPropertiesFolded(noteId: string, folded: boolean) {
  const choices = foldChoices();
  choices[noteId] = folded;
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(choices)); } catch { /* not remembered */ }
}

const FOLD_KEY = 'tagdown.propertiesFolded';

function foldChoices(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') ?? {}; } catch { return {}; }
}

export function renderPropertiesPanel(host: HTMLElement, options: PanelOptions) {
  const hiddenKeys = new Set(options.hidden.map((k) => k.toLowerCase()));
  const isHidden = (p: Property) => hiddenKeys.has(p.key.toLowerCase());
  const focus = options.focus;
  const focusKey = focus && focus !== 'new' ? focus.key : null;
  // Focusing a hidden property (one just added under a hidden name, say) shows the hidden ones.
  if (focusKey && hiddenKeys.has(focusKey.toLowerCase())) host.dataset.showHidden = 'true';
  const showHidden = host.dataset.showHidden === 'true';
  const all = options.properties;
  const shown = all.filter((p) => showHidden || !isHidden(p));
  const hiddenCount = all.filter(isHidden).length;

  // Adding or editing a property unfolds the panel, and it stays open.
  let folded = options.folded;
  if (focus && folded) { folded = false; options.onFold(false); }
  const redraw = (patch: Partial<PanelOptions>) => renderPropertiesPanel(host, { ...options, focus: undefined, ...patch });

  host.innerHTML = '';
  host.classList.toggle('is-empty', all.length === 0);
  host.classList.toggle('is-folded', folded && all.length > 0);
  const uid = ++panelCount;

  if (all.length) {
    const head = el('div', 'props-head');
    const toggle = el('button', 'props-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!folded));
    toggle.title = `${folded ? 'Show' : 'Fold'} properties (⌘⇧I)`;
    const visibleCount = all.length - hiddenCount;
    toggle.innerHTML = `<span class="props-chevron" aria-hidden="true">${CHEVRON}</span><span>Properties</span><span class="props-count">${visibleCount}</span>`;
    toggle.addEventListener('click', () => { options.onFold(!folded); redraw({ folded: !folded }); });
    head.append(toggle);
    if (folded) {
      const summary = el('div', 'props-summary');
      for (const property of all.filter((p) => !isHidden(p))) {
        const chip = el('button', 'prop-chip');
        chip.type = 'button';
        chip.title = `${property.key}: ${valueText(property) || 'empty'}. Click to edit`;
        chip.innerHTML = `<span class="prop-chip-key">${escapeHtml(property.key)}</span><span class="prop-chip-value">${escapeHtml(chipText(property))}</span>`;
        chip.addEventListener('click', () => { options.onFold(false); redraw({ folded: false, focus: { key: property.key, part: 'value' } }); });
        summary.append(chip);
      }
      if (hiddenCount && !visibleCount) summary.append(Object.assign(el('span', 'props-summary-note'), { textContent: `${hiddenCount} hidden` }));
      head.append(summary);
    }
    const add = el('button', 'props-head-add');
    add.type = 'button';
    add.title = 'Add property';
    add.setAttribute('aria-label', 'Add property');
    add.textContent = '+';
    add.addEventListener('click', () => { options.onFold(false); redraw({ folded: false, focus: 'new' }); });
    head.append(add);
    host.append(head);
    if (folded) return;
  }

  const list = el('div', 'props');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Properties');
  const keyList = el('datalist');
  keyList.id = `td-prop-keys-${uid}`;
  const own = new Set(all.map((p) => p.key));
  keyList.append(...options.keySuggestions().filter((k) => !own.has(k)).map((k) => Object.assign(document.createElement('option'), { value: k })));
  host.append(keyList, list);

  const rowOptions = { ...options, listPrefix: `td-prop-values-${uid}`, keyListId: keyList.id };
  shown.forEach((property, index) => list.append(row(property, index, rowOptions, isHidden(property))));

  const foot = el('div', 'props-foot');
  const add = el('button', 'prop-add');
  add.type = 'button';
  add.innerHTML = '<span aria-hidden="true">+</span> Add property';
  add.addEventListener('click', () => {
    add.hidden = true;
    list.append(newRow(rowOptions, () => { add.hidden = false; }));
  });
  foot.append(add);
  if (hiddenCount) {
    const reveal = el('button', 'props-hidden-toggle');
    reveal.type = 'button';
    reveal.setAttribute('aria-pressed', String(showHidden));
    reveal.innerHTML = `${showHidden ? EYE_OFF : EYE}<span>${showHidden ? 'Hide' : 'Show'} ${hiddenCount} hidden</span>`;
    reveal.title = showHidden ? 'Hide the properties you chose to hide' : 'Show properties hidden in every note';
    reveal.addEventListener('click', () => {
      host.dataset.showHidden = String(!showHidden);
      redraw({});
    });
    foot.append(reveal);
  }
  host.append(foot);

  if (focus === 'new') add.click();
  else if (focus) {
    const target = list.querySelector<HTMLElement>(`.prop-row[data-key="${CSS.escape(focus.key)}"] ${focus.part === 'key' ? '.prop-key' : '.prop-value'}`);
    const field = target?.matches('input') ? target : target?.querySelector<HTMLElement>('input, button, [tabindex]');
    field?.focus();
    if (field && !(field instanceof HTMLInputElement)) field.click();
  }
}

const EYE = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.9" /></svg>';
const EYE_OFF = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 2.5l11 11" /><path d="M6.3 4C6.8 3.8 7.4 3.7 8 3.7c3.9 0 6.2 4.3 6.2 4.3s-.7 1.3-2 2.5M10 11.9c-.6.3-1.3.4-2 .4-3.9 0-6.2-4.3-6.2-4.3s.8-1.4 2.2-2.6" /><path d="M6.7 6.7a1.9 1.9 0 002.6 2.6" /></svg>';

/** A property's value in a few words, for the folded summary. */
function chipText(property: Property): string {
  if (property.type === 'checkbox') return property.value ? 'Yes' : 'No';
  if (property.type === 'raw') return '{…}';
  const text = property.type === 'list' ? property.value.join(', ') : valueText(property);
  const plain = text.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').trim();
  if (!plain) return '—';
  return plain.length > 32 ? `${plain.slice(0, 31)}…` : plain;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

type RowOptions = PanelOptions & { listPrefix: string; keyListId: string };

function row(property: Property, index: number, options: RowOptions, hidden: boolean): HTMLElement {
  const others = options.properties.map((p) => p.key).filter((k) => k !== property.key);
  const wrap = el('div', hidden ? 'prop-row is-hidden-prop' : 'prop-row');
  wrap.setAttribute('role', 'listitem');
  wrap.dataset.key = property.key;
  wrap.dataset.type = property.type;

  wrap.append(typeButton(property, options));

  const key = el('input', 'prop-key');
  key.value = property.key;
  key.spellcheck = false;
  key.setAttribute('list', options.keyListId);
  key.setAttribute('aria-label', 'Property name');
  const commitKey = async () => {
    const name = key.value.trim();
    if (name === property.key) return;
    const problem = keyProblem(name, others, property.key);
    if (problem) {
      key.setCustomValidity(problem);
      key.reportValidity();
      return;
    }
    key.setCustomValidity('');
    if (!(await options.save(name, value(property), property.key))) key.value = property.key;
  };
  key.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); key.blur(); }
    if (event.key === 'Escape') { key.value = property.key; key.setCustomValidity(''); key.blur(); }
  });
  key.addEventListener('input', () => key.setCustomValidity(''));
  key.addEventListener('blur', () => void commitKey());
  wrap.append(key);

  const cell = el('div', 'prop-value');
  cell.append(propertyField(property, {
    save: (next) => options.save(property.key, next),
    decorate: options.decorate,
    openLink: options.openLink,
    suggestions: () => options.valueSuggestions(property.key),
    listId: `${options.listPrefix}-${index}`,
    emptyLabel: options.valueHint?.(property.key) ?? undefined,
  }));
  wrap.append(cell);

  const actions = el('div', 'prop-actions');
  const hide = el('button', 'prop-hide');
  hide.type = 'button';
  hide.innerHTML = hidden ? EYE : EYE_OFF;
  hide.title = hidden ? `Show “${property.key}” in every note again` : `Hide “${property.key}” in every note`;
  hide.setAttribute('aria-label', hide.title);
  hide.addEventListener('click', () => options.onHide(property.key, !hidden));
  const remove = el('button', 'prop-remove');
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = `Remove “${property.key}”`;
  remove.setAttribute('aria-label', `Remove ${property.key}`);
  remove.addEventListener('click', () => void options.save(property.key, null));
  actions.append(hide, remove);
  wrap.append(actions);
  return wrap;
}

function value(property: Property): PropertyValue {
  const { key: _key, ...rest } = property;
  return rest as PropertyValue;
}

/** The type icon, which opens a menu to change the type. */
function typeButton(property: Property, options: PanelOptions): HTMLElement {
  const info = typeInfo(property.type);
  const holder = el('div', 'prop-type');
  const button = el('button', 'prop-type-button');
  button.type = 'button';
  button.textContent = info.icon;
  button.title = property.type === 'raw' ? 'YAML Tagdown can’t edit; change it in the file' : `${info.label}: change type`;
  button.setAttribute('aria-label', `${property.key} is ${info.label}. Change type`);
  button.setAttribute('aria-haspopup', 'menu');
  holder.append(button);
  if (property.type === 'raw') {
    button.disabled = true;
    return holder;
  }
  button.addEventListener('click', () => {
    const open = holder.querySelector('.prop-type-menu');
    if (open) { open.remove(); return; }
    const menu = el('div', 'prop-type-menu');
    menu.setAttribute('role', 'menu');
    for (const option of EDITABLE_TYPES) {
      const item = el('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(option.type === property.type));
      item.innerHTML = `<span class="prop-type-icon" aria-hidden="true">${option.icon}</span>${option.label}`;
      item.addEventListener('click', () => {
        menu.remove();
        if (option.type !== property.type) void options.save(property.key, convertValue(value(property), option.type));
      });
      menu.append(item);
    }
    holder.append(menu);
    (menu.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
    const close = (event: Event) => {
      if (holder.contains(event.target as Node)) return;
      menu.remove();
      document.removeEventListener('mousedown', close, true);
    };
    document.addEventListener('mousedown', close, true);
    menu.addEventListener('keydown', (event) => { if (event.key === 'Escape') { menu.remove(); button.focus(); } });
  });
  return holder;
}

export type FieldOptions = {
  /** Write the new value; resolves false when that failed. */
  save: (value: PropertyValue) => Promise<boolean>;
  decorate: (el: HTMLElement) => void;
  openLink: (target: string) => void;
  /** Values to suggest while typing. */
  suggestions: () => string[];
  /** Unique id for the suggestions list. */
  listId: string;
  /** The note doesn't have this property yet: number and date fields start empty. */
  blank?: boolean;
  /** Shown for an empty text or list (“Empty” by default). */
  emptyLabel?: string;
};

/**
 * An editable field for one property value: a checkbox, a number or date
 * input, or text and lists shown rendered (links work) and edited on click.
 */
export function propertyField(property: Property, field: FieldOptions): HTMLElement {
  switch (property.type) {
    case 'checkbox': {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = property.value;
      box.setAttribute('aria-label', property.key);
      box.addEventListener('change', () => {
        void field.save({ type: 'checkbox', value: box.checked }).then((ok) => { if (!ok) box.checked = !box.checked; });
      });
      return box;
    }
    case 'number':
    case 'date': {
      const input = el('input', 'prop-input');
      input.type = property.type;
      const shown = field.blank ? '' : String(property.value);
      input.value = shown;
      input.classList.toggle('is-blank', !!field.blank);
      input.setAttribute('aria-label', property.key);
      if (property.type === 'number') input.step = 'any';
      const type = property.type;
      const commit = () => {
        const next = parseInput(type, input.value);
        if (!next) { input.value = shown; return; }
        if (field.blank || valueText(next) !== valueText(property)) void field.save(next);
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
        if (event.key === 'Escape') { input.value = shown; input.blur(); }
      });
      return input;
    }
    case 'raw': {
      const code = el('code', 'prop-raw');
      code.textContent = property.value.trim();
      code.title = 'Nested YAML: edit it in the note’s file';
      return code;
    }
    default:
      return textField(property, field);
  }
}

/** Text and lists: shown rendered (links work), edited in a text field. */
function textField(property: Property & ({ type: 'text' } | { type: 'list' }), field: FieldOptions): HTMLElement {
  const holder = el('div', 'prop-text');
  const show = () => {
    holder.innerHTML = '';
    const view = el('div', 'prop-display');
    view.tabIndex = 0;
    view.setAttribute('role', 'button');
    view.setAttribute('aria-label', `Edit ${property.key}`);
    const items = property.type === 'list' ? property.value : property.value ? [property.value] : [];
    if (!items.length) {
      view.classList.add('is-empty');
      view.textContent = field.emptyLabel ?? 'Empty';
    } else {
      view.innerHTML = items.map((item) => `<span class="prop-item">${inlineHtml(item)}</span>`).join('');
      view.classList.toggle('is-list', property.type === 'list');
      field.decorate(view);
    }
    view.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLElement>('.td-wikilink');
      if (link) {
        // Inside a note's preview, its own link handling mustn't run as well.
        event.preventDefault();
        event.stopPropagation();
        field.openLink(link.dataset.target || '');
        return;
      }
      edit();
    });
    view.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(); }
    });
    holder.append(view);
  };
  const edit = () => {
    holder.innerHTML = '';
    const input = el('input', 'prop-input');
    input.value = valueText(property);
    input.spellcheck = false;
    input.setAttribute('aria-label', property.key);
    if (property.type === 'list') input.placeholder = 'Comma, separated, items';
    if (field.emptyLabel) input.placeholder = property.type === 'list' ? `${field.emptyLabel}, comma-separated` : field.emptyLabel;
    const suggestions = field.suggestions();
    if (suggestions.length) {
      const list = el('datalist');
      list.id = field.listId;
      list.append(...suggestions.map((v) => Object.assign(document.createElement('option'), { value: v })));
      holder.append(list);
      input.setAttribute('list', list.id);
    }
    let done = false;
    const finish = async (keep: boolean) => {
      if (done) return;
      done = true;
      const next = keep ? parseInput(property.type, input.value) : null;
      if (next && valueText(next) !== valueText(property)) {
        if (await field.save(next)) return;
      }
      show();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); void finish(false); }
    });
    input.addEventListener('blur', () => void finish(true));
    holder.append(input);
    input.focus();
    input.select();
  };
  show();
  return holder;
}

/** A row for a new property: its name first, as text, then its value. */
function newRow(options: RowOptions, cancel: () => void): HTMLElement {
  const wrap = el('div', 'prop-row is-new');
  const type = el('div', 'prop-type');
  type.innerHTML = `<span class="prop-type-button" aria-hidden="true">${typeInfo('text').icon}</span>`;
  const key = el('input', 'prop-key');
  key.placeholder = 'Property name';
  key.spellcheck = false;
  key.setAttribute('list', options.keyListId);
  key.setAttribute('aria-label', 'New property name');
  let done = false;
  const finish = async (keep: boolean) => {
    if (done) return;
    const name = key.value.trim();
    if (!keep || !name) {
      done = true;
      wrap.remove();
      cancel();
      return;
    }
    const problem = keyProblem(name, options.properties.map((p) => p.key));
    if (problem) {
      key.setCustomValidity(problem);
      key.reportValidity();
      return;
    }
    done = true;
    // A name other notes use starts with the type they give it.
    const known = options.knownType(name);
    if (!(await options.save(name, defaultValue(known && known !== 'raw' ? known : 'text')))) done = false;
  };
  key.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); void finish(false); }
  });
  key.addEventListener('input', () => key.setCustomValidity(''));
  key.addEventListener('blur', () => void finish(true));
  wrap.append(type, key);
  queueMicrotask(() => key.focus());
  return wrap;
}

/** A value rendered like note text, without the paragraph around it. */
function inlineHtml(text: string): string {
  const holder = document.createElement('div');
  holder.innerHTML = renderPreview(text);
  const only = holder.children.length === 1 && holder.firstElementChild?.tagName === 'P' ? holder.firstElementChild : holder;
  return only.innerHTML;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
