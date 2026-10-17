// Link fields: properties a note type's template declares as links to notes
// of another type (`author: "[[Person]]"`, see types.rs). What's typed into one
// becomes [[links]], so "Frank Herbert" is saved as "[[Frank Herbert]]".

import type { PropertyValue } from './propertyValues';

export type LinkField = { key: string; target: string; list: boolean };

const LINK = /^\[\[([^\]|#]+)[^\]]*\]\]$/;

/** One value as a link, and the title it links to (null for an empty one). */
function asLink(text: string): { text: string; title: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { text: '', title: null };
  const link = trimmed.match(LINK);
  if (link) return { text: trimmed, title: link[1].trim() };
  const title = trimmed.replace(/[[\]|#^]/g, '').trim();
  return title ? { text: `[[${title}]]`, title } : { text: '', title: null };
}

/** `value` with plain names made into [[links]], and the titles it links to. */
export function asLinks(value: PropertyValue): { value: PropertyValue; titles: string[] } {
  if (value.type === 'text') {
    const { text, title } = asLink(value.value);
    return { value: { type: 'text', value: text }, titles: title ? [title] : [] };
  }
  if (value.type === 'list') {
    const links = value.value.map(asLink).filter((l) => l.title);
    return { value: { type: 'list', value: links.map((l) => l.text) }, titles: links.map((l) => l.title!) };
  }
  return { value, titles: [] };
}

/** How an empty link field reads: "A Person", or "Person notes" for a list. */
export function linkHint(field: LinkField): string {
  return field.list ? `${field.target} notes` : `${/^[aeiou]/i.test(field.target) ? 'An' : 'A'} ${field.target}`;
}
