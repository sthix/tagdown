// Checklist items (`- [ ]` / `- [x]`) in note bodies. A task can say, in
// plain text anywhere on its line:
//
//   [[2026-10-20]]      its day: the first date link (the journal page's title)
//   !high !medium !low  its priority
//   every:week          that it repeats: every:day, weekday, week, month or year.
//                       Ticking it adds the next one, a step later, above it.

use chrono::{Datelike, Days, Local, Months, NaiveDate, Weekday};
use serde::Serialize;

use crate::models::Note;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskFilter {
    Open,
    Done,
    All,
}

impl TaskFilter {
    pub fn wants(self, done: bool) -> bool {
        match self {
            TaskFilter::Open => !done,
            TaskFilter::Done => done,
            TaskFilter::All => true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub note_id: String,
    pub note_title: String,
    pub text: String,
    pub done: bool,
    /// 1-based line in the note body.
    pub line: usize,
    /// The day it's for: its first `[[YYYY-MM-DD]]` link.
    pub date: Option<NaiveDate>,
    /// 1 high, 2 medium, 3 low.
    pub priority: Option<u8>,
    /// How often it repeats (`week`, from `every:week`).
    pub repeat: Option<String>,
    /// The text without its priority and repeat words, to show.
    pub label: String,
}

const REPEATS: [&str; 5] = ["day", "weekday", "week", "month", "year"];

/// A priority word: `!high` is 1, `!medium` 2, `!low` 3.
fn priority_of(word: &str) -> Option<u8> {
    match word.to_ascii_lowercase().as_str() {
        "!high" => Some(1),
        "!medium" => Some(2),
        "!low" => Some(3),
        _ => None,
    }
}

fn repeat_of(word: &str) -> Option<&'static str> {
    let unit = word.strip_prefix("every:")?;
    REPEATS.into_iter().find(|r| r.eq_ignore_ascii_case(unit))
}

/// The first `[[YYYY-MM-DD]]` (or `[[YYYY-MM-DD|label]]`) in `text`, with where it starts.
fn date_link(text: &str) -> Option<(usize, NaiveDate)> {
    let mut from = 0;
    while let Some(at) = text[from..].find("[[").map(|i| i + from) {
        if let Some(day) = text.get(at + 2..at + 12).and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()) {
            if matches!(text.get(at + 12..at + 13), Some("]" | "|")) {
                return Some((at, day));
            }
        }
        from = at + 2;
    }
    None
}

/// A task's date, priority, repeat and label, read from its text.
pub fn task_meta(text: &str) -> (Option<NaiveDate>, Option<u8>, Option<String>, String) {
    let date = date_link(text).map(|(_, d)| d);
    let mut priority = None;
    let mut repeat = None;
    let mut label = Vec::new();
    for word in text.split_whitespace() {
        if let Some(p) = priority_of(word) {
            priority = priority.or(Some(p));
        } else if let Some(r) = repeat_of(word) {
            repeat = repeat.or(Some(r.to_string()));
        } else {
            label.push(word);
        }
    }
    (date, priority, repeat, label.join(" "))
}

/// The day after `day` that a task repeating `every` comes back.
pub fn next_date(day: NaiveDate, every: &str) -> NaiveDate {
    match every {
        "day" => day + Days::new(1),
        "weekday" => {
            let mut next = day + Days::new(1);
            while matches!(next.weekday(), Weekday::Sat | Weekday::Sun) {
                next = next + Days::new(1);
            }
            next
        }
        "week" => day + Days::new(7),
        // The 31st repeats on the last day of shorter months.
        "month" => day.checked_add_months(Months::new(1)).unwrap_or(day),
        _ => day.checked_add_months(Months::new(12)).unwrap_or(day),
    }
}

/// The checkbox of a task line: (prefix up to and including `[`, done, text).
fn split_task(line: &str) -> Option<(&str, bool, &str)> {
    let indent = line.len() - line.trim_start().len();
    let rest = &line[indent..];
    let marker = ["- ", "* ", "+ "].into_iter().find(|m| rest.starts_with(m))?;
    let body = &rest[marker.len()..];
    let done = match body.get(..4)? {
        "[ ] " => false,
        "[x] " | "[X] " => true,
        _ => return None,
    };
    Some((&line[..indent + marker.len() + 1], done, body[4..].trim()))
}

/// Every task in a note, outside fenced code.
pub fn parse_tasks(note: &Note, content: &str) -> Vec<Task> {
    let mut tasks = Vec::new();
    let mut fence: Option<&str> = None;
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();
        if let Some(f) = ["```", "~~~"].into_iter().find(|f| trimmed.starts_with(f)) {
            fence = match fence { Some(open) if open == f => None, None => Some(f), other => other };
            continue;
        }
        if fence.is_some() {
            continue;
        }
        if let Some((_, done, text)) = split_task(line) {
            let (date, priority, repeat, label) = task_meta(text);
            tasks.push(Task { note_id: note.id.clone(), note_title: note.title.clone(), text: text.to_string(), done, line: i + 1, date, priority, repeat, label });
        }
    }
    tasks
}

/// `content` with the task on 1-based `line` ticked or unticked. The line
/// must still hold a task with `text`, so a stale view can't tick the wrong one.
/// Ticking a repeating task adds its next one above it.
pub fn set_task_done(content: &str, line: usize, text: &str, done: bool) -> Result<String, String> {
    set_task_done_at(content, line, text, done, Local::now().date_naive())
}

