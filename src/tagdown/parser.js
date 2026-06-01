/* ============================================================
   TAGDOWN: parser + renderer  (v0.4 — easier syntax + power features)
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
    '`' + inner.replace(/</g, '').replace(/>/g, '') + '`'
  );
}

function restoreSentinels(html) {
  return html.replace(//g, '&lt;').replace(//g, '&gt;');
}

/* Module-scope state for cross-cutting features (footnotes, TOC, tabs). Reset at the
   start of every preprocess() call. Declared early so preprocess() can reference it. */
let _state = { frontmatter: null, footnotes: [], headings: [], tabsCounter: 0 };

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

/* YAML-ish frontmatter at the very top of the document, between --- lines.
   For now we just strip it from the rendered output; callers can parse it
   themselves by reading the source. */
function preprocessFrontmatter(input) {
  if (!input.startsWith('---\n')) return input;
  const end = input.indexOf('\n---\n', 4);
  if (end === -1) return input;
  // Stash the raw frontmatter on the module-scope state so external callers
  // (e.g. an editor) can access it via tagdown.lastFrontmatter()
  _state.frontmatter = input.slice(4, end);
  return input.slice(end + 5);
}

/* Footnotes: extract definitions of the form `[^id]: text` (with optional
   indented continuation lines), collect them, and emit a <footnotes> block
   at the bottom. Inline references like text[^id] are handled in inline(). */
function preprocessFootnotes(input) {
  const lines = input.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[\^([\w-]+)\]:\s+(.+)$/);
    if (m) {
      let text = m[2];
      let j = i + 1;
      // Absorb continuation lines (2+ space indent)
      while (j < lines.length && /^\s{2,}\S/.test(lines[j])) {
        text += ' ' + lines[j].trim();
        j++;
      }
      // Append to state (cumulative across chunks)
      _state.footnotes.push({ id: m[1], text });
      i = j - 1;
    } else {
      out.push(lines[i]);
    }
  }
  return out.join('\n');
}

function preprocess(input) {
  // Reset per-document state
  _state = { frontmatter: null, footnotes: [], headings: [], tabsCounter: 0 };

  // Frontmatter must be first — runs on raw input
  input = preprocessFrontmatter(input);

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
    p = preprocessFootnotes(p);
    return p;
  }).join('');
}

/* slugify(text) — produce a URL-safe id from a heading title, for auto-IDs and TOC links. */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')      // strip tags
    .replace(/[^\w\s-]/g, '')     // remove punctuation
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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

