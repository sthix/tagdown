// Quick capture (⌥⌘J): a small box that adds a line to today's journal page
// without leaving the note you're in.

import { formatDay, todayKey } from './journal';

type CaptureOptions = {
  /** Adds the text to the day's page; a rejection keeps the box open with the error. */
  save: (day: string, text: string, asTask: boolean) => Promise<void>;
};

// "As a task" stays as last chosen while the app runs.
let asTask = false;

export function openQuickCapture({ save }: CaptureOptions) {
  const open = document.querySelector<HTMLDialogElement>('.capture-dialog');
  if (open) { open.querySelector('textarea')?.focus(); return; }
  const day = todayKey();
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog capture-dialog';
  dialog.setAttribute('aria-label', 'Quick capture');
  dialog.innerHTML = `
    <form class="confirm-shell capture-shell" method="dialog">
      <h2 class="confirm-title">Quick capture</h2>
      <p class="confirm-detail">Adds to the end of today’s journal page, ${formatDay(day)}.</p>
      <textarea class="capture-text" rows="3" placeholder="A thought, a task, a link…" aria-label="Text to add"></textarea>
      <p class="capture-error" role="alert" hidden></p>
      <div class="confirm-actions capture-actions">
        <label class="capture-task"><input type="checkbox"${asTask ? ' checked' : ''}> As a task</label>
        <span class="capture-hint">↩ add · ⇧↩ new line</span>
        <button type="button" class="confirm-button" data-capture-cancel>Cancel</button>
        <button type="submit" class="confirm-button is-primary" data-capture-ok>Add</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const text = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
  const task = dialog.querySelector<HTMLInputElement>('.capture-task input')!;
  const error = dialog.querySelector<HTMLElement>('.capture-error')!;
  const ok = dialog.querySelector<HTMLButtonElement>('[data-capture-ok]')!;
  const restore = document.activeElement as HTMLElement | null;
  const close = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
    restore?.focus({ preventScroll: true });
  };
  const submit = async () => {
    if (!text.value.trim() || ok.disabled) { text.focus(); return; }
    ok.disabled = true;
    try {
      asTask = task.checked;
      await save(day, text.value, task.checked);
      close();
    } catch (failure) {
      error.textContent = String(failure);
      error.hidden = false;
      ok.disabled = false;
    }
  };
  dialog.querySelector('form')!.addEventListener('submit', (event) => { event.preventDefault(); void submit(); });
  dialog.querySelector('[data-capture-cancel]')!.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); }
  });
  dialog.showModal();
  text.focus();
}