/// `set_task_done`, with `today` as the day a repeating task without a date repeats from.
pub fn set_task_done_at(content: &str, line: usize, text: &str, done: bool, today: NaiveDate) -> Result<String, String> {
    let mut lines: Vec<&str> = content.split('\n').collect();
    let current = line.checked_sub(1).and_then(|i| lines.get(i)).copied().ok_or("that task no longer exists")?;
    let (prefix, _, current_text) = split_task(current).ok_or("that task no longer exists")?;
    if current_text != text.trim() {
        return Err("that task was changed; refresh and try again".into());
    }
    let rest = &current[prefix.len() + 1..]; // after the checkbox character
    let was_done = current[prefix.len()..].starts_with(['x', 'X']);
    let updated = format!("{prefix}{}{rest}", if done { 'x' } else { ' ' });
    lines[line - 1] = &updated;
    let next = (done && !was_done).then(|| next_task(prefix, current_text, today)).flatten();
    if let Some(next) = &next {
        lines.insert(line - 1, next);
    }
    Ok(lines.join("\n"))
}

/// The open task that follows a repeating one: its date moved a step on (or,
/// without a date, a step after `today`). None when it doesn't repeat.
pub fn next_task(prefix: &str, text: &str, today: NaiveDate) -> Option<String> {
    let (date, _, repeat, _) = task_meta(text);
    let every = repeat?;
    let next = next_date(date.unwrap_or(today), &every).format("%Y-%m-%d").to_string();
    let text = match date_link(text) {
        Some((at, _)) => format!("{}{next}{}", &text[..at + 2], &text[at + 12..]),
        None => format!("{text} [[{next}]]"),
    };
    Some(format!("{prefix} ] {text}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_the_right_line_only_while_it_matches() {
        let content = "# T\n\n- [ ] One\n  * [x] Two\n```\n- [ ] Code\n```\n";
        let note = Note { id: "n".into(), title: "T".into(), preview: String::new(), tags: vec![], starred: false, folder_id: None, created_at: Default::default(), updated_at: Default::default(), word_count: 0, journal: None, properties: Vec::new(), path: String::new() };
        let tasks = parse_tasks(&note, content);
        assert_eq!(tasks.iter().map(|t| (t.line, t.text.as_str(), t.done)).collect::<Vec<_>>(), vec![(3, "One", false), (4, "Two", true)]);
        assert_eq!(set_task_done(content, 3, "One", true).unwrap(), content.replace("- [ ] One", "- [x] One"));
        assert_eq!(set_task_done(content, 4, "Two", false).unwrap(), content.replace("* [x] Two", "* [ ] Two"));
        assert!(set_task_done(content, 3, "Something else", true).is_err());
        assert!(set_task_done(content, 1, "T", true).is_err());
        assert!(set_task_done(content, 99, "One", true).is_err());
    }

    fn day(d: &str) -> NaiveDate {
        NaiveDate::parse_from_str(d, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn reads_dates_priorities_and_repeats() {
        assert_eq!(task_meta("Send recap [[2026-10-20]] !high every:Week"), (Some(day("2026-10-20")), Some(1), Some("week".into()), "Send recap [[2026-10-20]]".into()));
        assert_eq!(task_meta("Call [[Sam]] on [[2026-10-21|Wednesday]] !low"), (Some(day("2026-10-21")), Some(3), None, "Call [[Sam]] on [[2026-10-21|Wednesday]]".into()));
        assert_eq!(task_meta("Ship it! every:fortnight [[2026-13-01]]"), (None, None, None, "Ship it! every:fortnight [[2026-13-01]]".into()), "not a priority, repeat or day");
    }

    #[test]
    fn repeats_step_by_their_unit() {
        assert_eq!(next_date(day("2026-10-16"), "weekday"), day("2026-10-19"), "Friday to Monday");
        assert_eq!(next_date(day("2026-10-20"), "day"), day("2026-10-21"));
        assert_eq!(next_date(day("2026-10-20"), "week"), day("2026-10-27"));
        assert_eq!(next_date(day("2026-01-31"), "month"), day("2026-02-28"));
        assert_eq!(next_date(day("2028-02-29"), "year"), day("2029-02-28"));
    }

    #[test]
    fn ticking_a_repeating_task_adds_the_next_one_above() {
        let today = day("2026-10-17");
        let content = "# T\n\n- [ ] Water plants [[2026-10-20]] every:week\n  - [ ] Ferns\n- [ ] Stretch every:day\n";
        let ticked = set_task_done_at(content, 3, "Water plants [[2026-10-20]] every:week", true, today).unwrap();
        assert_eq!(ticked, "# T\n\n- [ ] Water plants [[2026-10-27]] every:week\n- [x] Water plants [[2026-10-20]] every:week\n  - [ ] Ferns\n- [ ] Stretch every:day\n");
        let ticked = set_task_done_at(content, 5, "Stretch every:day", true, today).unwrap();
        assert!(ticked.ends_with("- [ ] Stretch every:day [[2026-10-18]]\n- [x] Stretch every:day\n"), "without a date, from today: {ticked}");
        let again = set_task_done_at("- [x] Stretch every:day\n", 1, "Stretch every:day", true, today).unwrap();
        assert_eq!(again, "- [x] Stretch every:day\n", "an already done task doesn't repeat again");
        assert_eq!(set_task_done_at("- [x] Stretch every:day", 1, "Stretch every:day", false, today).unwrap(), "- [ ] Stretch every:day", "unticking adds nothing");
    }
}
