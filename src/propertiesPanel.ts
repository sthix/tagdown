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
  /** The type other notes give `key`, so a new property starts as that. */
  knownType: (key: string) => PropertyType | null;
  /** Write a change; `value: null` removes the property. Resolves false when it failed. */
  save: (key: string, value: PropertyValue | null, renameFrom?: string) => Promise<boolean>;
  /** Wikilinks and the like in rendered values. */
  decorate: (el: HTMLElement) => void;
  openLink: (target: string) => void;
  /** What to focus once drawn, after a change. */
  focus?: { key: string; part: 'key' | 'value' } | 'new';
};

const typeInfo = (type: PropertyType) => EDITABLE_TYPES.find((t) => t.type === type) ?? { type, label: 'YAML', icon: '{}' };

export function renderPropertiesPanel(host: HTMLElement, options: PanelOptions) {
  const { properties } = options;
  host.innerHTML = '';
  host.classList.toggle('is-empty', properties.length === 0);
  const list = el('div', 'props');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Properties');
  const keyList = el('datalist');
  keyList.id = 'td-prop-keys';
  const own = new Set(properties.map((p) => p.key));
  keyList.append(...options.keySuggestions().filter((k) => !own.has(k)).map((k) => Object.assign(document.createElement('option'), { value: k })));
  host.append(keyList, list);

  properties.forEach((property, index) => list.append(row(property, index, options)));

  const add = el('button', 'prop-add');
  add.type = 'button';
  add.innerHTML = '<span aria-hidden="true">+</span> Add property';
  add.addEventListener('click', () => {
    add.hidden = true;
    list.append(newRow(options, () => { add.hidden = false; }));
  });
  host.append(add);

  const focus = options.focus;
  if (focus === 'new') add.click();
  else if (focus) {
    const target = list.querySelector<HTMLElement>(`.prop-row[data-key="${CSS.escape(focus.key)}"] ${focus.part === 'key' ? '.prop-key' : '.prop-value'}`);
    const field = target?.matches('input') ? target : target?.querySelector<HTMLElement>('input, button, [tabindex]');
    field?.focus();
    if (field && !(field instanceof HTMLInputElement)) field.click();
  }
}

function row(property: Property, index: number, options: PanelOptions): HTMLElement {
  const others = options.properties.map((p) => p.key).filter((k) => k !== property.key);
  const wrap = el('div', 'prop-row');
  wrap.setAttribute('role', 'listitem');
  wrap.dataset.key = property.key;
  wrap.dataset.type = property.type;

  wrap.append(typeButton(property, options));

  const key = el('input', 'prop-key');
  key.value = property.key;
  key.spellcheck = false;
  key.setAttribute('list', 'td-prop-keys');
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
  cell.append(valueControl(property, index, options));
  wrap.append(cell);

  const remove = el('button', 'prop-remove');
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = `Remove “${property.key}”`;
  remove.setAttribute('aria-label', `Remove ${property.key}`);
  remove.addEventListener('click', () => void options.save(property.key, null));
  wrap.append(remove);
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

function valueControl(property: Property, index: number, options: PanelOptions): HTMLElement {
  const save = (next: PropertyValue) => options.save(property.key, next);
  switch (property.type) {
    case 'checkbox': {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = property.value;
      box.setAttribute('aria-label', property.key);
      box.addEventListener('change', () => void save({ type: 'checkbox', value: box.checked }));
      return box;
    }
    case 'number':
    case 'date': {
      const input = el('input', 'prop-input');
      input.type = property.type;
      input.value = String(property.value);
      input.setAttribute('aria-label', property.key);
      if (property.type === 'number') input.step = 'any';
      const type = property.type;
      const commit = () => {
        const next = parseInput(type, input.value);
        if (!next) { input.value = String(property.value); return; }
        if (valueText(next) !== valueText(property)) void save(next);
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
        if (event.key === 'Escape') { input.value = String(property.value); input.blur(); }
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
      return textControl(property, index, options);
  }
}

/** Text and lists: shown rendered (links work), edited in a text field. */
function textControl(property: Property & ({ type: 'text' } | { type: 'list' }), index: number, options: PanelOptions): HTMLElement {
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
      view.textContent = 'Empty';
    } else {
      view.innerHTML = items.map((item) => `<span class="prop-item">${inlineHtml(item)}</span>`).join('');
      view.classList.toggle('is-list', property.type === 'list');
      options.decorate(view);
    }
    view.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLElement>('.td-wikilink');
      if (link) {
        event.preventDefault();
        options.openLink(link.dataset.target || '');
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
    const suggestions = options.valueSuggestions(property.key);
    if (suggestions.length) {
      const list = el('datalist');
      list.id = `td-prop-values-${index}`;
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
        if (await options.save(property.key, next)) return;
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
function newRow(options: PanelOptions, cancel: () => void): HTMLElement {
  const wrap = el('div', 'prop-row is-new');
  const type = el('div', 'prop-type');
  type.innerHTML = `<span class="prop-type-button" aria-hidden="true">${typeInfo('text').icon}</span>`;
  const key = el('input', 'prop-key');
  key.placeholder = 'Property name';
  key.spellcheck = false;
  key.setAttribute('list', 'td-prop-keys');
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
