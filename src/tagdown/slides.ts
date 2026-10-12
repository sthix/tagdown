// Presentation mode splits a note into slides at `---` lines, the convention
// Marp, Obsidian and others use. Separators inside fenced code don't count,
// and neither does a frontmatter block at the very top.

export type Slide = {
  /** Tagdown source of the slide, separators removed. */
  text: string;
  /** First line of the slide in the note (0-based). */
  startLine: number;
};

const FENCE = /^\s*(`{3,}|~{3,})/;
const SEPARATOR = /^\s*---\s*$/;
const FRONTMATTER_KEY = /^[\w-]+\s*:/;

export function splitSlides(source: string): Slide[] {
  const lines = source.split('\n');
  let i = 0;
  // A leading `---` … `---` block of `key: value` lines is frontmatter.
  if (SEPARATOR.test(lines[0] ?? '')) {
    const close = lines.findIndex((line, n) => n > 0 && SEPARATOR.test(line));
    if (close > 0 && lines.slice(1, close).every((line) => !line.trim() || FRONTMATTER_KEY.test(line) || /^\s/.test(line))) i = close + 1;
  }

  const slides: Slide[] = [];
  let start = i;
  let fence: string | null = null;
  const push = (end: number) => {
    const text = lines.slice(start, end).join('\n');
    if (text.trim()) slides.push({ text: text.replace(/^\n+|\s+$/g, ''), startLine: start });
  };
  for (; i < lines.length; i++) {
    const open = lines[i].match(FENCE);
    if (open) {
      if (!fence) fence = open[1][0];
      else if (open[1][0] === fence) fence = null;
      continue;
    }
    if (!fence && SEPARATOR.test(lines[i])) {
      push(i);
      start = i + 1;
    }
  }
  push(lines.length);
  return slides;
}

/** Index of the slide that holds `line` (0-based), for presenting from the cursor. */
export function slideAtLine(slides: Slide[], line: number): number {
  let index = 0;
  slides.forEach((slide, n) => { if (slide.startLine <= line) index = n; });
  return index;
}
