// Publishing: notes become a static website, a folder of HTML files that
// works on any web host (or opened straight from disk).
//
//   index.html               every published note, with tag filters and search
//   notes/<title>.html       one page per note
//   assets/style.css         the preview's look, with math fonts embedded
//   assets/site.js           search and tag filtering
//   assets/search-index.js   the search data (a script, so it loads from disk too)
//
// Links between published notes become links between pages; links to notes
// that aren't published become plain text, so nothing private leaks a title.
// Embedded blocks show only when their note is published too.

import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { documentCss, renderDocument } from './export';
import { fillQueries, invalidateQueries } from './queries';
import { applyExternals } from './tagdown/renderer';
import { blockTarget, fillBlockEmbeds, invalidateBlockEmbeds } from './blockEmbeds';
import { blockIdOfTarget } from './blockRefs';
import { normalizeTitle, resolveTarget, splitTarget } from './wikilinks';
import siteCss from './styles/site.css?inline';
import './styles/publish.css';

type Note = { id: string; title: string; preview: string; tags: string[]; folderId: string | null; updatedAt: string; path?: string };
type SiteNote = { note: Note; content: string; folder: string | null };
type SiteFile = { path: string; content: string };
type Scope = { kind: 'all' } | { kind: 'folder'; id: string; name: string } | { kind: 'tag'; tag: string };

type Page = SiteNote & { slug: string; html: string; text: string; links: Set<string> };

const SEARCH_TEXT_LIMIT = 4000;