const INLINE_TAGS = new Set(['em', 'strong', 'b', 'i', 'a', 'code-inline', 'mark', 'kbd', 's', 'small', 'br', 'sub', 'sup', 'abbr', 'keys', 'cite']);

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

  // 1. Code spans first — anything inside is opaque text
  const codeSpans = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codeSpans.push(c);
    return ` CODE${codeSpans.length - 1} `;
  });

  // 2. Math placeholders (block $$...$$ then inline $...$) — preserved literally
  //    so KaTeX (or any other math renderer) can find them later if loaded.
  const mathSpans = [];
  s = s.replace(/\$\$([^$\n]+?)\$\$/g, (_, c) => {
    mathSpans.push({ block: true, tex: c });
    return ` MATH${mathSpans.length - 1} `;
  });
  s = s.replace(/(?<![\\\d])\$([^$\n]+?)\$(?!\d)/g, (_, c) => {
    mathSpans.push({ block: false, tex: c });
    return ` MATH${mathSpans.length - 1} `;
  });

  // 3. Wikilinks [[Note]] or [[Note|alias]] — internal references for notes apps
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
    const t = target.trim();
    const label = (alias || target).trim();
    return `<a class="td-wikilink" href="#${encodeURIComponent(t)}" data-target="${esc(t)}">${label}</a>`;
  });

  // 4. Footnote references [^id]
  s = s.replace(/\[\^([\w-]+)\]/g, (_, id) =>
    `<sup class="td-fn-ref" id="td-fnref-${id}"><a href="#td-fn-${id}">${id}</a></sup>`
  );

  // 5. Links [text](url "optional title")
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, t, u, title) => {
    const tAttr = title ? ` title="${esc(title)}"` : '';
    return `<a href="${esc(u)}"${tAttr}>${t}</a>`;
  });

  // 6. Auto-link bare URLs
  s = s.replace(/(?<![">])(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}">${m}</a>`);

  // 7. Email autolinks <user@host>
  s = s.replace(/&lt;([^\s&]+@[^\s&]+\.[^\s&]+)&gt;/g, (_, e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`);

  // 8. Bold ** ** before single *
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // 9. Italic * *
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

  // 10. Strikethrough ~~text~~ (must run before single-tilde subscript)
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

  // 11. Mark ==text==
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

  // 12. Subscript ~text~ (no whitespace inside; must follow strike)
  s = s.replace(/(?<!~)~([^~\s\n]+)~(?!~)/g, '<sub>$1</sub>');

  // 13. Superscript ^text^
  s = s.replace(/\^([^\^\s\n]+)\^/g, '<sup>$1</sup>');

  // 14. Smart typography — quotes, dashes, ellipsis (skip inside placeholder marks)
  s = applySmartTypography(s);

  // 15. Restore math (rendered as either raw $...$ for KaTeX auto-render or as styled span)
  s = s.replace(/ MATH(\d+) /g, (_, n) => {
    const m = mathSpans[+n];
    if (m.block) return `<span class="td-math td-math-block">$$${m.tex}$$</span>`;
    return `<span class="td-math">$${m.tex}$</span>`;
  });

  // 16. Restore code spans
  s = s.replace(/ CODE(\d+) /g, (_, n) => `<code>${codeSpans[+n]}</code>`);

  return s;
}

/* Smart typography: curly quotes, en/em dashes, ellipsis. Tags are protected
   so attribute quotes aren't mangled. Operates on already-escaped HTML, so it
   recognises &quot; for double quotes. */
function applySmartTypography(s) {
  // First, protect HTML tags so their attribute quotes don't get curled
  const tags = [];
  s = s.replace(/<[^>]+>/g, m => {
    tags.push(m);
    return ` TAG${tags.length - 1} `;
  });

  s = s
    .replace(/\.\.\./g, '…')                                // … ellipsis
    .replace(/(\w)---(\w)/g, '$1—$2')                       // word—word
    .replace(/(\w) --- (\w)/g, '$1 — $2')                    // word — word
    .replace(/(\w)--(\w)/g, '$1–$2')                        // word–word
    .replace(/(\d) ?-- ?(\d)/g, '$1–$2')                    // 1990–2020
    // Double quotes: esc() turned " into &quot;, so look for that entity
    .replace(/(^|[\s—–(\[{])&quot;/g, '$1“')        // opening "
    .replace(/&quot;/g, '”')                                 // closing "
    // Single quotes / apostrophes (not escaped by esc())
    .replace(/(^|[\s—–(\[{])'/g, '$1‘')             // opening '
    .replace(/'/g, '’');                                     // closing ' / apostrophe

  // Restore tags
  return s.replace(/ TAG(\d+) /g, (_, n) => tags[+n]);
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

/* Split a text run into alternating prose runs and standalone horizontal rules.
   A line whose only content is 3+ dashes is treated as a rule, so `---` on its
   own line acts as a divider without requiring blank lines around it. */
function splitHorizontalRules(value) {
  const runs = [];
  const buf = [];
  const flush = () => {
    if (buf.length) { runs.push({ text: buf.join('\n') }); buf.length = 0; }
  };
  for (const line of value.split('\n')) {
    if (/^[ \t]*-{3,}[ \t]*$/.test(line)) {
      flush();
      runs.push({ rule: true });
    } else {
      buf.push(line);
    }
  }
  flush();
  return runs;
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
      // A line that is only `---` (3+ dashes) is a horizontal rule. It needs
      // just its own line — no blank lines around it — so peel those out first.
      for (const run of splitHorizontalRules(c.value)) {
        if (run.rule) {
          flushPara();
          out += '<hr>';
          continue;
        }
        // Within a run, split text on blank lines; each break = paragraph boundary
        const parts = run.text.split(/\n[ \t]*\n/);
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
      }
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
  // If no explicit anchor, generate one from a slug — also collected for TOC.
  const h = t.match(/^(#{1,6})\s+(.*?)(?:\s*\{#([\w-]+)\})?\s*$/);
  if (h && !t.includes('\n')) {
    const lvl = h[1].length;
    const title = h[2];
    const id = h[3] || slugify(title);
    _state.headings.push({ level: lvl, text: title, id });
    return `<h${lvl} id="${esc(id)}">${inline(title)}</h${lvl}>`;
  }
  // Horizontal rule
  if (/^-{3,}$/.test(t)) return '<hr>';

  // Math block: $$...$$ on its own
  const mb = t.match(/^\$\$([\s\S]+?)\$\$$/);
  if (mb) return `<div class="td-math td-math-block">$$${esc(mb[1])}$$</div>`;

  // Fenced code: ```lang ... ```. Mermaid gets a special wrapper so the
  // mermaid.js library (if loaded) auto-renders it on display.
  const f = t.match(/^```(\w+)?\n([\s\S]*?)\n?```$/);
  if (f) {
    const lang = f[1] || '';
    if (lang.toLowerCase() === 'mermaid') {
      return `<pre class="mermaid">${esc(f[2])}</pre>`;
    }
    return renderCodeBlock(f[2], { lang });
  }

  // Task list / unordered list — every line is `- text`, `* text`, `- [ ] text`, or `- [x] text`
  const lines = t.split('\n');
  if (lines.length >= 1 && lines.every(l => /^\s*[-*]\s+/.test(l))) {
    const hasAnyTask = lines.some(l => /^\s*[-*]\s+\[[ xX]\]/.test(l));
    const items = lines.map(l => {
      const taskM = l.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (taskM) {
        const checked = taskM[1] !== ' ' ? ' checked' : '';
        return `<li class="td-task"><input type="checkbox"${checked}><span>${inline(taskM[2])}</span></li>`;
      }
      return `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`;
    }).join('');
    return `<ul${hasAnyTask ? ' class="td-tasklist"' : ''}>${items}</ul>`;
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
    // We render a click-to-play "facade" (thumbnail + play button) rather than a
    // live <iframe>. In a packaged Tauri app the WebView serves the document from
    // a non-HTTPS scheme (tauri://localhost on macOS); YouTube/Vimeo reject the
    // resulting Referer and refuse to configure the player ("Error 153"), no
    // matter what referrerpolicy we set. The facade links to the real video page
    // and main.ts intercepts the click to open it in the system browser via the
    // opener plugin (so the WebView itself never navigates away).
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (yt) {
      const id = yt[1];
      const watch = `https://www.youtube.com/watch?v=${esc(id)}`;
      const thumb = `https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg`;
      return `<a class="td-embed td-embed-youtube" href="${watch}" data-embed-url="${watch}" target="_blank" rel="noopener" aria-label="Play video on YouTube" style="background-image:url('${thumb}')"><span class="td-embed-play" aria-hidden="true"></span><span class="td-embed-label">Watch on YouTube</span></a>`;
    }
    // Vimeo — vimeo.com/ID, vimeo.com/video/ID, or player.vimeo.com/video/ID.
    // Vimeo has no static thumbnail-by-id URL, so the card shows a plain play button.
    const vm = url.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d+)/);
    if (vm) {
      const watch = `https://vimeo.com/${esc(vm[1])}`;
      return `<a class="td-embed td-embed-vimeo" href="${watch}" data-embed-url="${watch}" target="_blank" rel="noopener" aria-label="Play video on Vimeo"><span class="td-embed-play" aria-hidden="true"></span><span class="td-embed-label">Watch on Vimeo</span></a>`;
    }
    return `<a class="td-embed-link" href="${esc(url)}" data-embed-url="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
  },

  /* <toc /> — table of contents, generated from all headings collected during render. */
  toc: (n, a) => {
    // We emit a placeholder; tagdown() substitutes after the full render pass
    // so headings that appear after this point are still included.
    return `<!--TD_TOC_PLACEHOLDER:${a.depth || 6}-->`;
  },

  /* <tabs> ... <tab "label"> ... </tab> ... </tabs> — tabbed content groups.
     The tabs are wired via plain CSS using a unique radio-button group per tabs block. */
  tabs: (n, a) => {
    const groupId = 'td-tabs-' + (++_state.tabsCounter);
    const tabs = n.children.filter(c => c.type === 'element' && c.name === 'tab');
    if (tabs.length === 0) return '';
    let labels = '';
    let panels = '';
    tabs.forEach((tab, i) => {
      const label = tab.attrs.label || (tab.attrs._pos && tab.attrs._pos[0]) || `Tab ${i + 1}`;
      const tabId = `${groupId}-t${i}`;
      const checked = i === 0 ? ' checked' : '';
      labels += `<input type="radio" name="${groupId}" id="${tabId}" class="td-tab-radio"${checked}>`;
      labels += `<label for="${tabId}" class="td-tab-label">${esc(label)}</label>`;
      panels += `<div class="td-tab-panel">${renderChildren(tab, true)}</div>`;
    });
    return `<div class="td-tabs" data-group="${groupId}">${labels}<div class="td-tab-panels">${panels}</div></div>`;
  },
  tab: (n) => renderChildren(n, true), // unused directly; handled by `tabs` parent

  /* <footnotes> — the bibliography block generated by preprocessFootnotes. */
  footnotes: (n) => {
    if (_state.footnotes.length === 0) return '';
    const items = _state.footnotes.map(d =>
      `<li id="td-fn-${d.id}"><span class="td-fn-num">${esc(d.id)}.</span> ${inline(d.text)} <a href="#td-fnref-${d.id}" class="td-fn-back">↩</a></li>`
    ).join('');
    return `<aside class="td-footnotes"><h2 class="td-fn-heading">Footnotes</h2><ol class="td-fn-list">${items}</ol></aside>`;
  },

  /* <aside> — pull quote / sidenote, floats to the right on wider screens. */
  aside: (n, a) => {
    const side = a.side || (a._pos && a._pos[0]) || 'right';
    return `<aside class="td-aside td-aside-${side}">${renderChildren(n, true)}</aside>`;
  },

  /* <keys>Cmd+K</keys> — auto-wraps each separated key in <kbd>. Try "+" and "-" as separators. */
  keys: (n) => {
    const text = getRawText(n).trim();
    const parts = text.split(/(\+|\s+)/).map(p => {
      if (p === '+' || /^\s+$/.test(p)) return p === '+' ? '<span class="td-keys-sep">+</span>' : ' ';
      return `<kbd>${esc(p)}</kbd>`;
    });
    return `<span class="td-keys">${parts.join('')}</span>`;
  },

  /* <center> — centered block content (useful for figure-like headers). */
  center: (n) => `<div class="td-center">${renderChildren(n, true)}</div>`,
};

/* Callout aliases — map GitHub-style alert names to existing note types. */
const NOTE_ALIASES = {
  note: 'info', warning: 'warn', caution: 'warn',
  important: 'tip', danger: 'error',
};
// Apply aliases on top of NOTE_DEFAULTS so the note handler recognises them.
for (const [alias, target] of Object.entries(NOTE_ALIASES)) {
  if (NOTE_DEFAULTS[target] && !NOTE_DEFAULTS[alias]) {
    NOTE_DEFAULTS[alias] = { ...NOTE_DEFAULTS[target], label: alias[0].toUpperCase() + alias.slice(1) };
  }
}

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
  let rendered = restoreSentinels(render(tree, true));
  rendered = substituteToc(rendered);
  rendered = appendFootnotes(rendered);
  return rendered;
}

/* Expose collected state (frontmatter, footnotes, headings) for advanced callers. */
tagdown.state = () => ({ ..._state });

function substituteToc(html) {
  return html.replace(/<!--TD_TOC_PLACEHOLDER:(\d+)-->/g, (_, maxDepth) => {
    const depth = parseInt(maxDepth, 10);
    const filtered = _state.headings.filter(h => h.level <= depth);
    if (filtered.length === 0) return '';
    const items = filtered.map(h =>
      `<li class="td-toc-l${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`
    ).join('');
    return `<nav class="td-toc"><div class="td-toc-title">Contents</div><ol class="td-toc-list">${items}</ol></nav>`;
  });
}

function appendFootnotes(html) {
  if (_state.footnotes.length === 0) return html;
  // If the user wrote an explicit <footnotes /> placeholder, that's already rendered
  // via the handler; otherwise append at end. We detect prior rendering by class.
  if (html.includes('td-footnotes')) return html;
  const items = _state.footnotes.map(d =>
    `<li id="td-fn-${esc(d.id)}"><span class="td-fn-num">${esc(d.id)}.</span> ${inline(d.text)} <a href="#td-fnref-${esc(d.id)}" class="td-fn-back" title="Back to reference">↩</a></li>`
  ).join('');
  return html + `<aside class="td-footnotes"><h2 class="td-fn-heading">Footnotes</h2><ol class="td-fn-list">${items}</ol></aside>`;
}
