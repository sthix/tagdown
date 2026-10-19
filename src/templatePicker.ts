import { applyCommand } from './slashCommands';
import { applyEdit, type Edit } from './listEditing';
import { caretPosition } from './wikilinks';
import { parseDayKey, shiftDay, todayKey } from './journal';

export type InsertableTemplate = { name: string; templateId: string | null; icon?: string | null };
export type TemplatePickerOptions = {
  templates: () => InsertableTemplate[];
  load: (id: string) => Promise<string>;
  title: () => string;
  currentId?: () => string | null;
  /** Journal editors can fill dates using the page's day. */
  day?: () => string;
};

/** Metadata stays with the template; only its body is inserted. */
export function templateBody(content: string, title: string, day = todayKey()): string {
  let body = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  body = body.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '');
  let fence: string | null = null;
  const lines = body.split('\n');
  const heading = lines.findIndex((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return false;
    }
    return !fence && /^#\s+/.test(line);
  });
  if (heading >= 0) lines.splice(heading, 1);
  const date = parseDayKey(day) ?? parseDayKey(todayKey())!;
  const replacements: Record<string, string> = {
    title, date: day, yesterday: shiftDay(day, -1), tomorrow: shiftDay(day, 1),
    weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
  };
  return lines.join('\n').trim().replace(/\{\{(title|date|yesterday|tomorrow|weekday)\}\}/g, (_, key: string) => replacements[key]);
}

export function templateInsertion(text: string, from: number, to: number, content: string, title: string, day?: string): Edit | null {
  const body = templateBody(content, title, day);
  if (!body) return null;
  return applyCommand(text, from, to, { id: 'template', label: 'Template', description: '', group: 'Basic blocks', icon: '▤', block: body, literal: true });
}

let closePicker: (() => void) | null = null;

/** A searchable keyboard picker using the same popup treatment as slash commands. */
export function openTemplatePicker(textarea: HTMLTextAreaElement, options: TemplatePickerOptions) {
  closePicker?.();
  const original = textarea.value;
  const from = textarea.selectionStart;
  const to = textarea.selectionEnd;
  const targetId = options.currentId?.();
  const title = options.title();
  const day = options.day?.();
  const templates = options.templates().filter((t) => t.templateId);
  const menu = document.createElement('div');
  menu.className = 'slash-menu template-picker';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Insert template');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Find a template';
  input.setAttribute('aria-label', 'Find a template');
  input.className = 'template-picker-search';
  const list = document.createElement('div');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Templates');
  menu.append(input, list);
  document.body.append(menu);
  let matches = templates;
  let active = 0;
  let busy = false;
  let closed = false;
  const close = (focus = true) => {
    closed = true;
    menu.remove();
    document.removeEventListener('mousedown', outside);
    if (closePicker === close) closePicker = null;
    if (focus && textarea.isConnected) textarea.focus();
  };
  const outside = (event: MouseEvent) => { if (!menu.contains(event.target as Node)) close(false); };
  closePicker = close;
  document.addEventListener('mousedown', outside);

  const accept = async (template?: InsertableTemplate) => {
    if (busy || !template?.templateId) return;
    busy = true;
    input.readOnly = true;
    menu.setAttribute('aria-busy', 'true');
    list.textContent = 'Loading template…';
    try {
      const content = await options.load(template.templateId);
      if (closed) return;
      // A file watcher or a navigation may have replaced this editor while loading.
      if (!textarea.isConnected || textarea.value !== original || options.currentId?.() !== targetId) { close(false); return; }
      const edit = templateInsertion(original, from, to, content, title, day);
      close();
      if (edit) applyEdit(textarea, edit);
    } catch (error) {
      if (!closed) {
        list.textContent = `Could not load template: ${String(error)}`;
        list.setAttribute('role', 'alert');
        input.readOnly = false;
        menu.removeAttribute('aria-busy');
        input.focus();
      }
    } finally { busy = false; }
  };
  const render = () => {
    list.setAttribute('role', 'listbox');
    list.replaceChildren();
    if (!matches.length) { list.textContent = templates.length ? 'No matching templates' : 'No enabled templates. Create a note titled "Name Template" to add one.'; return; }
    matches.forEach((template, index) => {
      const row = document.createElement('div');
      row.className = `slash-menu-row${active === index ? ' active' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(active === index));
      const icon = document.createElement('span');
      icon.className = 'slash-menu-icon';
      icon.textContent = template.icon ?? '▤';
      const label = document.createElement('strong');
      label.textContent = template.name;
      row.append(icon, label);
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => void accept(template));
      list.append(row);
    });
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    matches = templates.filter((t) => t.name.toLowerCase().includes(query));
    active = 0;
    render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (busy || !matches.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      render();
    } else if (event.key === 'Enter') { event.preventDefault(); void accept(matches[active]); }
    else if (event.key === 'Tab') close();
  });
  render();
  const caret = caretPosition(textarea, from);
  const width = Math.min(320, window.innerWidth - 16);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(8, Math.min(caret.left, window.innerWidth - width - 8))}px`;
  const below = caret.top + caret.height + 6;
  menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, caret.top - menu.offsetHeight - 6) : below}px`;
  input.focus();
}
