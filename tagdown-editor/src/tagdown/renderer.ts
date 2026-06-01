import { tagdown } from './parser.js';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';

const TAG_RE = /(^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;
const SKIP_TAGS = new Set(['CODE', 'PRE', 'A']);
const SKIP_SELECTORS = '.td-code, .td-math, .td-math-block, .td-wikilink, .td-fn-ref, pre.mermaid';

function hasSkippedAncestor(node: Node): boolean {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.matches?.(SKIP_SELECTORS)) return true;
    el = el.parentElement;
  }
  return false;
}

function normalizeTag(raw: string): string {
  return raw.split('/').filter(Boolean).join('/').toLowerCase();
}

export function renderPreview(source: string): string {
  const host = document.createElement('div');
  host.innerHTML = tagdown(source);

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    if (!hasSkippedAncestor(text) && /(^|\s)#[A-Za-z0-9_]/.test(text.data)) {
      targets.push(text);
    }
    current = walker.nextNode();
  }

  for (const text of targets) {
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    const data = text.data;
    TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_RE.exec(data)) !== null) {
      const [whole, lead, body] = match;
      const start = match.index + lead.length;
      if (start > lastIndex) frag.append(data.slice(lastIndex, start));
      const tag = normalizeTag(body);
      const span = document.createElement('span');
      span.className = 'td-tag';
      span.dataset.tag = tag;
      span.textContent = tag;
      frag.append(span);
      lastIndex = match.index + whole.length;
    }
    if (lastIndex < data.length) frag.append(data.slice(lastIndex));
    text.replaceWith(frag);
  }

  return host.innerHTML;
}

let mermaidConfiguredTheme: 'light' | 'dark' | null = null;
let mermaidIdCounter = 0;

/**
 * After `innerHTML = renderPreview(source)` is set on a live DOM root, call this
 * to upgrade `.td-math` spans into KaTeX-rendered formulas and `pre.mermaid`
 * blocks into Mermaid diagrams. Both libraries are bundled.
 */
export async function applyExternals(root: HTMLElement, theme: 'light' | 'dark'): Promise<void> {
  // ---- KaTeX ----
  root.querySelectorAll<HTMLElement>('.td-math').forEach((el) => {
    // Avoid re-rendering an element KaTeX already touched.
    if (el.querySelector('.katex')) return;
    const raw = (el.textContent || '').trim();
    const isBlock = el.classList.contains('td-math-block');
    const tex = isBlock
      ? raw.replace(/^\$\$/, '').replace(/\$\$$/, '').trim()
      : raw.replace(/^\$/, '').replace(/\$$/, '').trim();
    if (!tex) return;
    try {
      el.innerHTML = katex.renderToString(tex, {
        displayMode: isBlock,
        throwOnError: false,
        output: 'html',
      });
    } catch {
      /* leave the raw $..$ visible on failure */
    }
  });

  // ---- Mermaid ----
  const mermaidNodes = Array.from(root.querySelectorAll<HTMLElement>('pre.mermaid'));
  if (mermaidNodes.length === 0) return;

  if (mermaidConfiguredTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict',
    });
    mermaidConfiguredTheme = theme;
  }

  for (const node of mermaidNodes) {
    // Reset state from any previous render so the same DOM node can be reused.
    node.removeAttribute('data-processed');
    const source = (node.textContent || '').trim();
    if (!source) continue;
    const id = `td-mermaid-${++mermaidIdCounter}`;
    try {
      const { svg, bindFunctions } = await mermaid.render(id, source);
      node.innerHTML = svg;
      bindFunctions?.(node);
    } catch (err) {
      // On parse error mermaid throws; leave the source visible.
      node.textContent = (err as Error)?.message || source;
    }
  }
}
