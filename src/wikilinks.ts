// Wikilinks in the editor: resolving `[[Title#Heading|label]]` targets to notes
// and the `[[` autocomplete for note titles.

import { formatDay, shiftDay, todayKey } from './journal';

export type LinkableNote = { id: string; title: string; folderId: string | null; journal?: string | null };
type Suggestion = LinkableNote & { hint?: string };

export function normalizeTitle(title: string) {
  return title.trim().toLowerCase();
}

/** Split a link target into its note title and optional heading anchor. */
export function splitTarget(target: string): { title: string; anchor: string | null } {
  const at = target.indexOf('#');
  if (at < 0) return { title: target.trim(), anchor: null };
  return { title: target.slice(0, at).trim(), anchor: target.slice(at + 1).trim() || null };
}

export function resolveTarget<T extends LinkableNote>(target: string, notes: T[]): T | null {
  const wanted = normalizeTitle(splitTarget(target).title);
  return notes.find((note) => normalizeTitle(note.title) === wanted) ?? null;
}

// ---- Autocomplete ----

// An unfinished link right before the caret: `[[` plus the title typed so far.
const OPEN_LINK = /\[\[([^\[\]|#\n]*)$/;
const MAX_SUGGESTIONS = 8;

type AutocompleteOptions = {
  /** Notes to suggest, most recently edited first. */
  notes: () => LinkableNote[];
  /** The note being edited, which is never suggested. */
  currentId: () => string | null;
};

let popup: HTMLDivElement | null = null;

/**
 * Suggest note titles after `[[` in `textarea`. Accepting a suggestion writes
 * `[[Title]]` and fires an `input` event, so the editor saves as usual.
 */
export function attachWikilinkAutocomplete(textarea: HTMLTextAreaElement, options: AutocompleteOptions) {
  let matches: Suggestion[] = [];
  let active = 0;
  let openAt = -1; // index of the `[[`

  const close = () => {
    openAt = -1;
    matches = [];
    popup?.remove();
    popup = null;
  };

  const accept = (note: Suggestion | undefined) => {
    if (!note || openAt < 0) return;
    const caret = textarea.selectionStart;
    const after = textarea.value.slice(caret);
    const end = after.startsWith(']]') ? caret + 2 : caret;
    const link = `[[${note.title}]]`;
    textarea.setRangeText(link, openAt, end, 'end');
    close();
    textarea.dispatchEvent(new Event('input'));
  };

  const render = () => {
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'wikilink-suggest';
      popup.setAttribute('role', 'listbox');
      // Keep focus (and the caret) in the textarea while choosing.
      popup.addEventListener('mousedown', (event) => event.preventDefault());
      document.body.append(popup);
    }
    const list = popup;
    list.innerHTML = matches.map((note, i) => `
      <div class="wikilink-suggest-row ${i === active ? 'active' : ''}" role="option" aria-selected="${i === active}" data-index="${i}">
        <span class="wikilink-suggest-brackets" aria-hidden="true">[[</span>${escapeHtml(note.title || 'Untitled')}${note.hint ? `<span class="wikilink-suggest-hint">${escapeHtml(note.hint)}</span>` : ''}
      </div>`).join('');
    list.querySelectorAll<HTMLElement>('.wikilink-suggest-row').forEach((row) => {
      row.addEventListener('click', () => accept(matches[Number(row.dataset.index)]));
    });
    const caret = caretPosition(textarea, openAt);
    const width = Math.min(320, window.innerWidth - 16);
    list.style.width = `${width}px`;
    list.style.left = `${Math.max(8, Math.min(caret.left, window.innerWidth - width - 8))}px`;
    const below = caret.top + caret.height + 6;
    const height = list.offsetHeight;
    list.style.top = `${below + height > window.innerHeight - 8 ? caret.top - height - 6 : below}px`;
  };

  const update = () => {
    const caret = textarea.selectionStart;
    if (caret !== textarea.selectionEnd) return close();
    const match = textarea.value.slice(0, caret).match(OPEN_LINK);
    if (!match) return close();
    openAt = caret - match[0].length;
    matches = suggest(match[1], options.notes(), options.currentId());
    active = 0;
    if (!matches.length) {
      popup?.remove();
      popup = null;
      return;
    }
    render();
  };

  textarea.addEventListener('input', update);
  textarea.addEventListener('click', update);
  textarea.addEventListener('blur', close);
  textarea.addEventListener('scroll', () => { if (popup) render(); });
  // Registered before the editors' own key handlers, so Escape and Enter
  // reach the suggestions first while they're open.
  textarea.addEventListener('keydown', (event) => {
    if (!popup || !matches.length) return;
    const handled = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key);
    if (!handled || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'ArrowDown') { active = (active + 1) % matches.length; render(); }
    else if (event.key === 'ArrowUp') { active = (active - 1 + matches.length) % matches.length; render(); }
    else if (event.key === 'Escape') close();
    else accept(matches[active]);
  });
}

function suggest(query: string, notes: LinkableNote[], currentId: string | null): Suggestion[] {
  const q = normalizeTitle(query);
  const candidates = notes.filter((note) => note.id !== currentId && note.folderId !== 'archive');
  if (!q) return candidates.slice(0, MAX_SUGGESTIONS);
  // `[[tod` offers today's journal page by its date, whether or not it exists yet.
  const days: Suggestion[] = q.length < 2 ? [] : ([['today', 0], ['yesterday', -1], ['tomorrow', 1]] as const)
    .filter(([word]) => word.startsWith(q))
    .map(([word, offset]) => {
      const day = shiftDay(todayKey(), offset);
      return { id: `journal:${day}`, title: day, folderId: null, journal: day, hint: `${word[0].toUpperCase()}${word.slice(1)} · ${formatDay(day, 'short')}` };
    });
  const rank = (title: string) => {
    const t = normalizeTitle(title);
    if (t.startsWith(q)) return 3;
    if (t.split(/[\s/–-]+/).some((word) => word.startsWith(q))) return 2;
    return t.includes(q) ? 1 : 0;
  };
  const ranked = candidates
    .map((note, order) => ({ note, order, score: rank(note.title) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .filter((entry) => !days.some((day) => day.title === entry.note.title))
    .slice(0, MAX_SUGGESTIONS - days.length)
    .map((entry): Suggestion => entry.note.journal ? { ...entry.note, hint: formatDay(entry.note.journal, 'short') } : entry.note);
  return [...days, ...ranked];
}

/** Viewport position of the character at `index` in a textarea. */
export function caretPosition(textarea: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const prop of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'] as const) {
    mirror.style[prop] = style[prop];
  }
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  mirror.textContent = textarea.value.slice(0, index);
  // Measure the whole word at `index` so the mirror wraps it like the textarea.
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(index).match(/^\S*/)?.[0] || '.';
  mirror.append(marker);
  document.body.append(mirror);
  const rect = textarea.getBoundingClientRect();
  const position = {
    left: rect.left + marker.offsetLeft - textarea.scrollLeft,
    top: rect.top + marker.offsetTop - textarea.scrollTop,
    height: marker.offsetHeight,
  };
  mirror.remove();
  return position;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
