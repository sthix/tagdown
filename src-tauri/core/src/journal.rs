// The journal: one note per day, in the spirit of Logseq's journals. A day's
// page is an ordinary note titled with its ISO date (`2026-10-13`, so
// `[[2026-10-13]]` links to it) and marked with a `journal:` frontmatter line.
// A note titled "Journal Template" supplies the body of each new day.

use chrono::{Days, NaiveDate};

use crate::{
    frontmatter::derive_title,
    links::normalize_title,
    models::Note,
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
}
