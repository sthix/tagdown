import type { Edit } from './listEditing';
import { caretPosition } from './wikilinks';

export type InsertableTemplate = { name: string; templateId: string | null; icon?: string | null };
export type TemplateTarget = { textarea: HTMLTextAreaElement; original: string; from: number; to: number; isCurrent: () => boolean };
type TemplatePickerOptions = {
  templates: () => InsertableTemplate[];
  currentId: () => string | null;
  create: (template: InsertableTemplate, target: TemplateTarget) => Promise<void>;
};

/** A distinct draft name lets normal title renaming update only this note's links. */
export function templateNoteTitle(name: string, taken: string[]): string {
  const clean = name.replace(/[\[\]#|\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || 'note';
  const base = `New ${clean}`;
  const used = new Set(taken.map(title => title.trim().toLowerCase()));
  let title = base;
  for (let count = 2; used.has(title.toLowerCase()); count++) title = `${base} ${count}`;
  return title;
}

/** Replace the command's position with a real link, including in an empty block. */
export function templateReferenceEdit(text: string, from: number, to: number, title: string): Edit {
  if (from < 0 || to < from || to > text.length) throw new Error('The template insertion point changed.');
  if (!title.trim() || /[\[\]#|\r\n]/.test(title)) throw new Error('The new note needs a linkable title.');
  const link = `[[${title}]]`;
  return { from, to, text: link, selStart: from + link.length, selEnd: from + link.length };
}

let closePicker: (() => void) | null = null;

export function openTemplatePicker(textarea: HTMLTextAreaElement, options: TemplatePickerOptions) {
  closePicker?.();
  const original = textarea.value;
  const from = textarea.selectionStart;
  const to = textarea.selectionEnd;
  const targetId = options.currentId();
  const templates = options.templates().filter(template => template.templateId);
  const menu = document.createElement('div');
  menu.className = 'slash-menu template-picker'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'New note from template');
  const input = document.createElement('input');
  input.type = 'search'; input.placeholder = 'Choose a template'; input.setAttribute('aria-label', 'Choose a template'); input.className = 'template-picker-search';
  const list = document.createElement('div'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Templates');
  menu.append(input, list); document.body.append(menu);
  let matches = templates;
  let active = 0;
  let busy = false;
  let closed = false;
  const close = (focus = true) => {
    closed = true; menu.remove(); document.removeEventListener('mousedown', outside, true);
    if (closePicker === close) closePicker = null;
    if (focus && textarea.isConnected) textarea.focus();
  };
  const outside = (event: MouseEvent) => {
    if (menu.contains(event.target as Node)) return;
    if (busy) { event.preventDefault(); event.stopPropagation(); return; }
    close(false);
  };
  closePicker = close;
  document.addEventListener('mousedown', outside, true);
  const isCurrent = () => !closed && textarea.isConnected && textarea.value === original && options.currentId() === targetId;
  const accept = async (template?: InsertableTemplate) => {
    if (busy || !template?.templateId || !isCurrent()) return;
    busy = true; input.readOnly = true; menu.setAttribute('aria-busy', 'true'); list.textContent = 'Creating note…';
    try {
      await options.create(template, { textarea, original, from, to, isCurrent });
      close(false);
    } catch (error) {
      if (!closed) {
        list.textContent = `Could not create the note: ${String(error)}`; list.setAttribute('role', 'alert');
        input.readOnly = false; menu.removeAttribute('aria-busy'); input.focus();
      }
    } finally { busy = false; }
  };
  const render = () => {
    list.setAttribute('role', 'listbox'); list.replaceChildren();
    if (!matches.length) { list.textContent = templates.length ? 'No matching templates' : 'Enable or create a template in Settings to get started.'; return; }
    matches.forEach((template, index) => {
      const row = document.createElement('div'); row.className = `slash-menu-row${active === index ? ' active' : ''}`;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(active === index));
      const icon = document.createElement('span'); icon.className = 'slash-menu-icon'; icon.textContent = template.icon ?? '▤';
      const label = document.createElement('strong'); label.textContent = template.name;
      row.append(icon, label); row.addEventListener('mousedown', event => event.preventDefault()); row.addEventListener('click', () => void accept(template)); list.append(row);
    });
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { matches = templates.filter(template => template.name.toLowerCase().includes(input.value.trim().toLowerCase())); active = 0; render(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (busy) { if (['Escape', 'Tab', 'Enter'].includes(event.key)) event.preventDefault(); return; }
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (!matches.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; render(); }
    else if (event.key === 'Enter') { event.preventDefault(); void accept(matches[active]); }
    else if (event.key === 'Tab') close();
  });
  render();
  const caret = caretPosition(textarea, from);
  const width = Math.min(320, window.innerWidth - 16);
  menu.style.width = `${width}px`; menu.style.left = `${Math.max(8, Math.min(caret.left, window.innerWidth - width - 8))}px`;
  const below = caret.top + caret.height + 6;
  menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, caret.top - menu.offsetHeight - 6) : below}px`;
  input.focus();
}
