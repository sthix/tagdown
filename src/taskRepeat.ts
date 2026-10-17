// Repeating tasks, as tasks.rs handles them: ticking `- [ ] Water plants
// [[2026-10-20]] every:week` adds `- [ ] Water plants [[2026-10-27]] every:week`
// above it. A task without a day repeats from today. The open note is ticked
// here in the page; tasks in other notes are ticked by the vault.

const REPEAT = /(?:^|\s)every:(day|weekday|week|month|year)(?=\s|$)/i;
const DATE_LINK = /\[\[(\d{4}-\d{2}-\d{2})(?=[\]|])/;

function key(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The day a task repeating `every` comes back after `day` (both YYYY-MM-DD). */
export function nextDate(day: string, every: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  switch (every) {
    case 'day': date.setDate(d + 1); break;
    case 'weekday':
      do date.setDate(date.getDate() + 1); while (date.getDay() === 0 || date.getDay() === 6);
      break;
    case 'week': date.setDate(d + 7); break;
    default: {
      // A month or a year on; the 31st falls back to the month's last day.
      const months = every === 'month' ? 1 : 12;
      const target = new Date(y, m - 1 + months, 1, 12);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
      target.setDate(Math.min(d, last));
      return key(target);
    }
  }
  return key(date);
}

/**
 * The open task that follows the task line `line` once it's ticked, or null
 * when it doesn't repeat. `today` (YYYY-MM-DD) is where a task without a day
 * repeats from.
 */
export function nextTaskLine(line: string, today: string): string | null {
  const task = line.match(/^(\s*[-*+]\s+\[)[ xX](\]\s+)(.*)$/);
  if (!task) return null;
  const [, open, close, text] = task;
  const repeat = text.match(REPEAT);
  if (!repeat) return null;
  const date = text.match(DATE_LINK);
  const next = nextDate(date ? date[1] : today, repeat[1].toLowerCase());
  const moved = date ? text.replace(DATE_LINK, `[[${next}`) : `${text} [[${next}]]`;
  return `${open} ${close}${moved}`;
}
