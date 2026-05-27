/* ============================================================
   TAGDOWN: parser + renderer  (v0.2 — easier tag syntax)
   ============================================================ */

/* ---------- 0. Preprocessors (high-level shortcuts) ---------- */

/* ::: warn  Optional title
   body lines
   :::                                  becomes  <note type=warn title="...">body</note> */
function preprocessCallouts(input) {
  const lines = input.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    // :::warn or ::: warn — both work
    const opener = lines[i].match(/^:::\s*(\w+)\s*(.*)$/);
    if (opener && opener[1]) {
      const type = opener[1];
      const title = opener[2].trim();
      let j = i + 1;
      const body = [];
      while (j < lines.length && !/^:::\s*$/.test(lines[j])) {
        body.push(lines[j]); j++;
      }
      if (j < lines.length) {
        const tt = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
        out.push(`<note type=${type}${tt}>`);
        out.push(...body);
        out.push('</note>');
        i = j + 1;
        continue;
      }
    }
    out.push(lines[i]); i++;
  }
  return out.join('\n');
}

/* | Name | Age |
   | Alice | 30 |     becomes  <table head="Name | Age">Alice | 30</table>
   An optional GFM separator row (| --- | --- |) is recognized and skipped. */
function preprocessPipeTables(input) {
  const lines = input.split('\n');
  const out = [];
  // A pipe table row must start/end with | AND have at least one non-pipe char
  const rowRe = /^\s*\|[^\n]*\|\s*$/;
  const onlyPipes = /^[\s|]*$/;
  let i = 0;
  while (i < lines.length) {
    if (rowRe.test(lines[i]) && !onlyPipes.test(lines[i])) {
      const rows = [];
      while (i < lines.length && rowRe.test(lines[i]) && !onlyPipes.test(lines[i])) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
        i++;
      }
      if (rows.length >= 2) {
        let bodyStart = 1;
        if (rows[1] && rows[1].every(c => /^:?-+:?$/.test(c))) bodyStart = 2;
        const head = rows[0].join(' | ').replace(/"/g, '&quot;');
        out.push(`<table head="${head}">`);
        for (let k = bodyStart; k < rows.length; k++) out.push('  ' + rows[k].join(' | '));
        out.push('</table>');
      } else {
        out.push('| ' + rows[0].join(' | ') + ' |');
      }
    } else {
      out.push(lines[i]); i++;
    }
  }
  return out.join('\n');
}

/* <grid 2>
   left
   |||
   right
   </grid>                              becomes a grid with two <col> wrappers. */
function preprocessGridDivider(input) {
  return input.replace(/(<grid\b[^>]*>)([\s\S]*?)(<\/grid>)/g, (_, open, body, close) => {
    if (/<col[\s>]/.test(body)) return open + body + close;
    const parts = body.split(/^[ \t]*\|\|\|[ \t]*$/m).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return open + body + close;
    return open + '\n' + parts.map(p => `<col>\n${p}\n</col>`).join('\n') + '\n' + close;
  });
}

/* Inside `inline code spans`, swap < and > for sentinel chars so the tokenizer
   doesn't read them as tags. We swap back to &lt; / &gt; at the very end. */
