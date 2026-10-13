// Drag-and-drop reordering of preview blocks, after Notion: hovering a block
// shows a grip in the left margin; dragging it lifts a copy of the block and a
// drop line shows where it will land. Near the top or bottom edge the preview
// scrolls; Escape cancels.
//
// The module only knows about `.td-block[data-block]` elements in the preview.
// Moving the source text is up to the caller.

type Options = {
  /** How many blocks the source has (dropping at the end inserts before this index). */
  count: () => number;
  /** Index of the first block that may be moved or dropped before. */
  firstMovable: () => number;
  /** Called on press, before the drag starts; returns the block's index afterwards (-1 to cancel). */
  prepare: (index: number) => number;
  /** How many blocks, starting at `index`, move together (a heading's section). */
  span: (index: number) => number;
  /** Move `count` blocks from `from` so they sit before block `to` (`to` may equal the block count). */
  move: (from: number, to: number, count: number) => void;
};

const EDGE = 56; // px from the preview's edge where dragging scrolls it
const GHOST_PAD = 6; // the lifted copy's padding above the block

const GRIP = '<svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true"><g fill="currentColor"><circle cx="4" cy="4" r="1.3"/><circle cx="8" cy="4" r="1.3"/><circle cx="4" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="4" cy="12" r="1.3"/><circle cx="8" cy="12" r="1.3"/></g></svg>';

