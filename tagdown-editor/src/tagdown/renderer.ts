import { tagdown } from './parser.js';

const TAG_RE = /(^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;
const SKIP_ANCESTORS = new Set(['CODE', 'PRE', 'A']);

function hasSkippedAncestor(node: Node): boolean {
  let el = node.parentElement;
  while (el) {
    if (SKIP_ANCESTORS.has(el.tagName)) return true;
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