function preprocessBacktickAngles(input) {
  return input.replace(/`([^`\n]*)`/g, (_, inner) =>
    '`' + inner.replace(/</g, '\u0001').replace(/>/g, '\u0002') + '`'
  );
}

function restoreSentinels(html) {
  return html.replace(/\u0001/g, '&lt;').replace(/\u0002/g, '&gt;');
}

/* term :: description
   term2 :: description2          becomes  <defs>...</defs>
   Continuation lines (indented under a term) get appended to that term's description.
   Requires ≥2 consecutive entries to trigger auto-detect. */
function preprocessDefs(input) {
  const lines = input.split('\n');
  const out = [];
  const termRe = /^(\S[^\n]*?)\s::\s(.+?)\s*$/;
  const contRe = /^\s+\S/;
  let i = 0;
  while (i < lines.length) {
    if (termRe.test(lines[i])) {
      const entries = [];
      const startI = i;
      while (i < lines.length) {
        const m = lines[i].match(termRe);
        if (!m) break;
        const entry = { term: m[1], desc: m[2] };
        i++;
        while (i < lines.length && contRe.test(lines[i]) && !termRe.test(lines[i])) {
          entry.desc += ' ' + lines[i].trim();
          i++;
        }
        entries.push(entry);
      }
      if (entries.length >= 2) {
        out.push('<defs>');
        for (const e of entries) out.push(`${e.term} :: ${e.desc}`);
        out.push('</defs>');
      } else {
        for (let k = startI; k < i; k++) out.push(lines[k]);
      }
    } else {
      out.push(lines[i]); i++;
    }
  }
  return out.join('\n');
}

function preprocess(input) {
  // Backtick sentinels can run unconditionally — they don't disturb code blocks.
  input = preprocessBacktickAngles(input);
  // Skip <code>...</code>, <defs>...</defs>, and ```...``` regions so their contents
  // aren't re-parsed by the other block preprocessors.
  const protectRe = /(<code\b[^>]*>[\s\S]*?<\/code>|<defs\b[^>]*>[\s\S]*?<\/defs>|```[\w]*\n[\s\S]*?\n```)/;
  const parts = input.split(protectRe);
  return parts.map(p => {
    if (p.startsWith('<code') || p.startsWith('<defs') || p.startsWith('```')) return p;
    p = preprocessGridDivider(p);
    p = preprocessCallouts(p);
    p = preprocessDefs(p);
    p = preprocessPipeTables(p);
    return p;
  }).join('');
}

/* ---------- 1. Tokenizer ---------- */

const VOID_TAGS = new Set(['hr', 'br', 'figure', 'embed']);

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const tagRe = /^<\s*(\/?)\s*([a-zA-Z][\w-]*)((?:\s+(?:"[^"]*"|'[^']*'|[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">]+))?))*)\s*(\/?)\s*>/;
  const closeAnyRe = /^<\s*\/\s*>/;

  while (i < input.length) {
    const ch = input[i];

    if (ch === '<') {
      const slice = input.slice(i);
      if (slice.startsWith('<!--')) {
        const end = slice.indexOf('-->');
        if (end !== -1) { i += end + 3; continue; }
      }
      // Universal close: </>
      const closeAny = slice.match(closeAnyRe);
      if (closeAny) {
        tokens.push({ type: 'close', name: '*' });
        i += closeAny[0].length;
        continue;
      }
      const m = slice.match(tagRe);
      if (m) {
        const isClose = m[1] === '/';
        const isSelfClose = m[4] === '/';
        const name = m[2].toLowerCase();
        const attrs = parseAttrs(m[3]);

        if (!isClose && !isSelfClose && name === 'code') {
          const closeRe = /<\s*\/\s*(?:code\s*|\s*)>/i;
          const after = input.slice(i + m[0].length);
          const closeMatch = after.match(closeRe);
          if (closeMatch) {
            const rawLen = closeMatch.index;
            tokens.push({ type: 'open', name, attrs });
            tokens.push({ type: 'text', value: after.slice(0, rawLen) });
            tokens.push({ type: 'close', name });
            i += m[0].length + rawLen + closeMatch[0].length;
            continue;
          }
        }

        if (isSelfClose || (VOID_TAGS.has(name) && !isClose && !hasContent(input, i + m[0].length, name))) {
          tokens.push({ type: 'void', name, attrs });
        } else if (isClose) {
          tokens.push({ type: 'close', name });
        } else {
          tokens.push({ type: 'open', name, attrs });
        }
        i += m[0].length;
        continue;
      }
    }

    let j = i;
    while (j < input.length && input[j] !== '<') j++;
    if (j > i) tokens.push({ type: 'text', value: input.slice(i, j) });
    if (j === i) { i++; } else { i = j; }
  }
  return tokens;
}

function hasContent(input, start, name) {
  const closeRe = new RegExp(`<\\s*\\/\\s*${name}\\s*>`, 'i');
  return closeRe.test(input.slice(start));
}

