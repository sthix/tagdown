// Note properties as the vault sends them (see properties.rs): custom
// frontmatter entries with a type read from their value. These helpers convert
// and format values for the properties panel and query results.

export type TextType = 'text' | 'longtext' | 'url' | 'email' | 'phone' | 'select';
export type NumberType = 'number' | 'currency' | 'percent' | 'duration' | 'rating';
export type ListType = 'list' | 'multiselect';
export type PropertyType = TextType | NumberType | ListType | 'checkbox' | 'date' | 'datetime' | 'raw';

export type PropertyValue =
  | { type: TextType; value: string }
  | { type: NumberType; value: number }
  | { type: 'checkbox'; value: boolean }
  | { type: 'date' | 'datetime'; value: string }
  | { type: ListType; value: string[] }
  | { type: 'raw'; value: string };

export type Property = { key: string } & PropertyValue;

/** Types a property can be switched to (raw YAML is only kept, never made). */
export const EDITABLE_TYPES: Array<{ type: Exclude<PropertyType, 'raw'>; label: string; icon: string }> = [
  { type: 'text', label: 'Text', icon: 'Aa' },
  { type: 'longtext', label: 'Long text', icon: '¶' },
  { type: 'number', label: 'Number', icon: '#' },
  { type: 'currency', label: 'Currency', icon: '¤' },
  { type: 'percent', label: 'Percent', icon: '%' },
  { type: 'duration', label: 'Duration', icon: '◴' },
  { type: 'rating', label: 'Rating', icon: '★' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑' },
  { type: 'date', label: 'Date', icon: '◷' },
  { type: 'datetime', label: 'Date and time', icon: '◷' },
  { type: 'url', label: 'URL', icon: '↗' },
  { type: 'email', label: 'Email', icon: '@' },
  { type: 'phone', label: 'Phone', icon: '☎' },
  { type: 'select', label: 'Single select', icon: '⌄' },
  { type: 'multiselect', label: 'Multiple select', icon: '☷' },
  { type: 'list', label: 'List', icon: '≡' },
];

/** Keys Tagdown manages itself; they can't be properties. */
export const MANAGED_KEYS = ['id', 'title', 'tags', 'starred', 'folder_id', 'created', 'updated', 'journal'];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The value a new property of `type` starts with. */
export function defaultValue(type: Exclude<PropertyType, 'raw'>, day: string = today()): PropertyValue {
  switch (type) {
    case 'text': case 'longtext': case 'url': case 'email': case 'phone': case 'select': return { type, value: '' };
    case 'number': case 'currency': case 'percent': case 'duration': case 'rating': return { type, value: 0 };
    case 'checkbox': return { type, value: false };
    case 'date': return { type, value: day };
    case 'datetime': return { type, value: `${day}T00:00:00` };
    case 'list': case 'multiselect': return { type, value: [] };
  }
}

/** One line of text for a value: lists joined with commas. */
export function valueText(value: PropertyValue): string {
  switch (value.type) {
    case 'list': case 'multiselect': return value.value.join(', ');
    case 'number': case 'currency': case 'percent': case 'duration': case 'rating': return String(value.value);
    case 'checkbox': return value.value ? 'true' : 'false';
    default: return value.value;
  }
}

/** Text for display; the stored percent is a fraction and duration is seconds. */
export function displayText(value: PropertyValue): string {
  switch (value.type) {
    case 'currency': return `¤${value.value.toFixed(2)}`;
    case 'percent': return `${Number((value.value * 100).toFixed(8))}%`;
    case 'duration': {
      const seconds = value.value;
      const tail = String(Number((seconds % 60).toFixed(8)));
      return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${seconds % 60 < 10 ? '0' : ''}${tail}`;
    }
    case 'rating': return '★'.repeat(value.value) + '☆'.repeat(5 - value.value);
    case 'datetime': return value.value.replace('T', ' ');
    default: return valueText(value);
  }
}

/** Lossless input for lists, including commas and quotes inside an item. */
export function inputText(value: PropertyValue): string {
  if (value.type === 'list' || value.type === 'multiselect') {
    return value.value.map((item) => /[,"\\]/.test(item) ? JSON.stringify(item) : item).join(', ');
  }
  if (value.type === 'percent') return String(value.value * 100);
  if (value.type === 'duration') {
    const formatted = displayText(value);
    return parseInput('duration', formatted)?.value === value.value ? formatted : String(value.value);
  }
  return valueText(value);
}

function validDay(text: string): boolean {
  return ISO_DAY.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
}

/**
 * Items typed into a list field, separated by commas. A comma inside a
 * `[[link]]` or "quotes" doesn't split.
 */
export function parseListInput(input: string): string[] {
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const ch of input) {
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === '\\' && quoted) { current += ch; escaped = true; continue; }
    if (ch === '"') quoted = !quoted;
    else if (ch === '[' && !quoted) depth++;
    else if (ch === ']' && !quoted) depth = Math.max(0, depth - 1);
    if (ch === ',' && !quoted && depth === 0) {
      items.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  items.push(current);
  return items.map((item) => {
    const text = item.trim();
    try { return text.startsWith('"') ? JSON.parse(text) as string : text; } catch { return text; }
  }).filter((item) => typeof item === 'string' && !!item);
}

/** Text typed into the field for `type`, as a value; null when it can't be one. */
export function parseInput(type: Exclude<PropertyType, 'raw'>, input: string): PropertyValue | null {
  const text = input.trim();
  switch (type) {
    case 'longtext': return { type, value: input };
    case 'text': case 'select': return { type, value: text };
    case 'url': {
      if (!text) return { type, value: '' };
      try { const url = new URL(text); return ['http:', 'https:'].includes(url.protocol) ? { type, value: text } : null; } catch { return null; }
    }
    case 'email': return !text || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? { type, value: text } : null;
    case 'phone': return !text || (/^\+?[\d\s().\-x#]+$/i.test(text) && /\d/.test(text)) ? { type, value: text } : null;
    case 'number': case 'currency': case 'percent': case 'rating': {
      if (!text) return null;
      let n = Number((type === 'percent' ? text.replace(/%$/, '') : text).replace(',', '.'));
      if (type === 'percent') n /= 100;
      if (type === 'rating' && (!Number.isInteger(n) || n < 0 || n > 5)) return null;
      return Number.isFinite(n) ? { type, value: n } : null;
    }
    case 'checkbox': return { type, value: /^(true|yes|1|x)$/i.test(text) };
    case 'date': return validDay(text) ? { type, value: text } : null;
    case 'datetime': return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text) && validDay(text.slice(0, 10)) && Number(text.slice(11, 13)) < 24 && Number(text.slice(14, 16)) < 60 && Number(text.slice(17, 19) || 0) < 60 ? { type, value: text.length === 16 ? `${text}:00` : text } : null;
    case 'duration': {
      if (text && !text.includes(':')) {
        const n = Number(text.replace(',', '.'));
        return Number.isFinite(n) && n >= 0 ? { type, value: n } : null;
      }
      const parts = text.split(':');
      if (!text || parts.length > 3 || !parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
      if (parts.length > 1 && (parts.slice(1).some((p) => Number(p) >= 60) || parts.slice(0, -1).some((p) => p.includes('.')))) return null;
      const n = parts.reduce((total, p) => total * 60 + Number(p), 0);
      return Number.isFinite(n) ? { type, value: n } : null;
    }
    case 'list': return { type, value: parseListInput(text) };
    case 'multiselect': return { type, value: [...new Set(parseListInput(text))] };
  }
}

/** `value` as `type`, keeping what can be kept (text "3" becomes the number 3). */
export function convertValue(value: PropertyValue, type: Exclude<PropertyType, 'raw'>): PropertyValue {
  if (value.type === type) return value;
  if (type === 'list' || type === 'multiselect') {
    const items = value.type === 'list' || value.type === 'multiselect' ? value.value : valueText(value).trim() ? [valueText(value)] : [];
    return { type, value: type === 'multiselect' ? [...new Set(items)] : items };
  }
  if (['number', 'currency', 'percent', 'duration', 'rating'].includes(type) && typeof value.value === 'number') {
    const n = value.value;
    if ((type !== 'duration' || n >= 0) && (type !== 'rating' || Number.isInteger(n) && n >= 0 && n <= 5)) return { type: type as NumberType, value: n };
    return defaultValue(type);
  }
  if (type === 'datetime' && value.type === 'date') return { type, value: `${value.value}T00:00:00` };
  if (type === 'date' && value.type === 'datetime') return { type, value: value.value.slice(0, 10) };
  const text = value.type === 'list' || value.type === 'multiselect' ? value.value[0] ?? '' : valueText(value);
  return parseInput(type, text) ?? defaultValue(type);
}

/** Why `key` can't name a new property of this note, or null when it can. */
export function keyProblem(key: string, existing: string[], renaming?: string): string | null {
  const name = key.trim();
  if (!name) return 'A property needs a name.';
  if (MANAGED_KEYS.includes(name.toLowerCase())) return `“${name}” is managed by Tagdown.`;
  if (/^[#\-'"[{ ]/.test(name) || /[:\r\n]/.test(name)) return `“${name}” can’t be a property name.`;
  if (name !== renaming && existing.includes(name)) return `This note already has “${name}”.`;
  return null;
}

/** `icon` is a note's own emoji, shown in place of its type's. */
export const isIconKey = (key: string) => key.trim().toLowerCase() === 'icon';

/** `alias` / `aliases` name other titles a note answers to in links. */
export const isAliasKey = (key: string) => ['alias', 'aliases'].includes(key.trim().toLowerCase());

/** A note's own emoji from its `icon` property, if it has one. */
export function noteIcon(properties: Property[] | undefined): string | null {
  const property = properties?.find((p) => isIconKey(p.key));
  if (!property) return null;
  const text = Array.isArray(property.value) ? property.value[0] ?? '' : property.type === 'raw' ? '' : String(property.value);
  return firstGrapheme(text.trim()) || null;
}

/** The first character as people see it (one emoji, flags and skin tones included). */
export function firstGrapheme(text: string): string {
  const segment = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]().next();
  return segment.done ? '' : segment.value.segment;
}

/** Aliases as typed: one name stays text, several (comma-separated) become a list. */
export function parseAliasInput(input: string): PropertyValue {
  const names = [...new Set(parseListInput(input))];
  return names.length > 1 ? { type: 'list', value: names } : { type: 'text', value: names[0] ?? '' };
}
