// Checklist items (`- [ ]` / `- [x]`) in note bodies.

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
            tasks.push(Task { note_id: note.id.clone(), note_title: note.title.clone(), text: text.to_string(), done, line: i + 1 });
        }
    }
    tasks
}

/// `content` with the task on 1-based `line` ticked or unticked. The line
/// must still hold a task with `text`, so a stale view can't tick the wrong one.
pub fn set_task_done(content: &str, line: usize, text: &str, done: bool) -> Result<String, String> {
    let mut lines: Vec<&str> = content.split('\n').collect();
    let current = line.checked_sub(1).and_then(|i| lines.get(i)).copied().ok_or("that task no longer exists")?;
    let (prefix, _, current_text) = split_task(current).ok_or("that task no longer exists")?;
    if current_text != text.trim() {
        return Err("that task was changed; refresh and try again".into());
    }
    let rest = &current[prefix.len() + 1..]; // after the checkbox character
    let updated = format!("{prefix}{}{rest}", if done { 'x' } else { ' ' });
    lines[line - 1] = &updated;
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_the_right_line_only_while_it_matches() {
        let content = "# T\n\n- [ ] One\n  * [x] Two\n```\n- [ ] Code\n```\n";
        let note = Note { id: "n".into(), title: "T".into(), preview: String::new(), tags: vec![], starred: false, folder_id: None, created_at: Default::default(), updated_at: Default::default(), word_count: 0, journal: None, properties: Vec::new() };
        let tasks = parse_tasks(&note, content);
        assert_eq!(tasks.iter().map(|t| (t.line, t.text.as_str(), t.done)).collect::<Vec<_>>(), vec![(3, "One", false), (4, "Two", true)]);
        assert_eq!(set_task_done(content, 3, "One", true).unwrap(), content.replace("- [ ] One", "- [x] One"));
        assert_eq!(set_task_done(content, 4, "Two", false).unwrap(), content.replace("* [x] Two", "* [ ] Two"));
        assert!(set_task_done(content, 3, "Something else", true).is_err());
        assert!(set_task_done(content, 1, "T", true).is_err());
        assert!(set_task_done(content, 99, "One", true).is_err());
    }
}
