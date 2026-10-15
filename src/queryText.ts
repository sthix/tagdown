// Editing a query's text, for table views that sort and change columns in
// place: the `<query … />` in the note is rewritten, so the view stays plain
// text. Tokens split like the vault splits them (query.rs): on spaces outside
// "quotes" and [[links]].

export function queryTokens(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  let brackets = 0;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
    if (/\s/.test(ch) && !quoted && brackets === 0) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

const optionOf = (token: string, key: string) => token.toLowerCase().startsWith(`${key.toLowerCase()}:`);

/** The value of `key:` in a query, without quotes; null when it isn't set. */
export function getOption(raw: string, key: string): string | null {
  const token = queryTokens(raw).find((t) => optionOf(t, key));
  return token === undefined ? null : token.slice(key.length + 1).replace(/^"(.*)"$/, '$1');
}

/** The query with `key:` set to `value` (in place of the old one), or removed for null. */
export function setOption(raw: string, key: string, value: string | null): string {
  const tokens = queryTokens(raw);
  const at = tokens.findIndex((t) => optionOf(t, key));
  const rest = tokens.filter((t) => !optionOf(t, key));
  if (value === null) return rest.join(' ');
  const token = `${key}:${/[\s"]/.test(value) ? `"${value.replaceAll('"', '')}"` : value}`;
  rest.splice(at < 0 ? rest.length : at, 0, token);
  return rest.join(' ');
}

/**
 * The next `sort:` after clicking a column's header: ascending, then
 * descending, then back to the default order. The title only sorts one way.
 */
export function nextSort(current: string | null, column: string): string | null {
  const key = column.toLowerCase();
  const now = current?.toLowerCase() ?? null;
  if (key === 'title') return now === 'title' ? null : 'title';
  if (now === key) return `-${column}`;
  if (now === `-${key}`) return null;
  return column;
}

/** The query showing `columns` in a table. */
export function withColumns(raw: string, columns: string[]): string {
  return setOption(raw, 'columns', columns.join(','));
}
