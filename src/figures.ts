// Figures in the preview: a small bar on each `<figure … />` to set its size
// and caption, which rewrites the tag in the note. The tag keeps its other
// attributes, in their order; only the one changed is touched.

export const FIGURE_SIZES = ['small', 'medium', 'large', 'full'] as const;
export type FigureSize = (typeof FIGURE_SIZES)[number];

/** One attribute of a tag as written: `key="value"`, a bare `key`, or a quoted positional `"value"`. */
type Token = { key: string | null; value: string | null; raw: string };

const FIGURE_TAG = /<figure\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(\s*\/)?>/gi;
// Tokens the way the parser reads them (parser.js parseAttrs).
const TOKEN = /"([^"]*)"|'([^']*)'|([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'">]+)))?/g;

function tokens(attrs: string): Token[] {
  return Array.from(attrs.matchAll(TOKEN), (m) => {
    if (m[1] !== undefined || m[2] !== undefined) return { key: null, value: m[1] ?? m[2], raw: m[0] };
    return { key: m[3].toLowerCase(), value: m[4] ?? m[5] ?? m[6] ?? null, raw: m[0] };
  });
}

/** The `<figure>` tags in `source`, in order. */
function figureTags(source: string) {
  return Array.from(source.matchAll(FIGURE_TAG), (m) => ({ start: m.index!, end: m.index! + m[0].length, tokens: tokens(m[1]), closed: !!m[2] }));
}

/** A value written so the parser reads it back: bare when it can be, else quoted. */
function quote(value: string) {
  if (/^[\w.%/-]+$/.test(value)) return value;
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  // Both kinds: double quotes become typographic ones, as the preview shows them anyway.
  return `"${value.replace(/"([^"]*)"/g, '“$1”').replaceAll('"', '”')}"`;
}

/** The caption and size of the `index`-th figure in `source`, as the parser reads them. */
export function figureInfo(source: string, index: number): { caption: string; size: FigureSize | null } | null {
  const tag = figureTags(source)[index];
  if (!tag) return null;
  const caption = tag.tokens.find((t) => t.key === 'caption')?.value ?? tag.tokens.find((t) => t.key === null)?.value ?? '';
  const size = tag.tokens.find((t) => t.key === 'size')?.value?.toLowerCase() ?? '';
  return { caption, size: (FIGURE_SIZES as readonly string[]).includes(size) ? (size as FigureSize) : null };
}

/**
 * `source` with the `index`-th figure's caption or size set (or removed,
 * with an empty value); null when there's no such figure. A size replaces a
 * width, since the two would fight.
 */
export function setFigure(source: string, index: number, key: 'caption' | 'size', value: string): string | null {
  const tag = figureTags(source)[index];
  if (!tag) return null;
  const drop = key === 'caption'
    ? (t: Token) => t.key === 'caption' || t === tag.tokens.find((p) => p.key === null)
    : (t: Token) => t.key === 'size' || t.key === 'width';
  const kept = tag.tokens.filter((t) => !drop(t)).map((t) => t.raw);
  const text = value.replace(/\s+/g, ' ').trim();
  if (text) kept.push(`${key}=${quote(text)}`);
  const rewritten = `<figure${kept.length ? ` ${kept.join(' ')}` : ''}${tag.closed ? ' /' : ''}>`;
  return source.slice(0, tag.start) + rewritten + source.slice(tag.end);
}

type FigureOptions = {
  /** Sets the caption or size of figure `figure` in preview block `block`. */
  edit: (block: number, figure: number, key: 'caption' | 'size', value: string) => void;
  /** The block's source, to read the figure's current caption from. */
  sourceOf: (block: number) => string | null;
};

const SIZE_LABELS: Record<FigureSize, [string, string]> = {
  small: ['S', 'Small: a third of the text width'],
  medium: ['M', 'Medium: half the text width'],
  large: ['L', 'Large: three quarters of the text width'],
  full: ['Full', 'Full text width'],
};

/** Give each figure written as a `<figure>` tag in an editable preview its size and caption bar. */
export function decorateFigures(root: HTMLElement, options: FigureOptions) {
  root.querySelectorAll<HTMLElement>('.td-block[data-block]').forEach((blockEl) => {
    const block = Number(blockEl.dataset.block);
    const source = options.sourceOf(block);
    if (!source) return;
    // Figures in embeds and queries belong to other notes.
    const figures = Array.from(blockEl.querySelectorAll<HTMLElement>('figure.td-figure')).filter((f) => !f.closest('.td-embed, .td-query, .td-transclusion'));
    figures.forEach((figureEl, index) => {
      const info = figureInfo(source, index);
      if (!info || figureEl.querySelector('.td-figure-tools')) return;
      const tools = document.createElement('div');
      tools.className = 'td-figure-tools';
      tools.setAttribute('role', 'toolbar');
      tools.setAttribute('aria-label', 'Image size and caption');
      tools.innerHTML = FIGURE_SIZES.map((size) => `<button type="button" data-figure-size="${size}" title="${SIZE_LABELS[size][1]}" aria-pressed="${info.size === size}">${SIZE_LABELS[size][0]}</button>`).join('')
        + `<button type="button" data-figure-caption>${info.caption ? 'Edit caption' : 'Add caption'}</button>`;
      tools.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!button) return;
        event.stopPropagation();
        if (button.dataset.figureSize) {
          const size = button.dataset.figureSize;
          options.edit(block, index, 'size', info.size === size ? '' : size);
        } else {
          editCaption(figureEl, info.caption, (caption) => options.edit(block, index, 'caption', caption));
        }
      });
      figureEl.prepend(tools);
      figureEl.querySelector('figcaption')?.addEventListener('click', (event) => {
        event.stopPropagation();
        editCaption(figureEl, info.caption, (caption) => options.edit(block, index, 'caption', caption));
      });
    });
  });
}

/** A field in place of the figure's caption; ↩ or leaving it saves, Esc puts it back. */
function editCaption(figureEl: HTMLElement, current: string, save: (caption: string) => void) {
  if (figureEl.querySelector('.td-figure-caption-input')) return;
  const input = document.createElement('input');
  input.className = 'td-figure-caption-input';
  input.value = current;
  input.placeholder = 'Caption';
  input.setAttribute('aria-label', 'Caption');
  const old = figureEl.querySelector('figcaption');
  if (old) old.replaceWith(input);
  else figureEl.append(input);
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    if (keep && input.value.trim() !== current.trim()) save(input.value);
    else if (old) input.replaceWith(old);
    else input.remove();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (event) => event.stopPropagation());
  input.focus();
  input.select();
}
