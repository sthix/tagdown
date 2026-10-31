/** Plain, noninteractive summaries for browsing, without Markdown scaffolding. */
export function noteExcerpt(value: string) {
  return value
    .replace(/%%.*?%%/g, ' ')
    .replace(/<\/[a-zA-Z]*\s*>|(?<![\w<])<[a-zA-Z][^<>]*>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[|\]\]/g, '')
    .replace(/(?:^|\s)(?:>\s*)?\[![\w-]+\][+-]?/g, ' ')
    .replace(/(?:^|\s)>+\s+/g, ' ')
    .replace(/^>+\s*/, '')
    .replace(/(?:^|\s)(?:>\s*)?[-*+]\s+\[[ xX]\]\s*/g, ' ')
    .replace(/^[-*+]\s+/, '')
    .replace(/(?:^|\s)#{1,6}\s+/g, ' ')
    .replace(/(?:^|\s)(?:---+|___+)(?=\s|$)/g, ' ')
    .replace(/(?:^|\s):::(?:[ \t]*(?:info|warn|warning|error|ok|success|tip|note|caution|important|danger|q)\b)?/g, ' ')
    .replace(/(?:^|\s)(?:`{3,}|~{3,})[\w+#-]*/g, ' ')
    .replace(/(?:\*\*|__|~~|==|`)/g, '')
    .replace(/(^|[\s(])\*(?=\S)/g, '$1')
    .replace(/(?<=\S)\*(?=$|[\s).,;:!?])/g, '')
    .replace(/(?:^|\s)\^[A-Za-z0-9-]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const MARK_OPEN = '';
const MARK_CLOSE = '';

/** `noteExcerpt` for text with matched ranges, which follow the words they marked. */
export function noteExcerptRanges(value: string, ranges: Array<[number, number]>) {
  let marked = '';
  let at = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    marked += `${value.slice(at, start)}${MARK_OPEN}${value.slice(start, end)}${MARK_CLOSE}`;
    at = end;
  }
  const cleaned = noteExcerpt(marked + value.slice(at));
  let text = '';
  let open = 0;
  const found: Array<[number, number]> = [];
  for (const char of cleaned) {
    if (char === MARK_OPEN) open = text.length;
    else if (char === MARK_CLOSE) { if (text.length > open) found.push([open, text.length]); }
    else text += char;
  }
  return { text, ranges: found };
}
