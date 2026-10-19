import type { Edit } from './listEditing';

export type AiSelection = { noteId: string; content: string; start: number; end: number };

/** Provider results never replace a note or range that changed while waiting. */
export function aiResultEdit(snapshot: AiSelection, noteId: string, current: string, result: string, mode: 'replace' | 'insert'): Edit {
  if (snapshot.noteId !== noteId || snapshot.content !== current) throw new Error('The note changed. Run the action again before applying this result.');
  if (!Number.isInteger(snapshot.start) || !Number.isInteger(snapshot.end) || snapshot.start < 0 || snapshot.end < snapshot.start || snapshot.end > current.length) throw new Error('The selected range is no longer valid.');
  const from = mode === 'replace' ? snapshot.start : snapshot.end;
  const text = mode === 'insert' && snapshot.start !== snapshot.end ? `\n\n${result}` : result;
  return { from, to: snapshot.end, text, selStart: from + text.length, selEnd: from + text.length };
}
