import { calendarHtml, isDayKey, monthOf, shiftDay, shiftMonth, todayKey } from './journal';
import type { Property } from './propertyValues';

export const TARGET_DATE_KEY = 'target_date';
type SchedulableNote = { id: string; title: string; folderId: string | null; journal?: string | null; properties?: Property[] };

export function canScheduleNote(note: SchedulableNote) {
  return note.folderId !== 'archive' && !note.journal && !isDayKey(note.title) && !/^.+ template$/i.test(note.title.trim());
}

export function targetDateProperty(note: { properties?: Property[] }) {
  return note.properties?.find((p) => p.key.toLowerCase() === TARGET_DATE_KEY);
}

export function targetDate(note: { properties?: Property[] } | null) {
  const property = note ? targetDateProperty(note) : undefined;
  return property?.type === 'date' && isDayKey(property.value) ? property.value : null;
}

export function scheduledDays(notes: SchedulableNote[]) {
  const days = new Map<string, number>();
  for (const note of notes) {
    const day = targetDate(note);
    if (day && canScheduleNote(note)) days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
}

export function openScheduleDialog(note: SchedulableNote, save: (day: string | null) => Promise<void>) {
  if (!canScheduleNote(note) || document.querySelector('.schedule-dialog')) return;
  const current = targetDate(note);
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog schedule-dialog';
  dialog.setAttribute('aria-label', current ? 'Reschedule note' : 'Schedule note');
  dialog.innerHTML = `<form class="confirm-shell">
    <h2 class="confirm-title">${current ? 'Reschedule note' : 'Schedule note'}</h2>
    <p class="schedule-note-title"></p>
    <p class="confirm-detail">Choose the day this note appears in your journal. Task due dates stay as they are.</p>
    <label class="collection-field">Target date<input class="capture-text" name="day" type="date" required min="0001-01-01" max="9999-12-31"></label>
    <div class="schedule-shortcuts"><button type="button" class="confirm-button" data-shortcut="0">Today</button><button type="button" class="confirm-button" data-shortcut="1">Tomorrow</button></div>
    <div class="schedule-calendar"></div>
    <p class="capture-error" role="alert" hidden></p>
    <div class="confirm-actions"><button type="button" class="confirm-button" data-clear ${targetDateProperty(note) ? '' : 'hidden'}>Clear date</button><button type="button" class="confirm-button" data-cancel>Cancel</button><button type="submit" class="confirm-button is-primary">${current ? 'Reschedule' : 'Schedule'}</button></div>
  </form>`;
  dialog.querySelector('.schedule-note-title')!.textContent = note.title || 'Untitled';
  const form = dialog.querySelector('form')!;
  const input = form.querySelector<HTMLInputElement>('input')!;
  const calendar = form.querySelector<HTMLElement>('.schedule-calendar')!;
  const error = form.querySelector<HTMLElement>('[role="alert"]')!;
  input.value = current ?? todayKey();
  let shown = monthOf(input.value);
  let saving = false;
  const close = () => { if (saving) return; if (dialog.open) dialog.close(); dialog.remove(); };
  const paint = () => {
    calendar.innerHTML = calendarHtml(shown, new Set(), isDayKey(input.value) ? input.value : null);
    calendar.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((button) => {
      button.addEventListener('click', () => {
        input.value = button.dataset.day!;
        paint();
        calendar.querySelector<HTMLButtonElement>(`[data-day="${input.value}"]`)?.focus();
      });
    });
    calendar.querySelectorAll<HTMLButtonElement>('[data-month-shift]').forEach((button) => {
      button.addEventListener('click', () => {
        const direction = button.dataset.monthShift!;
        shown = shiftMonth(shown, Number(direction));
        paint();
        calendar.querySelector<HTMLButtonElement>(`[data-month-shift="${direction}"]`)?.focus();
      });
    });
  };
  const commit = async (day: string | null) => {
    if (saving) return;
    if (day !== null && !isDayKey(day)) { error.textContent = 'Choose a real date.'; error.hidden = false; input.focus(); return; }
    saving = true;
    form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((el) => { el.disabled = true; });
    error.hidden = true;
    try { await save(day); saving = false; close(); }
    catch (failure) {
      error.textContent = String(failure);
      error.hidden = false;
      saving = false;
      form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((el) => { el.disabled = false; });
    }
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); void commit(input.value); });
  form.querySelector('[data-clear]')!.addEventListener('click', () => { void commit(null); });
  form.querySelector('[data-cancel]')!.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  input.addEventListener('change', () => { if (isDayKey(input.value)) shown = monthOf(input.value); paint(); });
  form.querySelectorAll<HTMLButtonElement>('[data-shortcut]').forEach((button) => {
    button.addEventListener('click', () => { input.value = shiftDay(todayKey(), Number(button.dataset.shortcut)); shown = monthOf(input.value); paint(); });
  });
  paint();
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
}

export function bindCalendarDrop(root: HTMLElement, options: { mime: string; accepts: (id: string) => boolean; schedule: (id: string, day: string) => Promise<void>; fail: (error: unknown) => void }) {
  root.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((button) => {
    const accepts = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!data?.types.includes(options.mime)) return false;
      const id = data.getData(options.mime);
      return !id || options.accepts(id);
    };
    button.addEventListener('dragover', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer!.dropEffect = 'copy';
      button.classList.add('is-date-drop');
    });
    button.addEventListener('dragleave', () => button.classList.remove('is-date-drop'));
    button.addEventListener('drop', (event) => {
      button.classList.remove('is-date-drop');
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const id = event.dataTransfer!.getData(options.mime);
      if (!id || !options.accepts(id)) return;
      void options.schedule(id, button.dataset.day!).catch(options.fail);
    });
  });
}
