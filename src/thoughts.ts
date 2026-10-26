import type { QueryNote } from './queries';
import type { Property } from './propertyValues';

const REASONS: Record<string, string> = {
  captured: 'Sent to Thoughts', untitled: 'Needs a title', empty: 'Needs content', unlinked: 'No linked notes',
};

export function inboxProperty(note: { properties?: Property[] }) {
  return note.properties?.find((p) => p.key.toLowerCase() === 'inbox');
}

export function canReviewNote(note: { folderId: string | null; journal?: string | null; title: string }) {
  return note.folderId !== 'archive' && !note.journal && !/^.+ template$/i.test(note.title.trim());
}

export type ThoughtReviewOptions = {
  process: (id: string) => Promise<void>;
  busy: boolean;
  undo?: { title: string; run: () => Promise<void> };
};

export function renderThoughts(body: HTMLElement, notes: QueryNote[], options: ThoughtReviewOptions) {
  if (options.undo) {
    const notice = document.createElement('div');
    notice.className = 'thoughts-notice';
    notice.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = `Marked “${options.undo.title || 'Untitled'}” as processed.`;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.dataset.undoThought = '';
    undo.className = 'confirm-button';
    undo.textContent = 'Undo';
    undo.disabled = options.busy;
    undo.addEventListener('click', () => { void options.undo!.run(); });
    notice.append(text, undo);
    body.append(notice);
  }
  const hint = document.createElement('p');
  hint.className = 'thoughts-hint';
  hint.textContent = 'Review incomplete or disconnected notes. Mark a note as processed to keep it out of this inbox, or send it here from its note menu.';
  body.append(hint);
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'thoughts-empty';
    const title = document.createElement('h2');
    title.textContent = 'Nothing to review';
    const detail = document.createElement('p');
    detail.textContent = 'Notes appear here when they need a title, content, or a connection. Journal pages, templates, and archived notes stay out.';
    empty.append(title, detail);
    body.append(empty);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'thoughts-grid';
  for (const note of notes) {
    const article = document.createElement('article');
    article.className = 'thought-card';
    const link = document.createElement('a');
    link.href = '#';
    link.dataset.openNote = note.id;
    const title = document.createElement('h2');
    title.textContent = note.title || 'Untitled';
    link.append(title);
    const preview = document.createElement('p');
    preview.className = 'thought-excerpt';
    preview.textContent = note.excerpt || 'Open this note to develop the idea.';
    const reasons = document.createElement('div');
    reasons.className = 'thought-reasons';
    for (const reason of note.thoughtReasons ?? []) {
      if (!REASONS[reason]) continue;
      const chip = document.createElement('span');
      chip.textContent = REASONS[reason];
      reasons.append(chip);
    }
    const footer = document.createElement('footer');
    const tags = document.createElement('span');
    tags.className = 'thought-tags';
    tags.textContent = note.tags.map((tag) => `#${tag}`).join(' ');
    const process = document.createElement('button');
    process.type = 'button';
    process.className = 'confirm-button';
    process.dataset.processThought = note.id;
    process.textContent = 'Mark processed';
    process.setAttribute('aria-label', `Mark ${note.title || 'Untitled'} as processed`);
    process.disabled = options.busy;
    process.addEventListener('click', async () => {
      process.disabled = true;
      try { await options.process(note.id); }
      finally { if (process.isConnected) process.disabled = false; }
    });
    footer.append(tags, process);
    article.append(link, preview, reasons, footer);
    grid.append(article);
  }
  body.append(grid);
}
