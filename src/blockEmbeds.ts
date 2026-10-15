// `![[Note#^id]]` embeds: the parser leaves a `.td-transclusion` placeholder and
// this fills it with the block's current text from the vault, read-only.
// Editing an embedded block in place is a later step; for now its source link
// opens the note at the block.

import { invoke } from '@tauri-apps/api/core';
import { renderPreview } from './tagdown/renderer';
import { blockIdOfTarget } from './blockRefs';
import { normalizeTitle, splitTarget } from './wikilinks';

type BlockRef = { note: { id: string; title: string }; block: { id: string; text: string } };

/** Embeds inside embeds go this deep; past it (or in a loop) they stay links. */
const MAX_DEPTH = 3;

// Last result per target, so a repaint shows the block at once and only
// redraws when the text changed.
const cache = new Map<string, BlockRef | null>();

const keyOf = (title: string, id: string) => `${normalizeTitle(title)}#^${id.toLowerCase()}`;

/**
 * Fill every empty embed under `root`. `decorate` runs on each filled body
 * (link states, images, math) once its HTML is in place.
 */
export async function fillBlockEmbeds(root: HTMLElement, decorate: (body: HTMLElement) => void, trail: string[] = []): Promise<void> {
  const embeds = Array.from(root.querySelectorAll<HTMLElement>('.td-transclusion'))
    .filter((el) => el.parentElement?.closest('.td-transclusion') === root.closest('.td-transclusion'));
  await Promise.all(embeds.map(async (embed) => {
    const body = embed.querySelector<HTMLElement>(':scope > .td-transclusion-body');
    const target = embed.dataset.target ?? '';
    const id = blockIdOfTarget(target);
    const { title } = splitTarget(target);
    if (!body || !id || !title) return;
    const key = keyOf(title, id);
    if (trail.includes(key) || trail.length >= MAX_DEPTH) {
      embed.classList.add('is-cut');
      return;
    }
    const paint = (ref: BlockRef | null) => {
      embed.classList.toggle('is-missing', !ref);
      if (!ref) {
        body.innerHTML = `<span class="td-transclusion-note">No block <code>^${escapeHtml(id)}</code> in “${escapeHtml(title)}”</span>`;
        return;
      }
      body.innerHTML = renderPreview(ref.block.text);
      // Read-only: tick tasks in their own note.
      body.querySelectorAll('input').forEach((box) => box.setAttribute('disabled', ''));
      decorate(body);
      void fillBlockEmbeds(body, decorate, [...trail, key]);
    };
    const cached = cache.has(key);
    if (cached) paint(cache.get(key)!);
    else body.innerHTML = '<span class="td-transclusion-note">Loading…</span>';
    const ref = await invoke<BlockRef | null>('block_ref', { title, id }).catch(() => null);
    const changed = JSON.stringify(ref) !== JSON.stringify(cache.get(key));
    cache.set(key, ref);
    if (changed || !cached) paint(ref);
  }));
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