function parseAttrs(s) {
  const attrs = { _pos: [] };
  if (!s) return attrs;
  // Two kinds of tokens: a quoted positional value, or a name(=value)? pair.
  const re = /(?:"([^"]*)"|'([^']*)'|([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'">]+)))?)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined || m[2] !== undefined) {
      attrs._pos.push(m[1] !== undefined ? m[1] : m[2]);
      continue;
    }
    const name = m[3].toLowerCase();
    if (m[4] !== undefined || m[5] !== undefined || m[6] !== undefined) {
      attrs[name] = m[4] ?? m[5] ?? m[6];
    } else {
      attrs[name] = true;
    }
  }
  return attrs;
}

/* shorthand(attrs, mainAttr, knownAttrs) — pick the value of mainAttr, falling back to
   the first bare-word attribute that isn't in the known list. Lets writers do
   <note warn> instead of <note type=warn>. */
function shorthand(attrs, mainAttr, known = []) {
  if (attrs[mainAttr] != null && attrs[mainAttr] !== false) return attrs[mainAttr];
  const skip = new Set(['_pos', 'id', 'class', 'style', mainAttr, ...known]);
  for (const k of Object.keys(attrs)) {
    if (attrs[k] === true && !skip.has(k)) return k;
  }
  return undefined;
}

/* ---------- 2. Parser (build tree) ---------- */

function parse(tokens) {
  const root = { type: 'element', name: 'doc-root', attrs: { _pos: [] }, children: [] };
  const stack = [root];

  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.type === 'text') {
      top.children.push({ type: 'text', value: t.value });
    } else if (t.type === 'open') {
      const node = { type: 'element', name: t.name, attrs: t.attrs, children: [] };
      top.children.push(node);
      stack.push(node);
    } else if (t.type === 'close') {
      if (t.name === '*') {
        // Universal close: pop the topmost open element
        if (stack.length > 1) stack.pop();
      } else {
        for (let k = stack.length - 1; k > 0; k--) {
          if (stack[k].name === t.name) {
            stack.length = k;
            break;
          }
        }
      }
    } else if (t.type === 'void') {
      top.children.push({ type: 'element', name: t.name, attrs: t.attrs, children: [], void: true });
    }
  }
  return root;
}

/* ---------- 3. Renderer ---------- */

