// The journal: one note per day, titled with its ISO date (`2026-10-13`), so
// `[[2026-10-13]]` links to that day. Days are local calendar days, written
// as `YYYY-MM-DD` keys.

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CalendarMonth = { year: number; month: number }; // month is 0-based

export function dayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey() {
  return dayKey(new Date());
}

/** The local date for a `YYYY-MM-DD` key, or null when it isn't a real day. */
export function parseDayKey(value: string): Date | null {
  const match = value.trim().match(DAY_KEY);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

export function isDayKey(value: string) {
  return parseDayKey(value) !== null;
}

export function shiftDay(key: string, days: number) {
  const date = parseDayKey(key) ?? new Date();
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

/** "Today", "Yesterday" or "Tomorrow" for days next to today. */
export function relativeDay(key: string): string | null {
  const today = todayKey();
  if (key === today) return 'Today';
  if (key === shiftDay(today, -1)) return 'Yesterday';
  if (key === shiftDay(today, 1)) return 'Tomorrow';
  return null;
}

/** "Tuesday, October 13", with the year when it isn't this year. */
export function formatDay(key: string, style: 'long' | 'short' = 'long') {
  const date = parseDayKey(key);
  if (!date) return key;
  const otherYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleDateString(undefined, style === 'long'
    ? { weekday: 'long', month: 'long', day: 'numeric', year: otherYear ? 'numeric' : undefined }
    : { weekday: 'short', month: 'short', day: 'numeric', year: otherYear ? 'numeric' : undefined });
}

export function monthOf(key: string): CalendarMonth {
  const date = parseDayKey(key) ?? new Date();
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function shiftMonth({ year, month }: CalendarMonth, by: number): CalendarMonth {
  const date = new Date(year, month + by, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/**
 * A month grid, weeks starting on the locale's usual first day where the
 * browser knows it (Monday otherwise). Days with a page get a dot; buttons
 * carry `data-day` / `data-month-shift` for the caller to bind.
 */
export function calendarHtml(shown: CalendarMonth, withPages: Set<string>, selected: string | null) {
  const first = new Date(shown.year, shown.month, 1);
  const weekStart = localeWeekStart();
  const lead = (first.getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(shown.year, shown.month + 1, 0).getDate();
  const today = todayKey();
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((weekStart + i) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }));
  const cells: string[] = Array.from({ length: lead }, () => '<span class="journal-cal-pad"></span>');
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dayKey(new Date(shown.year, shown.month, day));
    const classes = ['journal-cal-day', key === today ? 'is-today' : '', key === selected ? 'is-selected' : '', withPages.has(key) ? 'has-page' : ''].filter(Boolean).join(' ');
    cells.push(`<button type="button" class="${classes}" data-day="${key}" aria-label="${formatDay(key)}${withPages.has(key) ? ', has a page' : ''}"${key === selected ? ' aria-current="date"' : ''}>${day}</button>`);
  }
  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `
    <div class="journal-cal" role="group" aria-label="Journal calendar">
      <div class="journal-cal-head">
        <button type="button" class="journal-cal-nav" data-month-shift="-1" title="Previous month" aria-label="Previous month"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg></button>
        <strong>${title}</strong>
        <button type="button" class="journal-cal-nav" data-month-shift="1" title="Next month" aria-label="Next month"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg></button>
      </div>
      <div class="journal-cal-grid">
        ${names.map((name) => `<span class="journal-cal-weekday" aria-hidden="true">${name}</span>`).join('')}
        ${cells.join('')}
      </div>
    </div>`;
}

function localeWeekStart() {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    if (firstDay) return firstDay % 7; // 1 = Monday … 7 = Sunday
  } catch {
    // Older engines: fall through.
  }
  return 1;
}