export async function buildSite(siteTitle: string, notes: SiteNote[], progress: (done: number, total: number) => void): Promise<SiteFile[]> {
  const slugs = new Set<string>();
  const slugFor = (title: string) => {
    const base = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'note';
    let slug = base;
    for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`;
    slugs.add(slug);
    return slug;
  };

  // Pass 1: render every note.
  invalidateQueries();
  invalidateBlockEmbeds();
  const pages: Page[] = [];
  for (const [i, entry] of notes.entries()) {
    progress(i, notes.length);
    const html = await renderDocument(entry.note.title || 'Untitled', entry.content, async (root) => {
      await fillQueries(root, { excludeId: entry.note.id, interactive: false });
      await fillBlockEmbeds(root, (body) => applyExternals(body, 'light'));
    });
    pages.push({ ...entry, slug: slugFor(entry.note.title || 'Untitled'), html, text: '', links: new Set() });
  }
  progress(notes.length, notes.length);

  // Pass 2: point links at pages, now that every page has a name.
  const published = pages.map((p) => ({ id: p.note.id, title: p.note.title, folderId: p.note.folderId, path: p.note.path, page: p }));
  const byId = new Map(pages.map((p) => [p.note.id, p]));
  let hasMath = false;
  for (const page of pages) {
    const root = document.createElement('div');
    root.innerHTML = page.html;
    hasMath ||= !!root.querySelector('.katex');
    const pageUrl = (target: Page, anchor: string | null) => {
      let hash = '';
      const blockId = anchor ? blockIdOfTarget(`#${anchor}`) : null;
      if (blockId) {
        hash = `#${blockAnchor(blockId)}`;
      } else if (anchor) {
        const wanted = normalizeTitle(anchor);
        const holder = document.createElement('div');
        holder.innerHTML = target.html;
        const heading = Array.from(holder.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).find((h) => h.id === anchor || normalizeTitle(h.textContent || '') === wanted);
        if (heading?.id) hash = `#${heading.id}`;
      }
      return target === page ? (hash || '#') : `${target.slug}.html${hash}`;
    };
    // An embed of an unpublished note's block would put its text on the site.
    root.querySelectorAll<HTMLElement>('.td-transclusion').forEach((embed) => {
      if (embed.dataset.noteId && byId.has(embed.dataset.noteId)) return;
      embed.classList.add('is-missing');
      embed.querySelector(':scope > .td-transclusion-body')?.replaceChildren();
    });
    // Blocks named with ^id get an anchor that [[Note#^id]] links land on.
    root.querySelectorAll<HTMLElement>('.td-block-id[data-block-id]').forEach((marker) => {
      const block = marker.closest('.td-transclusion') ? null : blockTarget(marker);
      if (block && !block.id) block.id = blockAnchor(marker.dataset.blockId!);
    });
    root.querySelectorAll<HTMLAnchorElement>('a.td-wikilink').forEach((link) => {
      const target = resolveTarget(link.dataset.target || '', published)?.page;
      if (target) {
        link.href = pageUrl(target, splitTarget(link.dataset.target || '').anchor);
        if (target !== page) page.links.add(target.note.id);
      } else {
        link.replaceWith(Object.assign(document.createElement('span'), { className: 'td-wikilink is-missing', textContent: link.textContent }));
      }
      link.removeAttribute('data-target');
    });
    root.querySelectorAll<HTMLElement>('[data-open-note]').forEach((el) => {
      const target = byId.get(el.dataset.openNote!);
      if (target && el instanceof HTMLAnchorElement) {
        el.href = pageUrl(target, null);
        el.removeAttribute('data-open-note');
      } else {
        // Query results from notes that aren't published are left out entirely:
        // their titles and tasks are not for this site.
        (el.closest('.td-query-group, .td-query-notes > li, .td-query-table tbody tr, .td-qb-card') ?? el).remove();
      }
    });
    root.querySelectorAll('.td-query-more').forEach((el) => el.remove()); // its counts include unpublished notes
    // A board's lane counts include them too.
    root.querySelectorAll<HTMLElement>('.td-qb-lane').forEach((lane) => {
      const count = lane.querySelector('.td-qb-count');
      if (count) count.textContent = String(lane.querySelectorAll('.td-qb-card').length);
    });
    root.querySelectorAll('.td-query-body').forEach((body) => {
      if (!body.querySelector('.td-query-group, li, .td-query-error, .td-qb-card, .td-qc-card, tbody tr')) body.innerHTML = '<p class="td-query-empty">Nothing published matches.</p>';
    });
    // A static page can't tick anything.
    root.querySelectorAll('input[type="checkbox"]').forEach((box) => box.setAttribute('disabled', ''));
    root.querySelectorAll<HTMLElement>('span.td-tag[data-tag]').forEach((pill) => {
      const link = Object.assign(document.createElement('a'), { className: 'td-tag', textContent: pill.textContent, href: `../index.html?tag=${encodeURIComponent(pill.dataset.tag!)}` });
      pill.replaceWith(link);
    });
    root.querySelectorAll('a[href^="http"]').forEach((a) => a.setAttribute('rel', 'noopener'));
    page.html = root.innerHTML;
    // Search text: keep words from neighbouring blocks apart, skip the query syntax line.
    root.querySelectorAll('.td-query-head, .katex-mathml').forEach((el) => el.remove());
    root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, pre, blockquote, div, summary').forEach((el) => el.append(' '));
    page.text = (root.textContent || '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_TEXT_LIMIT);
  }

  const backlinks = new Map<string, Page[]>();
  for (const page of pages) for (const id of page.links) backlinks.set(id, [...(backlinks.get(id) ?? []), page]);

  const stamp = new Date();
  const files: SiteFile[] = pages.map((page) => ({
    path: `notes/${page.slug}.html`,
    content: pageHtml(siteTitle, page, backlinks.get(page.note.id) ?? [], stamp),
  }));
  files.push({ path: 'index.html', content: indexHtml(siteTitle, pages, stamp) });
  files.push({ path: 'assets/style.css', content: `${await documentCss(hasMath)}\n${siteCss}` });
  files.push({ path: 'assets/site.js', content: SITE_JS });
  files.push({
    path: 'assets/search-index.js',
    content: `window.TAGDOWN_SEARCH = ${JSON.stringify(pages.map((p) => ({ t: p.note.title || 'Untitled', u: `notes/${p.slug}.html`, g: p.note.tags, x: p.text })))};\n`,
  });
  return files;
}

function shell(siteTitle: string, title: string, base: string, body: string, stamp: Date) {
  return `<!doctype html>
<html lang="en" data-theme="light" data-base="${base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Tagdown Editor">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${base}assets/style.css">
<script src="${base}assets/search-index.js" defer></script>
<script src="${base}assets/site.js" defer></script>
</head>
<body class="td-site">
<header class="site-header">
  <a class="site-title" href="${base}index.html">${escapeHtml(siteTitle)}</a>
  <div class="site-search-wrap">
    <input class="site-search" type="search" placeholder="Search" aria-label="Search notes" autocomplete="off">
    <div class="site-results" role="listbox" hidden></div>
  </div>
</header>
${body}
<footer class="site-footer">Published ${escapeHtml(stamp.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))} with Tagdown</footer>
</body>
</html>
`;
}