export function attachBlockDrag(preview: HTMLElement, host: HTMLElement, options: Options) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'block-drag-handle';
  handle.title = 'Drag to move';
  handle.setAttribute('aria-label', 'Drag to move this block');
  handle.tabIndex = -1;
  handle.innerHTML = GRIP;
  handle.hidden = true;
  host.append(handle);

  let hovered: HTMLElement | null = null;
  let dragging = false;

  const blocks = () =>
    Array.from(preview.querySelectorAll<HTMLElement>(':scope > .td-block[data-block]'))
      .filter((el) => el.offsetParent !== null);
  const indexOf = (el: HTMLElement) => Number(el.dataset.block);

  const placeHandle = (block: HTMLElement | null) => {
    hovered = block;
    if (!block || block.classList.contains('is-editing') || indexOf(block) < options.firstMovable()) {
      handle.hidden = true;
      return;
    }
    const rect = block.getBoundingClientRect();
    const area = preview.getBoundingClientRect();
    // Line the grip up with the block's first line of text.
    const first = block.firstElementChild as HTMLElement | null;
    const lineHeight = first ? parseFloat(getComputedStyle(first).lineHeight) || 24 : 24;
    const top = rect.top + (first ? first.getBoundingClientRect().top - rect.top : 0) + lineHeight / 2 - 12;
    if (top < area.top || top > area.bottom - 24) { handle.hidden = true; return; }
    handle.hidden = false;
    handle.style.top = `${top}px`;
    handle.style.left = `${Math.max(area.left + 2, rect.left - 30)}px`;
  };

  // The block level with the pointer, so the grip stays reachable in the margin.
  const blockAt = (y: number) => blocks().find((el) => {
    const rect = el.getBoundingClientRect();
    return y >= rect.top - 6 && y <= rect.bottom + 6;
  }) ?? null;

  preview.addEventListener('mousemove', (event) => {
    if (dragging) return;
    const block = blockAt(event.clientY);
    if (block !== hovered || (block && handle.hidden)) placeHandle(block);
  });
  preview.addEventListener('mouseleave', (event) => {
    // Moving onto the grip (or the icon inside it) keeps it showing.
    if (dragging || handle.contains(event.relatedTarget as Node | null)) return;
    placeHandle(null);
  });
  preview.addEventListener('scroll', () => { if (!dragging) placeHandle(null); });
  handle.addEventListener('mouseleave', (event) => {
    if (!dragging && !preview.contains(event.relatedTarget as Node)) placeHandle(null);
  });

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !hovered) return;
    event.preventDefault();
    const from = options.prepare(indexOf(hovered));
    if (from < 0) { placeHandle(null); return; }
    // `prepare` may have repainted the preview; find the block again.
    const count = Math.max(1, options.span(from));
    const sources = blocks().filter((el) => indexOf(el) >= from && indexOf(el) < from + count);
    if (!sources.length || indexOf(sources[0]) !== from) { placeHandle(null); return; }
    startDrag(sources, from, count, event);
  });

  function startDrag(sources: HTMLElement[], from: number, count: number, down: PointerEvent) {
    dragging = true;
    const first = sources[0].getBoundingClientRect();
    const last = sources[sources.length - 1].getBoundingClientRect();
    const rect = { left: first.left, top: first.top, width: first.width, height: last.bottom - first.top };
    const offsetY = down.clientY - rect.top;
    // Dropping inside the blocks being moved changes nothing.
    const isNoop = (to: number) => to >= from && to <= from + count;

    // The lifted copy is a small preview of its own, so the block keeps its
    // type styles. It lives on <body>, away from the editor's view-mode rules
    // for its real preview (backgrounds, padding, masks).
    const ghost = document.createElement('div');
    ghost.className = 'preview td-note-root block-drag-ghost';
    ghost.classList.toggle('is-tall', rect.height > 320);
    for (const source of sources) {
      const copy = source.cloneNode(true) as HTMLElement;
      copy.removeAttribute('data-block');
      copy.classList.remove('is-drag-source', 'is-just-moved');
      ghost.append(copy);
    }
    ghost.style.width = `${rect.width + 24}px`;
    ghost.style.left = `${rect.left - 12}px`;
    ghost.style.top = `${rect.top - GHOST_PAD}px`;
    document.body.append(ghost);

    const line = document.createElement('div');
    line.className = 'block-drag-line';
    line.hidden = true;
    host.append(line);

    sources.forEach((source) => source.classList.add('is-drag-source'));
    handle.hidden = true;
    document.body.classList.add('is-block-dragging');

    let target = -1;
    let pointerY = down.clientY;
    let frame = 0;

    const update = () => {
      ghost.style.top = `${pointerY - offsetY - GHOST_PAD}px`;
      const area = preview.getBoundingClientRect();
      const firstMovable = options.firstMovable();
      const candidates = blocks().filter((el) => indexOf(el) >= firstMovable);
      // Before the first block whose middle is below the pointer; else last.
      let before: HTMLElement | null = null;
      for (const el of candidates) {
        const box = el.getBoundingClientRect();
        if (pointerY < box.top + box.height / 2) { before = el; break; }
      }
      target = before ? indexOf(before) : options.count();
      line.hidden = isNoop(target) || !candidates.length;
      if (!line.hidden) {
        let y: number;
        if (before) {
          const box = before.getBoundingClientRect();
          const prev = candidates[candidates.indexOf(before) - 1];
          y = prev ? (prev.getBoundingClientRect().bottom + box.top) / 2 : box.top - 6;
        } else {
          y = candidates[candidates.length - 1].getBoundingClientRect().bottom + 6;
        }
        const ref = (before ?? candidates[candidates.length - 1]).getBoundingClientRect();
        line.style.top = `${Math.min(Math.max(y, area.top), area.bottom) - 1}px`;
        line.style.left = `${ref.left - 8}px`;
        line.style.width = `${ref.width + 16}px`;
      }
    };

    const scroll = () => {
      const area = preview.getBoundingClientRect();
      const speed = pointerY < area.top + EDGE
        ? -Math.ceil((area.top + EDGE - pointerY) / 4)
        : pointerY > area.bottom - EDGE ? Math.ceil((pointerY - (area.bottom - EDGE)) / 4) : 0;
      if (speed) {
        preview.scrollTop += speed;
        update();
      }
      frame = requestAnimationFrame(scroll);
    };

    const finish = (commit: boolean) => {
      dragging = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      document.removeEventListener('keydown', onKey, true);
      ghost.remove();
      line.remove();
      sources.forEach((source) => source.classList.remove('is-drag-source'));
      document.body.classList.remove('is-block-dragging');
      placeHandle(null);
      if (commit && target >= 0 && !isNoop(target)) options.move(from, target, count);
    };
    const onMove = (event: PointerEvent) => { pointerY = event.clientY; update(); };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };

    // On the window rather than captured on the grip, so the drag follows the
    // pointer anywhere, including outside the preview.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    document.addEventListener('keydown', onKey, true);
    update();
    frame = requestAnimationFrame(scroll);
  }
}
