// The journal: one note per day, in the spirit of Logseq's journals. A day's
// page is an ordinary note titled with its ISO date (`2026-10-13`, so
// `[[2026-10-13]]` links to it) and marked with a `journal:` frontmatter line.
// A note titled "Journal Template" supplies the body of each new day.

use chrono::{Days, NaiveDate, TimeZone};
use serde::Serialize;

use crate::{
    frontmatter::derive_title,
    links::normalize_title,
    models::Note,
    properties::PropertyValue,
    tasks::{parse_tasks, Task},
    vault::Vault,
};

pub const TEMPLATE_TITLE: &str = "Journal Template";
const ARCHIVE: &str = "archive";

/// The title of a day's journal page.
pub fn journal_title(day: NaiveDate) -> String {
    day.format("%Y-%m-%d").to_string()
}

/// A day written as `YYYY-MM-DD`.
pub fn parse_day(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok()
}

impl Vault {
    /// The journal page for `day`, if there is one outside the Archive. A note
    /// titled with the date but not yet marked as a journal page (say, a daily
    /// note brought over from another app) becomes that day's page.
    pub fn find_journal(&self, day: NaiveDate) -> Result<Option<Note>, String> {
        let live: Vec<Note> = self.notes_with_content()?.into_iter().map(|(n, _)| n).filter(|n| n.folder_id.as_deref() != Some(ARCHIVE)).collect();
        if let Some(note) = live.iter().find(|n| n.journal == Some(day)) {
            return Ok(Some(note.clone()));
        }
        let title = journal_title(day);
        match live.iter().find(|n| n.journal.is_none() && n.title == title) {
            Some(note) => self.set_journal(&note.id, Some(day)).map(Some),
            None => Ok(None),
        }
    }

    /// The journal page for `day`, created from the template when it doesn't
    /// exist yet. Also says whether it was just created.
    pub fn open_journal(&self, day: NaiveDate) -> Result<(Note, bool), String> {
        if let Some(note) = self.find_journal(day)? {
            return Ok((note, false));
        }
        let body = self.journal_template()?.map(|t| fill_template(&t, day)).unwrap_or_default();
        let content = format!("# {}\n\n{}", journal_title(day), body.trim());
        let note = self.create_note_with(None, &format!("{}\n", content.trim_end()), Some(day), &[])?;
        Ok((note, true))
    }

    /// Add text to the end of a day's page, starting the page first if needed.
    pub fn append_to_journal(&self, day: NaiveDate, text: &str) -> Result<(Note, String), String> {
        let (note, _) = self.open_journal(day)?;
        let next = append_block(&self.get_note_content(&note.id)?.content, text);
        Ok((self.save_note(&note.id, next.clone())?, next))
    }

    /// The body of the "Journal Template" note, without its title heading.
    fn journal_template(&self) -> Result<Option<String>, String> {
        let wanted = normalize_title(TEMPLATE_TITLE);
        let template = self
            .notes_with_content()?
            .into_iter()
            .find(|(n, _)| n.folder_id.as_deref() != Some(ARCHIVE) && normalize_title(&n.title) == wanted);
        Ok(template.map(|(_, content)| strip_title(&content)))
    }
}

/// A list item (`- `, `* `, `+ `, `1. `), tasks included.
fn is_list_item(line: &str) -> bool {
    let line = line.trim_start();
    line.starts_with(['-', '*', '+']) && line[1..].starts_with(' ')
        || line.split_once(". ").is_some_and(|(n, _)| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// `content` with `text` added at the end as its own block. A list item
/// following a list item joins that list instead of starting a new one, so
/// captures in a row stay one tight list.
pub fn append_block(content: &str, text: &str) -> String {
    let (content, text) = (content.trim_end(), text.trim());
    let last = content.lines().next_back().unwrap_or_default();
    let gap = if is_list_item(last) && text.lines().next().is_some_and(is_list_item) { "\n" } else { "\n\n" };
    format!("{content}{gap}{text}\n")
}

/// Everything after a note's `# ` title line.
pub(crate) fn strip_title(content: &str) -> String {
    let title = derive_title(content);
    let mut lines = content.lines();
    let mut rest = Vec::new();
    for line in lines.by_ref() {
        if line.strip_prefix("# ").map(str::trim) == Some(title.as_str()) {
            break;
        }
        rest.push(line);
    }
    rest.extend(lines);
    rest.join("\n").trim().to_string()
}

/// Fill in a template's placeholders for `day`: `{{date}}`, `{{yesterday}}`,
/// `{{tomorrow}}` (as ISO dates, so `[[{{yesterday}}]]` links to that page)
/// and `{{weekday}}`.
pub fn fill_template(template: &str, day: NaiveDate) -> String {
    let shift = |d: Option<NaiveDate>| d.map(journal_title).unwrap_or_default();
    template
        .replace("{{date}}", &journal_title(day))
        .replace("{{yesterday}}", &shift(day.checked_sub_days(Days::new(1))))
        .replace("{{tomorrow}}", &shift(day.checked_add_days(Days::new(1))))
        .replace("{{weekday}}", &day.format("%A").to_string())
}

/// A note with date properties set to the day.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatedNote {
    pub note: Note,
    /// The properties holding the day (`due`, `meeting`).
    pub keys: Vec<String>,
}

/// What happened on a day, for its journal page.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaySummary {
    /// Notes created that day, earliest first.
    pub created: Vec<Note>,
    /// Notes last edited that day (and created before it), earliest first.
    pub edited: Vec<Note>,
    /// Notes with a date property set to the day.
    pub dated: Vec<DatedNote>,
    /// Open tasks for the day, by priority.
    pub tasks: Vec<Task>,
}

