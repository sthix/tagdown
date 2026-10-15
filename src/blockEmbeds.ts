// `![[Note#^id]]` embeds: the parser leaves a `.td-transclusion` placeholder and
// this fills it with the block's current text from the vault, read-only.
// Editing an embedded block in place is a later step; for now its source link
// opens the note at the block.

import { invoke } from '@tauri-apps/api/core';
import { renderPreview } from './tagdown/renderer';
import { blockIdOfTarget } from './blockRefs';
import { normalizeTitle, splitTarget } from './wikilinks';

export type BlockRef = { note: { id: string; title: string }; block: { id: string; text: string } };

/** Embeds inside embeds go this deep; past it (or in a loop) they stay links. */
const MAX_DEPTH = 3;

// Last result per target, so a repaint shows the block at once and only
// redraws when the text changed.
const cache = new Map<string, BlockRef | null>();
// Lookups in flight, so a page with many links to one block asks once.
const pending = new Map<string, Promise<BlockRef | null>>();

const keyOf = (title: string, id: string) => `${normalizeTitle(title)}#^${id.toLowerCase()}`;

/** Forget cached blocks, so exports show what's in the vault right now. */
export function invalidateBlockEmbeds() {
  cache.clear();
}

/** The block `^id` in the note titled `title`, or null when either is gone. */
export function lookupBlock(title: string, id: string): Promise<BlockRef | null> {
  const key = keyOf(title, id);
  let request = pending.get(key);
  if (!request) {
    request = invoke<BlockRef | null>('block_ref', { title, id })
      .catch(() => null)
      .then((ref) => { cache.set(key, ref); return ref; })
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}

/** The last known result for a block, without asking the vault. */
export function cachedBlock(title: string, id: string): BlockRef | null | undefined {
  return cache.get(keyOf(title, id));
}

/**
 * Fill every empty embed under `root`, embeds inside them included; resolves
 * once all are filled. `decorate` runs on each filled body (link states,
 * images, math) once its HTML is in place. A filled embed records its note's
 * id in `data-note-id`.
 */
export async function fillBlockEmbeds(root: HTMLElement, decorate: (body: HTMLElement) => unknown, trail: string[] = []): Promise<void> {
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
    const paint = async (ref: BlockRef | null) => {
      embed.classList.toggle('is-missing', !ref);
      if (!ref) {
        delete embed.dataset.noteId;
        body.innerHTML = `<span class="td-transclusion-note">No block <code>^${escapeHtml(id)}</code> in “${escapeHtml(title)}”</span>`;
        return;
      }
      embed.dataset.noteId = ref.note.id;
      body.innerHTML = renderPreview(ref.block.text);
      // Read-only: tick tasks in their own note.
      body.querySelectorAll('input').forEach((box) => box.setAttribute('disabled', ''));
      await decorate(body);
      await fillBlockEmbeds(body, decorate, [...trail, key]);
    };
    const cached = cache.get(key);
    if (cached !== undefined) void paint(cached);
    else body.innerHTML = '<span class="td-transclusion-note">Loading…</span>';
    const ref = await lookupBlock(title, id);
    if (cached === undefined || JSON.stringify(ref) !== JSON.stringify(cached)) await paint(ref);
  }));
}

/**
 * The element a `.td-block-id` marker names: the list item, paragraph or
 * heading it ends, or for a marker on its own line, the block above it.
 */
export function blockTarget(marker: HTMLElement): HTMLElement | null {
  if (marker.classList.contains('td-block-id-standalone')) {
    let prev = marker.previousElementSibling;
    while (prev?.matches('.td-block-id')) prev = prev.previousElementSibling;
    if (prev instanceof HTMLElement) return prev;
    const block = marker.closest('.td-block')?.previousElementSibling;
    return block instanceof HTMLElement ? block : null;
  }
  return marker.closest<HTMLElement>('li, p, h1, h2, h3, h4, h5, h6, .td-block');
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
