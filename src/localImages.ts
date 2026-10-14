// Local images in notes. Pasted, dropped or picked images are copied into the
// vault's `attachments/` folder and written into the note as a figure with a
// vault-relative path; the preview loads such paths through Tauri's asset
// protocol, since the WebView can't read the vault directly.

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'heic', 'heif', 'bmp', 'tiff'];

let vaultRoot: string | null = null;

export function setVaultRoot(path: string | null) {
  vaultRoot = path ? path.replace(/\/+$/, '') : null;
}

/** Point images with a local path (`attachments/a.png`, `/Users/…/b.jpg`) at their file. */
export function resolveLocalImages(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    // A figure whose image can't load says so instead of showing a broken image.
    const figure = img.closest<HTMLElement>('.td-figure');
    if (figure) {
      img.addEventListener('error', () => {
        // Not the error of the relative URL this replaces while the file loads.
        if (!img.complete || img.naturalWidth) return;
        figure.classList.add('is-missing');
        figure.dataset.missing = `Image not found: ${src}`;
      }, { once: true });
    }
    // URLs (https:, data:, asset:, …) load as they are.
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return;
    let path = src;
    try { path = decodeURI(src); } catch { /* keep it as written */ }
    if (!path.startsWith('/')) {
      if (!vaultRoot) return;
      path = `${vaultRoot}/${path.replace(/^\.\//, '')}`;
    }
    try {
      img.src = convertFileSrc(path);
    } catch {
      // Outside the app there is no asset protocol; leave the path alone.
    }
  });
}

export function isImageFile(file: File) {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() ?? '');
}

/** Image files carried by a paste or drop. */
export function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter(isImageFile);
}

/** Copy an image into the vault; resolves to the path to put in the note. */
export async function saveImage(file: File): Promise<string> {
  // A pasted screenshot is just "image.png": give it a name worth keeping.
  const ext = file.name.split('.').pop()?.toLowerCase() || file.type.split('/')[1] || 'png';
  const name = !file.name || /^image\.\w+$/i.test(file.name) ? `Pasted image ${stamp()}.${ext}` : file.name;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<string>('save_attachment', bytes, { headers: { 'x-file-name': encodeURIComponent(name) } });
}

/** Ask for image files and copy them into the vault; resolves to their paths. */
export async function pickImages(): Promise<string[]> {
  const picked = await open({ multiple: true, directory: false, filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }] });
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  return Promise.all(paths.map((path) => invoke<string>('import_attachment', { path })));
}

/** A figure for an image at `path`; a caption can be added to it later. */
export function figureMarkup(path: string) {
  return `<figure src="${path.replace(/"/g, '%22')}" />`;
}

function stamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}