/// The notes and open tasks of `day` among `notes`, leaving out the day's own
/// page `page_id` and archived notes. Times are read in `tz`, the user's.
pub fn day_summary<Tz: TimeZone>(notes: Vec<(Note, String)>, day: NaiveDate, page_id: &str, tz: &Tz) -> DaySummary {
    let on_day = |at: &chrono::DateTime<chrono::Utc>| at.with_timezone(tz).date_naive() == day;
    let mut summary = DaySummary::default();
    for (note, content) in notes {
        if note.id == page_id || note.folder_id.as_deref() == Some(ARCHIVE) {
            continue;
        }
        summary.tasks.extend(parse_tasks(&note, &content).into_iter().filter(|t| !t.done && t.date == Some(day)));
        let keys: Vec<String> = note.properties.iter().filter(|p| p.value == PropertyValue::Date(day)).map(|p| p.key.clone()).collect();
        if !keys.is_empty() {
            summary.dated.push(DatedNote { note: note.clone(), keys });
        }
        if on_day(&note.created_at) {
            summary.created.push(note);
        } else if on_day(&note.updated_at) {
            summary.edited.push(note);
        }
    }
    summary.created.sort_by_key(|n| n.created_at);
    summary.edited.sort_by_key(|n| n.updated_at);
    summary.dated.sort_by_key(|d| normalize_title(&d.note.title));
    summary.tasks.sort_by(|a, b| (a.priority.unwrap_or(4), &a.note_title, a.line).cmp(&(b.priority.unwrap_or(4), &b.note_title, b.line)));
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (Vault, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("tagdown-journal-{}", uuid::Uuid::new_v4()));
        (Vault::open_or_create(root.clone()).unwrap(), root)
    }

    fn day(value: &str) -> NaiveDate {
        parse_day(value).unwrap()
    }

    #[test]
    fn opening_a_day_creates_its_page_once() {
        let (vault, root) = vault();
        let (note, created) = vault.open_journal(day("2026-10-13")).unwrap();
        assert!(created);
        assert_eq!(note.title, "2026-10-13");
        assert_eq!(note.journal, Some(day("2026-10-13")));
        assert_eq!(vault.get_note_content(&note.id).unwrap().content, "# 2026-10-13\n");

        let (again, created) = vault.open_journal(day("2026-10-13")).unwrap();
        assert!(!created);
        assert_eq!(again.id, note.id);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn new_days_start_from_the_template() {
        let (vault, root) = vault();
        let template = vault.create_note(None).unwrap();
        vault.save_note(&template.id, "# Journal Template\n\n## {{weekday}}\n\n- [ ] Review [[{{yesterday}}]]\n".into()).unwrap();
        let (note, _) = vault.open_journal(day("2026-10-13")).unwrap();
        assert_eq!(
            vault.get_note_content(&note.id).unwrap().content,
            "# 2026-10-13\n\n## Tuesday\n\n- [ ] Review [[2026-10-12]]\n"
        );
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_note_titled_with_the_date_becomes_that_days_page() {
        let (vault, root) = vault();
        let plain = vault.create_note(None).unwrap();
        vault.save_note(&plain.id, "# 2026-10-13\n\nImported.".into()).unwrap();
        let (note, created) = vault.open_journal(day("2026-10-13")).unwrap();
        assert!(!created);
        assert_eq!(note.id, plain.id);
        assert_eq!(note.journal, Some(day("2026-10-13")));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn archived_pages_are_replaced_and_journal_lists_only_days() {
        let (vault, root) = vault();
        let (old, _) = vault.open_journal(day("2026-10-13")).unwrap();
        vault.delete_note(&old.id).unwrap();
        let (fresh, created) = vault.open_journal(day("2026-10-13")).unwrap();
        assert!(created);
        assert_ne!(fresh.id, old.id);
        let listed = vault.list_notes(Some("journal".into()), crate::models::SortOrder::UpdatedDesc).unwrap();
        assert_eq!(listed.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), vec![fresh.id.as_str()]);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn appended_list_items_join_the_list() {
        assert_eq!(append_block("# Day\n\n- [ ] One\n", "- [ ] Two"), "# Day\n\n- [ ] One\n- [ ] Two\n");
        assert_eq!(append_block("# Day\n\n1. One", "2. Two"), "# Day\n\n1. One\n2. Two\n");
        assert_eq!(append_block("# Day\n\n- One\n", "A thought"), "# Day\n\n- One\n\nA thought\n");
        assert_eq!(append_block("# Day\n\nA thought", "- One"), "# Day\n\nA thought\n\n- One\n");
        assert_eq!(append_block("# Day\n\n---", "-1 degrees"), "# Day\n\n---\n\n-1 degrees\n", "a rule is no list");
    }

    #[test]
    fn appending_to_a_day_starts_its_page() {
        let (vault, root) = vault();
        vault.append_to_journal(day("2026-10-13"), "- Call Sam").unwrap();
        let (note, content) = vault.append_to_journal(day("2026-10-13"), "- Book flights").unwrap();
        assert_eq!(note.journal, Some(day("2026-10-13")));
        assert_eq!(content, "# 2026-10-13\n\n- Call Sam\n- Book flights\n");
        assert_eq!(vault.get_note_content(&note.id).unwrap().content, content);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_day_collects_its_notes_and_open_tasks() {
        use chrono::{FixedOffset, Utc};
        let at = |value: &str| chrono::DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc);
        let note = |id: &str, created: &str, updated: &str| Note {
            id: id.into(), title: id.into(), preview: String::new(), tags: vec![], starred: false, folder_id: None,
            created_at: at(created), updated_at: at(updated), word_count: 0, journal: None, properties: Vec::new(), path: String::new(),
        };
        let mut meeting = note("Kickoff", "2026-09-01T10:00:00Z", "2026-09-01T10:00:00Z");
        meeting.properties = crate::properties::parse_properties(&["date: 2026-10-13".into(), "follow_up: 2026-10-14".into()]);
        let mut archived = note("Old", "2026-10-13T09:00:00Z", "2026-10-13T09:00:00Z");
        archived.folder_id = Some("archive".into());
        let notes = vec![
            (note("Page", "2026-10-13T06:00:00Z", "2026-10-13T20:00:00Z"), "- [ ] Mine [[2026-10-13]]".into()),
            (note("Later", "2026-10-13T15:00:00Z", "2026-10-14T08:00:00Z"), String::new()),
            (note("Early", "2026-10-13T07:00:00Z", "2026-10-13T07:30:00Z"), String::new()),
            (note("Touched", "2026-10-01T07:00:00Z", "2026-10-13T12:00:00Z"), "- [ ] Call [[2026-10-13]]\n- [ ] Ship [[2026-10-13]] !high\n- [x] Done [[2026-10-13]]\n- [ ] Next [[2026-10-14]]".into()),
            // 23:30 in UTC is already the next day two hours east.
            (note("Late night", "2026-10-12T23:30:00Z", "2026-10-12T23:30:00Z"), String::new()),
            (meeting, String::new()),
            (archived, "- [ ] Archived [[2026-10-13]]".into()),
        ];
        let summary = day_summary(notes, day("2026-10-13"), "Page", &FixedOffset::east_opt(2 * 3600).unwrap());
        let ids = |list: &[Note]| list.iter().map(|n| n.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&summary.created), vec!["Late night", "Early", "Later"], "the page itself and archived notes are left out");
        assert_eq!(ids(&summary.edited), vec!["Touched"]);
        assert_eq!(summary.dated.iter().map(|d| (d.note.id.as_str(), d.keys.clone())).collect::<Vec<_>>(), vec![("Kickoff", vec!["date".to_string()])]);
        assert_eq!(summary.tasks.iter().map(|t| t.text.as_str()).collect::<Vec<_>>(), vec!["Ship [[2026-10-13]] !high", "Call [[2026-10-13]]"]);
    }
}
