// Note export: a self-contained HTML file and a print/PDF view.
//
// Both render the note with the same parser as the preview, always in the light
// theme so a document looks the same on paper, on screen, and in someone else's
// browser. The HTML file carries its own CSS (and KaTeX fonts when the note has
// math) so it opens anywhere without the app.

import { renderPreview, applyExternals } from './tagdown/renderer';
import tokensCss from './styles/tokens.css?inline';
import previewCss from './styles/preview.css?inline';
import katexCss from 'katex/dist/katex.min.css?inline';

const EXPORT_CSS = `
html, body { height: auto; overflow: visible; }
body { margin: 0; background: var(--bg-preview); }
.preview.td-export {
  height: auto;
  overflow: visible;
  max-width: 760px;
  margin: 0 auto;
  padding: 56px 32px 96px;
}
.preview.td-export > :first-child { margin-top: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@page { margin: 18mm 16mm; }
@media print {
  body { background: #fff; }
  .preview.td-export { max-width: none; padding: 0; background: #fff; }
  .preview.td-export h1, .preview.td-export h2, .preview.td-export h3, .preview.td-export h4 { break-after: avoid; }
  .preview.td-export pre, .preview.td-export table, .preview.td-export figure, .preview.td-export img,
  .preview.td-export svg, .preview.td-export blockquote, .preview.td-export .td-math-block { break-inside: avoid; }
}
`;

/** The light-theme custom properties, so print can ignore the app's dark theme. */
function lightTokens(): string {
  return tokensCss.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

/** Fills live parts of a rendered note (query blocks) before it is captured. */
export type Decorate = (root: HTMLElement) => Promise<void>;

/** Render a note to export-ready HTML: externals applied, title heading guaranteed. */
export async function renderDocument(title: string, source: string, decorate?: Decorate): Promise<string> {
  const root = document.createElement('div');
  root.innerHTML = renderPreview(source);
  await applyExternals(root, 'light');
  if (decorate) await decorate(root);
  const first = root.firstElementChild;
  if (title && first?.tagName !== 'H1') root.insertAdjacentHTML('afterbegin', `<h1>${escapeHtml(title)}</h1>`);
  return root.innerHTML;
}

async function toDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:font/woff2;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/** KaTeX CSS with each @font-face reduced to an embedded woff2 source. */
async function embeddedKatexCss(): Promise<string> {
  const faces = [...katexCss.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
  const embedded = await Promise.all(faces.map(async (face) => {
    const woff2 = face.match(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/)?.[1];
    const data = woff2 ? await toDataUri(new URL(woff2, document.baseURI).href) : null;
    const swapped = face.replace(/font-display\s*:\s*block/, 'font-display:swap');
    return data ? swapped.replace(/src\s*:[^;}]+/, `src:url(${data}) format("woff2")`) : swapped;
  }));
  return faces.reduce((css, face, i) => css.replace(face, embedded[i]), katexCss);
}

/** The stylesheet for exported documents; math fonts are embedded when needed. */
export async function documentCss(withMath: boolean): Promise<string> {
  return [tokensCss, previewCss, withMath ? await embeddedKatexCss() : '', EXPORT_CSS].join('\n');
}

/** A standalone HTML document for the note. */
export async function buildStandaloneHtml(title: string, source: string, decorate?: Decorate): Promise<string> {
  const body = await renderDocument(title, source, decorate);
  const css = await documentCss(body.includes('class="katex'));
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Tagdown Editor">
<title>${escapeHtml(title || 'Untitled')}</title>
<style>
${css}
</style>
</head>
<body>
<main class="preview td-export">
${body}
</main>
</body>
</html>
`;
}

/** A filesystem-friendly file name for the note. */
export function exportFileName(title: string, extension: string) {
  const base = (title || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
  return `${base}.${extension}`;
}

let printStyleInjected = false;

/**
 * Open the system print dialog (which offers Save as PDF) for the note. The
 * app's chrome is hidden by a print-only stylesheet and a light-theme render
 * of the note is shown instead, whatever theme the app is in.
 */
export async function printNote(title: string, source: string, decorate?: Decorate) {
  if (!printStyleInjected) {
    const style = document.createElement('style');
    style.id = 'td-print-style';
    style.textContent = `
#print-root { display: none; }
@media print {
  :root, :root[data-theme="dark"] { color-scheme: light; ${lightTokens()} }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > :not(#print-root) { display: none !important; }
  #print-root { display: block; }
  ${EXPORT_CSS}
}`;
    document.head.append(style);
    printStyleInjected = true;
  }
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.append(root);
  }
  root.innerHTML = `<main class="preview td-export">${await renderDocument(title, source, decorate)}</main>`;
  window.print();
}
