// Note properties as the vault sends them (see properties.rs): custom
// frontmatter entries with a type read from their value. These helpers convert
// and format values for the properties panel and query results.

export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'raw';

export type PropertyValue =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'checkbox'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'list'; value: string[] }
  | { type: 'raw'; value: string };

export type Property = { key: string } & PropertyValue;

/** Types a property can be switched to (raw YAML is only kept, never made). */
export const EDITABLE_TYPES: Array<{ type: Exclude<PropertyType, 'raw'>; label: string; icon: string }> = [
  { type: 'text', label: 'Text', icon: 'Aa' },
  { type: 'number', label: 'Number', icon: '#' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑' },
  { type: 'date', label: 'Date', icon: '◷' },
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
    case 'text': return { type, value: '' };
    case 'number': return { type, value: 0 };
    case 'checkbox': return { type, value: false };
    case 'date': return { type, value: day };
    case 'list': return { type, value: [] };
  }
}

/** One line of text for a value: lists joined with commas. */
export function valueText(value: PropertyValue): string {
  switch (value.type) {
    case 'list': return value.value.join(', ');
    case 'number': return String(value.value);
    case 'checkbox': return value.value ? 'true' : 'false';
    default: return value.value;
  }
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
  for (const ch of input) {
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
  return items.map((item) => item.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

/** Text typed into the field for `type`, as a value; null when it can't be one. */
export function parseInput(type: Exclude<PropertyType, 'raw'>, input: string): PropertyValue | null {
  const text = input.trim();
  switch (type) {
    case 'text': return { type, value: text };
    case 'number': {
      if (!text) return null;
      const n = Number(text.replace(',', '.'));
      return Number.isFinite(n) ? { type, value: n } : null;
    }
    case 'checkbox': return { type, value: /^(true|yes|1|x)$/i.test(text) };
    case 'date': return ISO_DAY.test(text) ? { type, value: text } : null;
    case 'list': return { type, value: parseListInput(text) };
  }
}

/** `value` as `type`, keeping what can be kept (text "3" becomes the number 3). */
export function convertValue(value: PropertyValue, type: Exclude<PropertyType, 'raw'>): PropertyValue {
  if (value.type === type) return value;
  if (type === 'list') {
    if (value.type === 'text' || value.type === 'raw') return { type, value: value.value.trim() ? [value.value.trim()] : [] };
    return { type, value: [valueText(value)] };
  }
  const text = value.type === 'list' ? value.value[0] ?? '' : valueText(value);
  return parseInput(type, text) ?? defaultValue(type);
}

/** Why `key` can't name a new property of this note, or null when it can. */
export function keyProblem(key: string, existing: string[], renaming?: string): string | null {
  const name = key.trim();
  if (!name) return 'A property needs a name.';
  if (MANAGED_KEYS.includes(name.toLowerCase())) return `“${name}” is managed by Tagdown.`;
  if (/^[#\-'"[{ ]/.test(name) || name.includes(':')) return `“${name}” can’t be a property name.`;
  if (name !== renaming && existing.includes(name)) return `This note already has “${name}”.`;
  return null;
}