function pageHtml(siteTitle: string, page: Page, linkedFrom: Page[], stamp: Date) {
  const meta = [page.folder, `Updated ${new Date(page.note.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`].filter(Boolean).join(' · ');
  const backlinks = linkedFrom.length
    ? `<section class="site-backlinks"><h2>Linked from</h2><ul>${linkedFrom.map((p) => `<li><a href="${p.slug}.html">${escapeHtml(p.note.title || 'Untitled')}</a></li>`).join('')}</ul></section>`
    : '';
  return shell(siteTitle, `${page.note.title || 'Untitled'} · ${siteTitle}`, '../', `<main class="preview td-export">
<p class="site-meta">${escapeHtml(meta)}</p>
${page.html}
${backlinks}
</main>`, stamp);
}

function indexHtml(siteTitle: string, pages: Page[], stamp: Date) {
  const sorted = [...pages].sort((a, b) => b.note.updatedAt.localeCompare(a.note.updatedAt));
  const tagCounts = new Map<string, number>();
  pages.forEach((p) => p.note.tags.forEach((t) => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)));
  const tags = [...tagCounts].sort((a, b) => a[0].localeCompare(b[0]));
  const list = sorted.map((p) => `
    <li data-tags="${escapeHtml(p.note.tags.join(' '))}">
      <a class="site-note-title" href="notes/${p.slug}.html">${escapeHtml(p.note.title || 'Untitled')}</a>
      <span class="site-note-meta">${escapeHtml([p.folder, new Date(p.note.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })].filter(Boolean).join(' · '))}</span>
      ${p.note.preview ? `<p>${escapeHtml(p.note.preview)}</p>` : ''}
    </li>`).join('');
  return shell(siteTitle, siteTitle, './', `<main class="site-index">
<h1>${escapeHtml(siteTitle)}</h1>
<p class="site-meta">${pages.length} ${pages.length === 1 ? 'note' : 'notes'}</p>
${tags.length ? `<nav class="site-tags" aria-label="Tags">${tags.map(([t, n]) => `<a class="td-tag" href="?tag=${encodeURIComponent(t)}" data-tag="${escapeHtml(t)}">${escapeHtml(t)} <span>${n}</span></a>`).join('')}</nav>` : ''}
<p class="site-filter" hidden>Tagged <strong></strong> · <a href="index.html">show all</a></p>
<ul class="site-note-list">${list}</ul>
</main>`, stamp);
}

// Runs on the published site: search across notes, and tag filtering on the index.
const SITE_JS = `(function () {
  var data = window.TAGDOWN_SEARCH || [];
  var base = document.documentElement.getAttribute('data-base') || './';
  var input = document.querySelector('.site-search');
  var box = document.querySelector('.site-results');
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function search(q) {
    var words = q.toLowerCase().split(/\\s+/).filter(Boolean);
    if (!words.length) return [];
    return data.map(function (d) {
      var title = d.t.toLowerCase(), all = title + ' ' + d.g.join(' ') + ' ' + d.x.toLowerCase();
      if (!words.every(function (w) { return all.indexOf(w) >= 0; })) return null;
      var score = words.filter(function (w) { return title.indexOf(w) >= 0; }).length;
      var at = d.x.toLowerCase().indexOf(words[0]);
      var snippet = at < 0 ? d.x.slice(0, 120) : (at > 40 ? '…' : '') + d.x.slice(Math.max(0, at - 40), at + 100);
      return { d: d, score: score, snippet: snippet };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
  }
  if (input && box) {
    input.addEventListener('input', function () {
      var hits = search(input.value);
      box.hidden = !input.value.trim();
      box.innerHTML = hits.length ? hits.map(function (h) {
        return '<a class="site-result" href="' + base + h.d.u + '"><strong>' + esc(h.d.t) + '</strong><span>' + esc(h.snippet) + '</span></a>';
      }).join('') : '<p class="site-no-results">No notes match.</p>';
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; box.hidden = true; }
      if (e.key === 'Enter') { var first = box.querySelector('a'); if (first) location.href = first.href; }
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.site-search-wrap')) box.hidden = true; });
  }
  var tag = new URLSearchParams(location.search).get('tag');
  var list = document.querySelector('.site-note-list');
  if (tag && list) {
    list.querySelectorAll('li').forEach(function (li) {
      var tags = (li.getAttribute('data-tags') || '').split(' ');
      li.hidden = !tags.some(function (t) { return t === tag || t.indexOf(tag + '/') === 0; });
    });
    var filter = document.querySelector('.site-filter');
    filter.hidden = false;
    filter.querySelector('strong').textContent = tag;
    document.querySelectorAll('.site-tags a').forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('data-tag') === tag); });
  }
})();
`;

