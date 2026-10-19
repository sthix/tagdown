import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { todayKey, formatDay } from './journal';
import './styles/meetings.css';

type CalendarEvent = {
  uid: string; title: string; day: string; time: string; timezone: string;
  location: string; description: string; attendees: string[]; recurring: boolean;
  recurrenceId: string; existingNoteId: string | null;
};
type NamedNote = { title: string };
type MeetingOptions = {
  people: NamedNote[];
  projects: NamedNote[];
  day?: string;
  beforeSave: () => Promise<void>;
  created: (id: string) => Promise<void>;
};

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Build a meeting by hand or review an event from an iCalendar export. */
export function openMeetings(options: MeetingOptions) {
  const existing = document.querySelector<HTMLDialogElement>('.meetings-dialog');
  if (existing) { existing.focus(); return; }
  const restore = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog meetings-dialog';
  dialog.setAttribute('aria-label', 'Meeting notes');
  dialog.innerHTML = `
    <div class="meeting-shell">
      <header class="meeting-header"><div><h2>Meeting notes</h2><p>Connect an agenda, people, decisions, and next steps.</p></div><button type="button" class="confirm-button" data-close>Close</button></header>
      <div class="meeting-layout">
        <aside class="meeting-events">
          <button type="button" class="confirm-button" data-import>Import calendar (.ics)…</button>
          <p class="meeting-help">Export a calendar from Apple Calendar, Google Calendar, or Outlook, then choose the events to turn into notes.</p>
          <input type="search" data-filter placeholder="Filter events" aria-label="Filter calendar events" hidden>
          <p class="meeting-help" data-import-status aria-live="polite">No calendar imported. You can also create a meeting directly.</p>
          <div data-event-list class="meeting-event-list"></div>
        </aside>
        <form class="meeting-form">
          <p data-recurring class="meeting-help" hidden>Repeating event: this creates one note for the listed occurrence. Future occurrences are not expanded. Give the series a name to group your meeting notes.</p>
          <label>Meeting name<input name="title" required maxlength="250" placeholder="Weekly planning" autocomplete="off"></label>
          <div class="meeting-fields"><label>Date<input name="day" type="date" required value="${escape(options.day ?? todayKey())}"></label><label>Time<input name="time" type="time"></label></div>
          <label>Time zone<input name="timezone" placeholder="Local time" maxlength="200"></label>
          <label>People <small>One name per line. New names become Person notes.</small><textarea name="attendees" rows="2" placeholder="Sam Rivera&#10;Alex Chen"></textarea></label>
          <label>Project<input name="project" list="meeting-projects" placeholder="Optional" maxlength="250"><datalist id="meeting-projects">${options.projects.map(n => `<option value="${escape(n.title)}"></option>`).join('')}</datalist></label>
          <label>Meeting series<input name="series" placeholder="Optional, for recurring meetings" maxlength="250"></label>
          <label>Location<input name="location" placeholder="Optional" maxlength="2000"></label>
          <label>Event description<textarea name="description" rows="3" maxlength="100000" placeholder="Optional context for your agenda"></textarea></label>
          <p class="meeting-error" data-error role="alert" hidden></p>
          <footer class="meeting-actions"><span class="meeting-help">Adds a link to the meeting day's journal.</span><button type="submit" class="confirm-button is-primary" data-create>Create meeting note</button></footer>
        </form>
      </div>
    </div>`;
  document.body.append(dialog);
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const error = dialog.querySelector<HTMLElement>('[data-error]')!;
  const submit = dialog.querySelector<HTMLButtonElement>('[data-create]')!;
  const importer = dialog.querySelector<HTMLButtonElement>('[data-import]')!;
  const filter = dialog.querySelector<HTMLInputElement>('[data-filter]')!;
  const status = dialog.querySelector<HTMLElement>('[data-import-status]')!;
  const list = dialog.querySelector<HTMLElement>('[data-event-list]')!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
  let events: CalendarEvent[] = [];
  let selected: CalendarEvent | null = null;
  let busy = false;
  let closed = false;
  const close = () => { if (busy) return; closed = true; dialog.close(); dialog.remove(); restore?.focus({ preventScroll: true }); };
  const failure = (value: unknown) => { error.hidden = false; error.textContent = String(value); };
  const select = (event: CalendarEvent) => {
    selected = event;
    for (const name of ['title', 'day', 'time', 'timezone', 'location', 'description'] as const) field(name).value = event[name];
    field('attendees').value = event.attendees.join('\n');
    field('project').value = '';
    field('series').value = event.recurring ? `${event.title} series` : '';
    dialog.querySelector<HTMLElement>('[data-recurring]')!.hidden = !event.recurring;
    submit.textContent = event.existingNoteId ? 'Open existing meeting' : 'Create meeting note';
    error.hidden = true;
    render();
    field('title').focus();
  };
  const render = () => {
    const q = filter.value.trim().toLocaleLowerCase();
    const shown = events.filter(event => `${event.title} ${event.day} ${event.attendees.join(' ')}`.toLocaleLowerCase().includes(q));
    list.replaceChildren();
    for (const event of shown.slice(0, 100)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'meeting-event';
      button.classList.toggle('is-selected', event === selected);
      button.innerHTML = `<strong>${escape(event.title || 'Untitled event')}</strong><span>${escape(formatDay(event.day, 'short'))}${event.time ? ` · ${escape(event.time)}` : ' · All day'}</span>${event.existingNoteId ? '<small>Meeting note already exists</small>' : ''}`;
      button.addEventListener('click', () => { if (!busy) select(event); });
      list.append(button);
    }
    status.textContent = `${shown.length} matching event${shown.length === 1 ? '' : 's'}${shown.length > 100 ? ', showing the first 100. Filter to see more.' : '. Choose one to review.'}`;
  };
  importer.addEventListener('click', () => void (async () => {
    importer.disabled = true;
    error.hidden = true;
    try {
      const path = await open({ title: 'Import calendar events', filters: [{ name: 'iCalendar', extensions: ['ics'] }], multiple: false, directory: false });
      if (!path || typeof path !== 'string') return;
      const loaded = await invoke<CalendarEvent[]>('read_calendar_file', { path });
      if (closed) return;
      events = loaded; selected = null;
      form.reset();
      submit.textContent = 'Create meeting note';
      dialog.querySelector<HTMLElement>('[data-recurring]')!.hidden = true;
      filter.hidden = false; filter.value = ''; render();
    } catch (e) { if (!closed) failure(e); }
    finally { importer.disabled = false; }
  })());
  filter.addEventListener('input', render);
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    void (async () => {
      busy = true; submit.disabled = true; importer.disabled = true; error.hidden = true;
      try {
        if (selected?.existingNoteId) { await options.created(selected.existingNoteId); }
        else {
          await options.beforeSave();
          const result = await invoke<{ note: { id: string }; existed: boolean }>('create_meeting', { draft: {
            title: field('title').value, day: field('day').value, time: field('time').value,
            timezone: field('timezone').value, location: field('location').value, description: field('description').value,
            attendees: field('attendees').value.split('\n').map(s => s.trim()).filter(Boolean),
            project: field('project').value, series: field('series').value,
            calendarUid: selected?.uid ?? '', recurrenceId: selected?.recurrenceId ?? '',
          } });
          await options.created(result.note.id);
        }
        busy = false; close();
      } catch (e) { failure(e); }
      finally { busy = false; submit.disabled = false; importer.disabled = false; }
    })();
  });
  dialog.showModal();
  field('title').focus();
}
