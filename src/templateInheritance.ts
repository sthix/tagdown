import { valueText, type Property } from './propertyValues';

export type TemplateInheritance = {
  parent: string | null;
  parents: string[];
  excluded: string[];
  inherited: Array<{ property: Property; source: string; enabled: boolean; overridden: boolean }>;
  error: string | null;
};

export const isInheritanceKey = (key: string) => ['extends', 'exclude'].includes(key.toLowerCase());

/** The inherited schema is separate from the child's editable own properties. */
export function renderTemplateInheritance(host: HTMLElement, state: TemplateInheritance, save: (parent: string | null, excluded: string[]) => Promise<TemplateInheritance | null>) {
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Template inheritance');
  const parents = [...state.parents];
  if (state.parent && !parents.includes(state.parent)) parents.unshift(state.parent);
  host.innerHTML = `
    <div class="template-parent-row">
      <label>Parent type<select class="template-parent-select" aria-label="Parent type"><option value="">None</option>${parents.map((name) => `<option value="${escape(name)}" ${name === state.parent ? 'selected' : ''}>${escape(name)}</option>`).join('')}</select></label>
      <p>Inherit properties from another template. Add your own properties below; a matching name overrides the inherited value.</p>
    </div>
    ${state.error ? `<p class="template-inheritance-error" role="alert">${escape(state.error)}</p>` : ''}
    ${state.inherited.length ? `<details class="template-inherited" open><summary>Inherited properties <span>${state.inherited.length}</span></summary><div class="template-inherited-list">${state.inherited.map(({ property, source, enabled, overridden }) => `
      <label class="template-inherited-row ${!enabled && !overridden ? 'is-off' : ''}">
        <input type="checkbox" role="switch" class="td-switch" data-inherited-key="${escape(property.key)}" aria-label="Inherit ${escape(property.key)}" ${enabled || overridden ? 'checked' : ''} ${overridden ? 'disabled' : ''} />
        <span class="template-inherited-name">${escape(property.key)}</span>
        <span class="template-inherited-value">${escape(valueText(property) || 'Empty')}</span>
        <span class="template-inherited-source">${overridden ? 'Overridden below' : `From ${escape(source)}`}</span>
      </label>`).join('')}</div><p class="template-inheritance-help">Switch off properties you don’t need. To stop using an override, remove the matching property below. Changes apply to future notes; existing values are kept.</p></details>` : ''}`;
  let busy = false;
  const change = async (parent: string | null, excluded: string[], focus: string) => {
    if (busy) return;
    busy = true;
    host.setAttribute('aria-busy', 'true');
    const noteId = host.dataset.noteId;
    host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((el) => { el.disabled = true; });
    let next: TemplateInheritance | null = null;
    try { next = await save(parent, excluded); }
    finally {
      busy = false;
      host.removeAttribute('aria-busy');
      if (host.isConnected && host.dataset.noteId === noteId) {
        renderTemplateInheritance(host, next ?? state, save);
        host.querySelector<HTMLElement>(focus)?.focus();
      }
    }
  };
  host.querySelector<HTMLSelectElement>('select')?.addEventListener('change', (event) => {
    void change((event.target as HTMLSelectElement).value || null, [], 'select');
  });
  host.querySelectorAll<HTMLInputElement>('[data-inherited-key]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.inheritedKey!;
      const excluded = state.excluded.filter((name) => name.toLowerCase() !== key.toLowerCase());
      if (!input.checked) excluded.push(key);
      void change(state.parent, excluded, `[data-inherited-key="${CSS.escape(key)}"]`);
    });
  });
}
