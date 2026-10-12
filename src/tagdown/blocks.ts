// Block mapping for in-preview editing.
//
// The Tagdown parser doesn't track source positions, so we split the source into
// top-level blocks ourselves, render the whole document once with an invisible
// marker paragraph between blocks, and then group the rendered nodes between
// markers. Each group is wrapped in `.td-block[data-block]` so a click in the
// preview can be traced back to the source lines that produced it. Rendering the
// document in one pass keeps document-wide features (footnotes, TOC, tabs) intact.

export type SourceBlock = { start: number; end: number }; // line range [start, end)

const FENCE = /^\s*(`{3,}|~{3,})/;
const CALLOUT_OPEN = /^:::\s*\w/;
const CALLOUT_CLOSE = /^:::\s*$/;
const MATH_OPEN = /^\s*\$\$/;
const HEADING = /^#{1,6}\s/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const CONTINUATION = /^\s{2,}\S/;
const TAG_OPEN = /^\s*<([a-zA-Z][\w-]*)\b[^>]*>/;
// Tags that are inline or void: a line starting with one is ordinary text.
const INLINE_TAGS = new Set(['a', 'b', 'i', 'u', 's', 'em', 'strong', 'code', 'kbd', 'keys', 'mark', 'span', 'sup', 'sub', 'small', 'br', 'hr', 'img', 'wbr', 'input']);

const isBlank = (line: string) => line.trim() === '';

function containerTag(line: string): string | null {
  const m = line.match(TAG_OPEN);
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (INLINE_TAGS.has(name)) return null;
  if (/\/>\s*$/.test(m[0])) return null;
  if (new RegExp(`</${name}\\s*>`, 'i').test(line.slice(m[0].length))) return null;
  return name;
}

function startsContainer(line: string) {
  return FENCE.test(line) || CALLOUT_OPEN.test(line) || MATH_OPEN.test(line) || containerTag(line) !== null;
}

/** Index just past the end of the container that opens on `lines[i]`, or -1. */
function containerEnd(lines: string[], i: number): number {
  const line = lines[i];
  const fence = line.match(FENCE);
  if (fence) {
    const char = fence[1][0];
    const close = new RegExp(`^\\s*\\${char}{${fence[1].length},}\\s*$`);
    for (let j = i + 1; j < lines.length; j++) if (close.test(lines[j])) return j + 1;
    return lines.length;
  }
  if (CALLOUT_OPEN.test(line)) {
    for (let j = i + 1; j < lines.length; j++) if (CALLOUT_CLOSE.test(lines[j])) return j + 1;
    return -1;
  }
  if (MATH_OPEN.test(line)) {
    const rest = line.trim().slice(2);
    if (rest.endsWith('$$')) return i + 1;
    for (let j = i + 1; j < lines.length; j++) if (lines[j].trim().endsWith('$$')) return j + 1;
    return -1;
  }
  const name = containerTag(line);
  if (name) {
    const open = new RegExp(`<${name}\\b[^>]*?(/)?>`, 'gi');
    const close = new RegExp(`</${name}\\s*>`, 'gi');
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      for (const m of lines[j].matchAll(open)) if (!m[1]) depth++;
      depth -= (lines[j].match(close) ?? []).length;
      if (depth <= 0) return j + 1;
    }
    return lines.length;
  }
  return -1;
}

export function splitBlocks(source: string): SourceBlock[] {
  const lines = source.split('\n');
  const blocks: SourceBlock[] = [];
  let i = 0;

  // Frontmatter only counts at the very top.
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---');
    if (close > 0) {
      blocks.push({ start: 0, end: close + 1 });
      i = close + 1;
    }
  }

  while (i < lines.length) {
    if (isBlank(lines[i])) { i++; continue; }
    const start = i;

    if (startsContainer(lines[i])) {
      const end = containerEnd(lines, i);
      if (end > i) { blocks.push({ start, end }); i = end; continue; }
    }

    if (HEADING.test(lines[i])) { blocks.push({ start, end: i + 1 }); i++; continue; }

    // A run of text lines; stops at a blank line, a heading or a container.
    const isList = LIST_ITEM.test(lines[i]);
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        // Lists keep going across blank lines when the next item continues them.
        if (!isList) break;
        let k = i;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k < lines.length && (LIST_ITEM.test(lines[k]) || CONTINUATION.test(lines[k]))) { i = k; continue; }
        break;
      }
      if (HEADING.test(line) || startsContainer(line)) break;
      i++;
    }
    blocks.push({ start, end: i });
  }
  return blocks;
}

const MARK = (index: number) => `TDBLOCKMARK${index}X`;
const MARK_RE = /^TDBLOCKMARK(\d+)X$/;

/** Source with a marker paragraph before every block except the first. */
export function markSource(source: string, blocks: SourceBlock[]): string {
  const lines = source.split('\n');
  return blocks
    .map((block, index) => (index > 0 ? `${MARK(index)}\n\n` : '') + lines.slice(block.start, block.end).join('\n'))
    .join('\n\n');
}

/**
 * Group rendered top-level nodes by the marker that precedes them and wrap each
 * group in `.td-block`. Returns null when the markers didn't all land at the top
 * level (e.g. an unclosed container swallowed them), so the caller can fall back
 * to a plain, non-editable render.
 */
export function wrapBlocks(html: string, blockCount: number): string | null {
  const host = document.createElement('div');
  host.innerHTML = html;
  const groups: Node[][] = Array.from({ length: blockCount }, () => []);
  const trailing: Node[] = [];
  let current = 0;
  let markers = 0;
  for (const node of Array.from(host.childNodes)) {
    if (node instanceof HTMLElement) {
      const mark = node.tagName === 'P' ? (node.textContent ?? '').trim().match(MARK_RE) : null;
      if (mark) { current = Number(mark[1]); markers++; continue; }
      if (node.matches('.td-footnotes')) { trailing.push(node); continue; }
    }
    groups[current]?.push(node);
  }
  if (markers !== Math.max(0, blockCount - 1)) return null;
  const out = document.createElement('div');
  groups.forEach((nodes, index) => {
    if (!nodes.some((n) => n.nodeType === Node.ELEMENT_NODE)) return;
    const wrap = document.createElement('div');
    wrap.className = 'td-block';
    wrap.dataset.block = String(index);
    wrap.append(...nodes);
    out.append(wrap);
  });
  out.append(...trailing);
  return out.innerHTML;
}