type DialogOptions = {
  folders: Array<{ id: string; name: string }>;
  tags: string[];
  defaultTitle: string;
  confirm: (title: string, message: string, detail: string, confirmLabel: string) => Promise<boolean>;
};

/** The "Publish as website" dialog: pick what to publish, where, and go. */
export function openPublishDialog(options: DialogOptions) {
  document.querySelector('.publish-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'publish-dialog';
  dialog.setAttribute('aria-label', 'Publish as website');
  const option = (value: string, label: string) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  dialog.innerHTML = `
    <form class="publish-shell" method="dialog">
      <h2>Publish as website</h2>
      <p class="publish-intro">Turns notes into a folder of web pages you can put on any web host, or open from disk. Links between published notes keep working; links to other notes become plain text.</p>
      <label>What to publish
        <select name="scope">
          ${option('all', 'All notes')}
          ${options.folders.length ? `<optgroup label="Folder">${options.folders.map((f) => option(`folder:${f.id}`, f.name)).join('')}</optgroup>` : ''}
          ${options.tags.length ? `<optgroup label="Tag">${options.tags.map((t) => option(`tag:${t}`, `#${t}`)).join('')}</optgroup>` : ''}
        </select>
      </label>
      <label>Site title <input name="title" type="text" value="${escapeHtml(options.defaultTitle)}" required></label>
      <p class="publish-status" aria-live="polite"></p>
      <div class="confirm-actions">
        <button type="button" class="confirm-button" data-cancel>Close</button>
        <button type="submit" class="confirm-button is-primary" data-publish>Choose folder and publish…</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const status = dialog.querySelector<HTMLElement>('.publish-status')!;
  const button = dialog.querySelector<HTMLButtonElement>('[data-publish]')!;
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.querySelector('[data-cancel]')!.addEventListener('click', close);
  dialog.addEventListener('close', () => dialog.remove());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const raw = String(data.get('scope'));
    const scope: Scope = raw.startsWith('folder:')
      ? { kind: 'folder', id: raw.slice(7), name: options.folders.find((f) => f.id === raw.slice(7))?.name ?? '' }
      : raw.startsWith('tag:') ? { kind: 'tag', tag: raw.slice(4) } : { kind: 'all' };
    const siteTitle = String(data.get('title')).trim() || options.defaultTitle;
    const dir = await openDialog({ directory: true, canCreateDirectories: true, title: 'Choose a folder for the website' });
    if (typeof dir !== 'string') return;
    const state = await invoke<{ exists: boolean; empty: boolean; tagdownSite: boolean }>('inspect_site_dir', { dir });
    if (state.exists && !state.empty && !state.tagdownSite) {
      const ok = await options.confirm('This folder isn’t empty', `Publish into “${dir.split('/').pop()}” anyway?`, 'Tagdown adds index.html, notes/ and assets/ next to the files already there, replacing any with the same names. Choose an empty folder to keep them apart.', 'Publish here');
      if (!ok) return;
    }
    button.disabled = true;
    try {
      const notes = await invoke<SiteNote[]>('site_notes', {
        folderId: scope.kind === 'folder' ? scope.id : null,
        tag: scope.kind === 'tag' ? scope.tag : null,
      });
      if (!notes.length) {
        status.textContent = 'There are no notes to publish there.';
        return;
      }
      const files = await buildSite(siteTitle, notes, (done, total) => { status.textContent = `Rendering ${done} of ${total} notes…`; });
      status.textContent = 'Writing files…';
      const removed = await invoke<number>('write_site', { dir, files });
      const index = `${dir}/index.html`;
      status.innerHTML = `Published ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}${removed ? `, removed ${removed} old ${removed === 1 ? 'page' : 'pages'}` : ''}. <button type="button" class="publish-link" data-open>Open in browser</button> · <button type="button" class="publish-link" data-reveal>Show in Finder</button>`;
      status.querySelector('[data-open]')!.addEventListener('click', () => void openPath(index).catch(() => undefined));
      status.querySelector('[data-reveal]')!.addEventListener('click', () => void revealItemInDir(index).catch(() => undefined));
    } catch (error) {
      status.textContent = `Publishing failed: ${String(error)}`;
    } finally {
      button.disabled = false;
    }
  });
  dialog.showModal();
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function blockAnchor(id: string) {
  return `block-${id.toLowerCase()}`;
}
