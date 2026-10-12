// "Version history" dialog: earlier versions of the open note, rendered, with
// a button to restore one.

import { invoke } from '@tauri-apps/api/core';
import { renderPreview, applyExternals } from './tagdown/renderer';
import { getEffectiveTheme } from './settings/theme';
import './styles/history.css';

type Version = { id: string; createdAt: string; title: string; preview: string; wordCount: number };

type HistoryOptions = {
  noteId: string;
  title: string;
  content: string;
  updatedAt: string;
  /** Restore a version; resolves once the editor shows it. */
  restore: (versionId: string, label: string) => Promise<void>;
};

const CURRENT = 'current';

export async function openVersionHistory(options: HistoryOptions) {
  document.querySelector('.history-dialog')?.remove();
  const versions = await invoke<Version[]>('list_versions', { id: options.noteId });
  const currentWords = wordCount(options.content);
  const cache = new Map<string, string>([[CURRENT, options.content]]);

  const dialog = document.createElement('dialog');
  dialog.className = 'history-dialog';
  dialog.setAttribute('aria-label', 'Version history');
  const row = (id: string, label: string, detail: string) => `
    <li><button type="button" class="history-row" data-version="${id}">
      <strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small>
    </button></li>`;
  const delta = (words: number) => {
    const d = words - currentWords;
    return d === 0 ? 'same length' : `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString()} ${Math.abs(d) === 1 ? 'word' : 'words'}`;
  };
  dialog.innerHTML = `
    <div class="history-shell">
      <header class="history-head">
        <div><h2>Version history</h2><span>${escapeHtml(options.title || 'Untitled')}</span></div>
        <button type="button" class="history-close" aria-label="Close" data-close>×</button>
      </header>
      <div class="history-body">
        <ol class="history-list" aria-label="Versions">
          ${row(CURRENT, 'Current version', `Edited ${versionDate(options.updatedAt)} · ${currentWords.toLocaleString()} words`)}
          ${versions.map((v) => row(v.id, versionDate(v.createdAt), `${v.wordCount.toLocaleString()} words · ${delta(v.wordCount)}`)).join('')}
        </ol>
        <article class="history-preview preview td-note-root" aria-live="polite"></article>
      </div>
      <footer class="history-foot">
        <span>${versions.length
          ? 'Tagdown keeps a version every few minutes while you write, and thins out older ones.'
          : 'No earlier versions yet. Tagdown keeps one every few minutes while you write.'}</span>
        <button type="button" class="confirm-button is-primary" data-restore disabled>Restore this version</button>
      </footer>
    </div>`;
  document.body.append(dialog);

  const preview = dialog.querySelector<HTMLElement>('.history-preview')!;
  const restoreButton = dialog.querySelector<HTMLButtonElement>('[data-restore]')!;
  const rows = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.history-row'));
  let selected = CURRENT;
  let token = 0;

  const select = async (id: string) => {
    selected = id;
    rows.forEach((r) => r.classList.toggle('active', r.dataset.version === id));
    restoreButton.disabled = id === CURRENT;
    const mine = ++token;
    if (!cache.has(id)) cache.set(id, await invoke<string>('get_version', { id: options.noteId, versionId: id }));
    if (mine !== token) return;
    preview.innerHTML = renderPreview(cache.get(id)!);
    preview.scrollTop = 0;
    void applyExternals(preview, getEffectiveTheme());
  };

  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  rows.forEach((r) => r.addEventListener('click', () => void select(r.dataset.version!)));
  dialog.querySelector('.history-list')!.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
    event.preventDefault();
    const i = rows.findIndex((r) => r.dataset.version === selected);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (key === 'ArrowDown' ? 1 : -1)))];
    next.focus();
    void select(next.dataset.version!);
  });
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.addEventListener('mousedown', (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => dialog.remove());
  restoreButton.addEventListener('click', async () => {
    if (selected === CURRENT) return;
    const label = rows.find((r) => r.dataset.version === selected)?.querySelector('strong')?.textContent ?? '';
    restoreButton.disabled = true;
    await options.restore(selected, label);
    close();
  });

  dialog.showModal();
  // Open on the newest earlier version: that's usually what you came for.
  const first = versions.length ? versions[0].id : CURRENT;
  rows.find((r) => r.dataset.version === first)?.focus();
  await select(first);
}

function versionDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  return `${day}, ${time}`;
}

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