const INLINE_TAGS = new Set(['em', 'strong', 'b', 'i', 'a', 'code-inline', 'mark', 'kbd', 's', 'small', 'br']);

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline markdown transformations applied to plain text segments
function inline(text) {
  let s = esc(text);
  // Code spans first so we don't process inside them
  const codeSpans = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codeSpans.push(c);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, t, u, title) => {
    const tAttr = title ? ` title="${esc(title)}"` : '';
    return `<a href="${esc(u)}"${tAttr}>${t}</a>`;
  });
  // Auto-link bare URLs
  s = s.replace(/(?<![">])(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}">${m}</a>`);
  // Bold ** ** before single *
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic * *
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  // Strike ~~
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  // Mark ==
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  // Restore code spans
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, n) => `<code>${codeSpans[+n]}</code>`);
  return s;
}

function attrsStr(attrs, allow = ['id', 'class', 'style']) {
  const parts = [];
  for (const k of allow) {
    if (attrs[k] != null && attrs[k] !== false) {
      parts.push(`${k}="${esc(attrs[k])}"`);
    }
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

/* Render a tree node to HTML. blockCtx means: text content should be paragraph-wrapped */

function render(node, blockCtx = true) {
  if (node.type === 'text') {
    // Text nodes inside block contexts are handled by renderChildren's paragraph builder.
    // Direct calls land here only from inline contexts.
    return inline(node.value);
  }
  const h = HANDLERS[node.name];
  if (h) return h(node, node.attrs);
  return passThrough(node, blockCtx);
}

function renderChildren(node, blockCtx = true) {
  if (!blockCtx) {
    return node.children.map(c => render(c, false)).join('');
  }
  // Block context: walk children. Segments track text (unescaped) and html (already-rendered) separately
  // so we can paragraph-wrap text while preserving inline elements.
  let out = '';
  let segs = [];

  const flushPara = () => {
    if (segs.length === 0) return;
    let html = segs.map(s => s.kind === 'text' ? inline(s.value) : s.value).join('');
    html = html.replace(/^\s+|\s+$/g, '');
    if (html) out += `<p>${html}</p>`;
    segs = [];
  };

  for (const c of node.children) {
    if (c.type === 'text') {
      // Split text on blank lines; each break = paragraph boundary
      const parts = c.value.split(/\n[ \t]*\n/);
      parts.forEach((part, i) => {
        if (i > 0) flushPara();
        // Try to detect a markdown block, but only at fresh paragraph boundaries
        const freshStart = (segs.length === 0);
        if (freshStart) {
          const blockHtml = tryBlockText(part);
          if (blockHtml !== null) {
            out += blockHtml;
            return;
          }
        }
        if (part) segs.push({ kind: 'text', value: part });
      });
    } else if (INLINE_TAGS.has(c.name)) {
      segs.push({ kind: 'html', value: render(c, false) });
    } else {
      flushPara();
      out += render(c, true);
    }
  }
  flushPara();
  return out;
}

function tryBlockText(text) {
  const t = text.replace(/^\s+|\s+$/g, '');
  if (!t) return null;

  // Heading with optional {#anchor}: # Title {#install}
  const h = t.match(/^(#{1,6})\s+(.*?)(?:\s*\{#([\w-]+)\})?\s*$/);
  if (h && !t.includes('\n')) {
    const lvl = h[1].length;
    const idAttr = h[3] ? ` id="${esc(h[3])}"` : '';
    return `<h${lvl}${idAttr}>${inline(h[2])}</h${lvl}>`;
  }
  // Horizontal rule
  if (/^-{3,}$/.test(t)) return '<hr>';
  // Fenced code: ```lang ... ```
  const f = t.match(/^```(\w+)?\n([\s\S]*?)\n?```$/);
  if (f) return renderCodeBlock(f[2], { lang: f[1] || '' });

  // Lists: every line is a list item of the same kind
  const lines = t.split('\n');
  if (lines.length >= 1 && lines.every(l => /^\s*[-*]\s+/.test(l))) {
    return '<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('') + '</ul>';
  }
  if (lines.length >= 1 && lines.every(l => /^\s*\d+\.\s+/.test(l))) {
    return '<ol>' + lines.map(l => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('') + '</ol>';
  }
  return null;
}

function passThrough(node, blockCtx) {
  // Allow raw HTML-ish tags we don't have handlers for to render with their attrs
  const safe = ['span', 'div', 'b', 'i', 'u', 'sup', 'sub', 'abbr', 'cite'];
  if (safe.includes(node.name)) {
    const allowed = attrsStr(node.attrs, ['id', 'class', 'style', 'title']);
    return `<${node.name}${allowed}>${renderChildren(node, false)}</${node.name}>`;
  }
  // Otherwise render content as if tags weren't there
  return renderChildren(node, blockCtx);
}

/* ---------- Tag handlers ---------- */

const NOTE_DEFAULTS = {
  info:  { label: 'Note',    cls: 'td-note-info'  },
  warn:  { label: 'Warning', cls: 'td-note-warn'  },
  warning:{ label: 'Warning',cls: 'td-note-warn'  },
  error: { label: 'Error',   cls: 'td-note-error' },
  ok:    { label: 'Success', cls: 'td-note-ok'    },
  success:{label: 'Success', cls: 'td-note-ok'    },
  tip:   { label: 'Tip',     cls: 'td-note-tip'   },
};

function getRawText(node) {
  let out = '';
  for (const c of node.children) {
    if (c.type === 'text') out += c.value;
    else out += getRawText(c);
  }
  return out;
}

const HANDLERS = {
  'doc-root': (n) => renderChildren(n, true),
  doc:       (n) => renderChildren(n, true),

  h1: (n) => `<h1${attrsStr(n.attrs)}>${renderChildren(n, false)}</h1>`,
  h2: (n) => `<h2${attrsStr(n.attrs)}>${renderChildren(n, false)}</h2>`,
  h3: (n) => `<h3${attrsStr(n.attrs)}>${renderChildren(n, false)}</h3>`,
  h4: (n) => `<h4${attrsStr(n.attrs)}>${renderChildren(n, false)}</h4>`,
  h5: (n) => `<h5${attrsStr(n.attrs)}>${renderChildren(n, false)}</h5>`,
  h6: (n) => `<h6${attrsStr(n.attrs)}>${renderChildren(n, false)}</h6>`,
  p:  (n) => `<p${attrsStr(n.attrs)}>${renderChildren(n, false)}</p>`,
  em: (n) => `<em>${renderChildren(n, false)}</em>`,
  strong: (n) => `<strong>${renderChildren(n, false)}</strong>`,
  b: (n) => `<strong>${renderChildren(n, false)}</strong>`,
  i: (n) => `<em>${renderChildren(n, false)}</em>`,
  s: (n) => `<s>${renderChildren(n, false)}</s>`,
  mark: (n) => `<mark>${renderChildren(n, false)}</mark>`,
  kbd: (n) => `<kbd>${renderChildren(n, false)}</kbd>`,
  br: () => `<br>`,
  hr: () => `<hr>`,
  a: (n, a) => {
    const href = a.to || a.href || '#';
    const title = a.title ? ` title="${esc(a.title)}"` : '';
    return `<a href="${esc(href)}"${title}>${renderChildren(n, false)}</a>`;
  },

  note: (n, a) => {
    // <note warn>, <note tip "Pro tip">, <note type=warn title="Pro tip">
    const NOTE_KEYS = ['info','warn','warning','error','ok','success','tip'];
    let type = (a.type || '').toLowerCase();
    if (!type) {
      for (const k of NOTE_KEYS) if (a[k] === true) { type = k; break; }
    }
    type = type || 'info';
    const cfg = NOTE_DEFAULTS[type] || NOTE_DEFAULTS.info;
    const label = a.title || (a._pos && a._pos[0]) || cfg.label;
    return `<aside class="td-note ${cfg.cls}"${attrsStr(a, ['id'])}>
      <div class="td-note-icon">${esc(label)}</div>
      <div class="td-note-body">${renderChildren(n, true)}</div>
    </aside>`;
  },

  table: (n, a) => {
    const head = a.head ? a.head.split('|').map(s => s.trim()) : null;
    const raw = getRawText(n);
    const rows = raw.split('\n').map(l => l.trim()).filter(Boolean);
    let html = `<table class="td-table"${attrsStr(a, ['id'])}>`;
    if (head) html += '<thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead>';
    html += '<tbody>';
    for (const row of rows) {
      const cells = row.split('|').map(s => s.trim());
      html += '<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
    }
    html += '</tbody></table>';
    return html;
  },

  code: (n, a) => {
    // <code python>, <code python file=hi.py lines hl=2-3>
    const lang = a.lang || shorthand(a, 'lang', ['file','lines','line','highlight','hl','title']) || '';
    const opts = { ...a, lang };
    const raw = getRawText(n).replace(/^\n+|\n+$/g, '');
    return renderCodeBlock(raw, opts);
  },

  grid: (n, a) => {
    // <grid 3> or <grid cols=3>
    let cols = a.cols;
    if (!cols) {
      for (const k of Object.keys(a)) {
        if (a[k] === true && /^\d+$/.test(k)) { cols = parseInt(k); break; }
      }
    }
    cols = cols || 2;
    return `<div class="td-grid" style="grid-template-columns: repeat(${esc(cols)}, 1fr)">${renderChildren(n, true)}</div>`;
  },
  col: (n) => `<div class="td-col">${renderChildren(n, true)}</div>`,

  details: (n, a) => {
    // <details "Click to expand"> or <details summary="Click to expand">
    const summary = a.summary || (a._pos && a._pos[0]) || 'Details';
    const open = a.open ? ' open' : '';
    return `<details class="td-details"${open}><summary>${esc(summary)}</summary>${renderChildren(n, true)}</details>`;
  },

  figure: (n, a) => {
    // <figure img.png "Caption text" /> or <figure src=img.png caption="..." />
    const src = a.src || shorthand(a, 'src', ['alt','width','height','caption']);
    const alt = a.alt || '';
    const w = a.width ? ` width="${esc(a.width)}"` : '';
    const cap = a.caption || (a._pos && a._pos[0]) || getRawText(n).trim();
    const img = src ? `<img src="${esc(src)}" alt="${esc(alt)}"${w}>` : '';
    const caption = cap ? `<figcaption>${inline(cap)}</figcaption>` : '';
    return `<figure class="td-figure">${img}${caption}</figure>`;
  },

  quote: (n, a) => {
    // <quote "Knuth"> or <quote by=Knuth>
    const cite = a.by || a.cite || a.from || (a._pos && a._pos[0]);
    const citeHtml = cite ? `<span class="td-quote-cite">${esc(cite)}</span>` : '';
    return `<blockquote class="td-quote">${renderChildren(n, true)}${citeHtml}</blockquote>`;
  },

  list: (n, a) => {
    const tag = (a.type === 'ol' || a.ordered) ? 'ol' : 'ul';
    return `<${tag}>${n.children.filter(c => c.type === 'element' && c.name === 'item').map(c => HANDLERS.item(c)).join('')}</${tag}>`;
  },
  item: (n) => `<li>${renderChildren(n, true).replace(/^<p>|<\/p>$/g, '')}</li>`,

  /* <defs> with raw "term :: desc" lines — the auto-detected inline form maps here. */
  defs: (n, a) => {
    const raw = getRawText(n);
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    let html = `<dl class="td-dl"${attrsStr(a, ['id'])}>`;
    for (const line of lines) {
      const m = line.match(/^(.+?)\s::\s(.+)$/);
      if (m) {
        html += `<dt class="td-dt">${inline(m[1])}</dt><dd class="td-dd">${inline(m[2])}</dd>`;
      }
    }
    html += '</dl>';
    return html;
  },

  /* Raw HTML semantics: <dl>/<dt>/<dd> work directly for richer content. */
  dl: (n, a) => `<dl class="td-dl"${attrsStr(a, ['id'])}>${renderChildren(n, true)}</dl>`,
  dt: (n) => `<dt class="td-dt">${renderChildren(n, false)}</dt>`,
  dd: (n) => {
    const inner = renderChildren(n, true).replace(/^<p>(.*)<\/p>$/s, '$1');
    return `<dd class="td-dd">${inner}</dd>`;
  },

  embed: (n, a) => {
    const url = a.url || a.src;
    if (!url) return '';
    // Simple YouTube detection
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    if (yt) {
      return `<figure class="td-figure"><iframe width="100%" height="360" src="https://www.youtube.com/embed/${yt[1]}" frameborder="0" allowfullscreen style="border-radius:6px"></iframe></figure>`;
    }
    return `<a href="${esc(url)}">${esc(url)}</a>`;
  },
};

function renderCodeBlock(raw, opts) {
  const lang = (opts.lang || '').toString();
  const file = (opts.file || '').toString();
  const showLines = opts.lines === true || opts.lines === 'on' || opts.lines === '';
  const hlSet = parseHighlight(opts.hl || opts.highlight);
  const linesArr = raw.split('\n');
  const body = linesArr.map((ln, i) => {
    const n = i + 1;
    const isHl = hlSet.has(n);
    const numCell = showLines ? `<span class="td-code-num">${n}</span>` : '';
    return `<div class="td-code-line${isHl ? ' hl' : ''}">${numCell}<span class="td-code-text">${esc(ln) || ' '}</span></div>`;
  }).join('');
  const headerBits = [];
  if (file) headerBits.push(`<span class="td-code-file">${esc(file)}</span>`);
  if (lang) headerBits.push(`<span class="td-code-lang">${esc(lang)}</span>`);
  const header = headerBits.length ? `<div class="td-code-header">${headerBits.join('')}</div>` : '';
  return `<div class="td-code">${header}<div class="td-code-body">${body}</div></div>`;
}

function parseHighlight(spec) {
  const set = new Set();
  if (!spec || spec === true) return set;
  for (const part of String(spec).split(',')) {
    const [a, b] = part.split('-').map(s => parseInt(s.trim(), 10));
    if (!isNaN(a) && !isNaN(b)) {
      for (let i = a; i <= b; i++) set.add(i);
    } else if (!isNaN(a)) {
      set.add(a);
    }
  }
  return set;
}

/* ============================================================
   FULL PIPELINE
   ============================================================ */
export function tagdown(input) {
  const pre = preprocess(input);
  const tokens = tokenize(pre);
  const tree = parse(tokens);
  return restoreSentinels(render(tree, true));
}
