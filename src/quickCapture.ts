import { uiIcon } from './icons';
import { formatDay, todayKey } from './journal';
import './styles/quick-capture.css';

export type CaptureRequest = { id: string; day: string; text: string; asTask: boolean };
export type CaptureResult = { id: string; error?: string };
type CaptureOptions = {
  save: (day: string, text: string, asTask: boolean) => Promise<void>;
  close?: () => void;
  resize?: (height: number) => void;
};

let asTask = false;

/** Shared by the floating desktop window and the browser preview dialog. */
export function mountQuickCapture(root: HTMLElement, { save, close, resize }: CaptureOptions) {
  root.innerHTML = `
    <form class="capture-shell" aria-label="Quick capture">
      <div class="capture-bar">
        <span class="capture-mark" data-tauri-drag-region title="Quick capture · drag to move">${uiIcon('compose', 26)}</span>
        <textarea class="capture-text" rows="1" placeholder="A thought, a task, a link…" aria-label="Text to add to your journal" aria-describedby="capture-destination capture-hint"></textarea>
        <button type="submit" class="capture-submit" aria-label="Add to journal" title="Add to journal (Enter)"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
      </div>
      <div class="capture-footer">
        <span class="capture-destination" id="capture-destination" data-tauri-drag-region>${uiIcon('calendar', 14)} <span></span></span>
        <label class="capture-task"><input type="checkbox"${asTask ? ' checked' : ''}> As a task</label>
        <span class="capture-hint" id="capture-hint">↩ add <span>·</span> ⇧↩ new line</span>
        <button type="button" class="capture-cancel" title="Cancel (Escape)" aria-label="Cancel quick capture">${uiIcon('close', 14)}<span>esc</span></button>
      </div>
      <p class="capture-error" role="alert" hidden></p>
    </form>`;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const text = root.querySelector<HTMLTextAreaElement>('textarea')!;
  const task = root.querySelector<HTMLInputElement>('input')!;
  const error = root.querySelector<HTMLElement>('.capture-error')!;
  const ok = root.querySelector<HTMLButtonElement>('.capture-submit')!;
  let busy = false;
  const fit = () => {
    text.style.height = 'auto';
    text.style.height = `${Math.min(180, Math.max(32, text.scrollHeight))}px`;
    resize?.(Math.ceil(form.getBoundingClientRect().height) + 48);
  };
  const refresh = () => {
    root.querySelector('.capture-destination span')!.textContent = `Today’s journal · ${formatDay(todayKey(), 'short')}`;
    text.focus({ preventScroll: true });
    fit();
  };
  const dismiss = () => { if (!busy) close?.(); };
  const submit = async () => {
    if (busy || !text.value.trim()) { text.focus(); return; }
    busy = true;
    ok.disabled = true;
    text.readOnly = true;
    task.disabled = true;
    error.hidden = true;
    form.setAttribute('aria-busy', 'true');
    try {
      asTask = task.checked;
      await save(todayKey(), text.value, task.checked);
      text.value = '';
      close?.();
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : String(failure);
      error.hidden = false;
      text.focus();
    } finally {
      busy = false;
      ok.disabled = false;
      text.readOnly = false;
      task.disabled = false;
      form.removeAttribute('aria-busy');
      fit();
    }
  };
  form.addEventListener('submit', event => { event.preventDefault(); void submit(); });
  root.querySelector('.capture-cancel')!.addEventListener('click', dismiss);
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); } });
  task.addEventListener('change', () => { asTask = task.checked; });
  text.addEventListener('input', fit);
  text.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); }
  });
  refresh();
  return { refresh, dismiss };
}

export function openQuickCapture(options: CaptureOptions) {
  const open = document.querySelector<HTMLDialogElement>('.capture-dialog');
  if (open) { open.querySelector('textarea')?.focus(); return; }
  const restore = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = 'capture-dialog';
  dialog.setAttribute('aria-label', 'Quick capture');
  document.body.append(dialog);
  const capture = mountQuickCapture(dialog, { ...options, close: () => {
    dialog.close();
    dialog.remove();
    restore?.focus({ preventScroll: true });
  } });
  dialog.addEventListener('cancel', event => { event.preventDefault(); capture.dismiss(); });
  dialog.showModal();
  capture.refresh();
}
