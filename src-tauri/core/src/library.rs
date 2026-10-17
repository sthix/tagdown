// Note operations for tools outside the app: the `tagdown` CLI and the MCP
// server. Notes are addressed by id or by title, the way people (and AI
// assistants) refer to them. Writes go through the vault, so the version
// history keeps what they replace and a running app picks them up.

use std::{
    path::PathBuf,
    time::SystemTime,
};

use chrono::{Days, Local, NaiveDate, Utc};
use serde::Serialize;

pub use crate::tasks::{Task, TaskFilter};
use crate::{
    frontmatter::derive_tags,
    journal::{journal_title, parse_day},
    tasks::parse_tasks,
    links::{self, normalize_title, Backlink},
    models::{Note, SearchResult, SortOrder},
    search_index::SearchIndex,
    vault::Vault,
};

pub const SYNTAX: &str = include_str!("syntax.md");
const ARCHIVE: &str = "archive";

pub struct Library {
    pub vault: Vault,
    search: SearchIndex,
    /// What the search index was built from; rebuilt when the files change.
    indexed: Option<Vec<(PathBuf, SystemTime)>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteView {
    pub note: Note,
    pub folder: Option<String>,
    pub content: String,
    /// Titles of notes that link here.
    pub linked_from: Vec<String>,
}

impl Library {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        Ok(Self { vault: Vault::open_existing(root)?, search: SearchIndex::in_memory()?, indexed: None })
    }

    fn live_notes(&self) -> Result<Vec<(Note, String)>, String> {
        Ok(self.vault.notes_with_content()?.into_iter().filter(|(n, _)| n.folder_id.as_deref() != Some(ARCHIVE)).collect())
    }

    /// Find a note by id, by title (ignoring case), or by its file as a wikilink
    /// names it. Archived notes only match by id.
    pub fn resolve(&self, reference: &str) -> Result<(Note, String), String> {
        let reference = reference.trim();
        let notes = self.vault.notes_with_content()?;
        if let Some(found) = notes.iter().find(|(n, _)| n.id == reference) {
            return Ok(found.clone());
        }
        let wanted = normalize_title(reference);
        let live = notes.into_iter().filter(|(n, _)| n.folder_id.as_deref() != Some(ARCHIVE));
        let (exact, rest): (Vec<_>, Vec<_>) = live.partition(|(n, _)| normalize_title(&n.title) == wanted);
        if exact.is_empty() {
            // A file in the vault, the way a wikilink can name a note: `blog/post`.
            let by_file = links::LinkTargets::new(rest.iter().map(|(n, _)| n)).by_file(reference).map(str::to_string);
            if let Some(found) = by_file.and_then(|id| rest.iter().find(|(n, _)| n.id == id)) {
                return Ok(found.clone());
            }
        }
        match exact.len() {
            1 => Ok(exact.into_iter().next().unwrap()),
            0 => {
                let similar: Vec<String> = rest
                    .iter()
                    .filter(|(n, _)| normalize_title(&n.title).contains(&wanted))
                    .take(5)
                    .map(|(n, _)| format!("\"{}\"", n.title))
                    .collect();
                Err(if similar.is_empty() {
                    format!("no note titled \"{reference}\"")
                } else {
                    format!("no note titled \"{reference}\"; similar titles: {}", similar.join(", "))
                })
            }
            _ => Err(format!("several notes are titled \"{reference}\"; use the note id instead")),
        }
    }

    pub fn folder_name(&self, id: Option<&str>) -> Option<String> {
        let id = id?;
        self.vault.meta.folders.iter().find(|f| f.id == id).map(|f| f.name.clone())
    }

    fn folder_id(&self, name: &str) -> Result<String, String> {
        let wanted = name.trim().to_lowercase();
        self.vault
            .meta
            .folders
            .iter()
            .find(|f| f.name.to_lowercase() == wanted || f.id == name)
            .map(|f| f.id.clone())
            .ok_or_else(|| {
                let names: Vec<&str> = self.vault.meta.folders.iter().map(|f| f.name.as_str()).collect();
                format!("no folder named \"{name}\"; folders: {}", names.join(", "))
            })
    }

    pub fn folders(&self) -> Vec<String> {
        self.vault.meta.folders.iter().filter(|f| f.id != ARCHIVE).map(|f| f.name.clone()).collect()
    }

    /// Full-text search with the app's query syntax (`tag:`, `title:`, "phrases", `-word`).
    pub fn search(&mut self, query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
        self.refresh_index()?;
        let mut results = self.search.search(query)?;
        results.truncate(limit);
        Ok(results)
    }

    fn refresh_index(&mut self) -> Result<(), String> {
        let mut stamp: Vec<(PathBuf, SystemTime)> = self
            .vault
            .note_paths()
            .into_iter()
            .map(|p| {
                let modified = p.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
                (p, modified)
            })
            .collect();
        stamp.sort();
        if self.indexed.as_ref() != Some(&stamp) {
            self.search.rebuild(self.vault.notes_with_content()?)?;
            self.indexed = Some(stamp);
        }
        Ok(())
    }

    pub fn read(&self, reference: &str) -> Result<NoteView, String> {
        let (note, content) = self.resolve(reference)?;
        let linked_from = links::backlinks(self.vault.notes_with_content()?, &note.id).into_iter().map(|b| b.note.title).collect();
        Ok(NoteView { folder: self.folder_name(note.folder_id.as_deref()), note, content, linked_from })
    }

    /// Notes, most recently edited first, optionally in one folder or under one tag.
    pub fn list(&self, folder: Option<&str>, tag: Option<&str>, limit: usize) -> Result<Vec<Note>, String> {
        let folder_id = folder.map(|name| self.folder_id(name)).transpose()?;
        let tag = tag.map(|t| t.trim_start_matches('#').to_lowercase());
        let notes = self.vault.list_notes(folder_id.clone(), SortOrder::UpdatedDesc)?;
        Ok(notes
            .into_iter()
            .filter(|n| folder_id.is_some() || n.folder_id.as_deref() != Some(ARCHIVE))
            .filter(|n| tag.as_ref().is_none_or(|t| n.tags.iter().any(|nt| nt == t || nt.starts_with(&format!("{t}/")))))
            .take(limit)
            .collect())
    }

    /// Create a note. `body` is everything after the title heading; when it
    /// already starts with a `# ` heading, that heading is the title.
    pub fn create(&self, title: &str, body: &str, folder: Option<&str>, tags: &[String]) -> Result<Note, String> {
        self.create_typed(title, body, folder, tags, None)
    }

    /// `create`, as a note of a type (see `types.rs`): it starts with the
    /// type's properties, and with its template's body unless `body` is given.
    pub fn create_typed(&self, title: &str, body: &str, folder: Option<&str>, tags: &[String], note_type: Option<&str>) -> Result<Note, String> {
        let folder_id = folder.map(|name| self.folder_id(name)).transpose()?;
        let body = body.trim();
        let typed = note_type.filter(|t| !t.trim().is_empty()).map(|t| self.vault.create_typed_note(t, title, folder_id.clone())).transpose()?;
        let mut content = match &typed {
            Some(note) if body.is_empty() => self.vault.get_note_content(&note.id)?.content,
            _ if body.starts_with("# ") => body.to_string(),
            _ => format!("# {}\n\n{body}", title.trim()),
        };
        let missing: Vec<String> = tags
            .iter()
            .map(|t| t.trim().trim_start_matches('#').to_string())
            .filter(|t| !t.is_empty() && !derive_tags(&content).contains(&t.to_lowercase()))
            .map(|t| format!("#{t}"))
            .collect();
        if !missing.is_empty() {
            content = format!("{}\n\n{}", content.trim_end(), missing.join(" "));
        }
        let note = match typed {
            Some(note) => note,
            None => self.vault.create_note(folder_id)?,
        };
        self.vault.save_note(&note.id, format!("{}\n", content.trim_end()))
    }

    pub fn types(&self) -> Result<Vec<crate::types::NoteType>, String> {
        self.vault.note_types()
    }

    pub fn append(&self, reference: &str, text: &str) -> Result<Note, String> {
        let (note, content) = self.resolve(reference)?;
        self.vault.save_note(&note.id, crate::journal::append_block(&content, text))
    }

    /// Replace a note's whole body. The previous body is always kept in the
    /// version history first.
    pub fn replace(&self, reference: &str, content: &str) -> Result<Note, String> {
        let (note, previous) = self.resolve(reference)?;
        self.vault.history.snapshot(&note.id, &previous, Utc::now())?;
        self.vault.save_note(&note.id, format!("{}\n", content.trim_end()))
    }

    /// A day's journal page and its body, if it has one.
    pub fn journal(&self, day: NaiveDate) -> Result<Option<(Note, String)>, String> {
        let Some(note) = self.vault.find_journal(day)? else { return Ok(None) };
        let content = self.vault.get_note_content(&note.id)?.content;
        Ok(Some((note, content)))
    }

    /// Add text to the end of a day's journal page, creating the page first if needed.
    pub fn append_to_journal(&self, day: NaiveDate, text: &str) -> Result<Note, String> {
        self.vault.append_to_journal(day, text).map(|(note, _)| note)
    }

    /// Run a query-block query (see `query.rs`) over the whole vault.
    pub fn query(&mut self, raw: &str) -> Result<crate::query::QueryOutput, String> {
        self.refresh_index()?;
        crate::query::run(raw, self.vault.notes_with_content()?, Some(&self.search), &self.vault.meta.folders, None)
    }

    pub fn backlinks(&self, reference: &str) -> Result<Vec<Backlink>, String> {
        let (note, _) = self.resolve(reference)?;
        Ok(links::backlinks(self.vault.notes_with_content()?, &note.id))
    }

    /// Checklist items (`- [ ]` / `- [x]`) across notes, outside code blocks.
    pub fn tasks(&self, filter: TaskFilter, tag: Option<&str>) -> Result<Vec<Task>, String> {
        let tag = tag.map(|t| t.trim_start_matches('#').to_lowercase());
        let mut notes = self.live_notes()?;
        notes.sort_by(|a, b| b.0.updated_at.cmp(&a.0.updated_at));
        let mut tasks = Vec::new();
        for (note, content) in notes {
            if tag.as_ref().is_some_and(|t| !note.tags.iter().any(|nt| nt == t || nt.starts_with(&format!("{t}/")))) {
                continue;
            }
            tasks.extend(parse_tasks(&note, &content).into_iter().filter(|t| filter.wants(t.done)));
        }
        Ok(tasks)
    }
}

/// A day as people name it: `YYYY-MM-DD`, `today`, `yesterday` or `tomorrow`
/// (in local time). Nothing means today.
pub fn resolve_day(value: Option<&str>) -> Result<NaiveDate, String> {
    let today = Local::now().date_naive();
    match value.map(|v| v.trim().to_lowercase()).as_deref() {
        None | Some("") | Some("today") => Ok(today),
        Some("yesterday") => today.checked_sub_days(Days::new(1)).ok_or_else(|| "date out of range".into()),
        Some("tomorrow") => today.checked_add_days(Days::new(1)).ok_or_else(|| "date out of range".into()),
        Some(other) => parse_day(other).ok_or_else(|| format!("{other:?} is not a day; use YYYY-MM-DD, today, yesterday or tomorrow")),
    }
}

/// The title of a day's journal page, for messages.
pub fn day_title(day: NaiveDate) -> String {
    journal_title(day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> (Library, PathBuf) {
        let root = std::env::temp_dir().join(format!("tagdown-library-{}", uuid::Uuid::new_v4()));
        Vault::open_or_create(root.clone()).unwrap();
        (Library::open(root.clone()).unwrap(), root)
    }

    #[test]
    fn refuses_to_open_a_folder_that_is_not_a_vault() {
        let missing = std::env::temp_dir().join(format!("tagdown-none-{}", uuid::Uuid::new_v4()));
        assert!(Library::open(missing.clone()).is_err());
        assert!(!missing.exists(), "nothing is created");
    }

    #[test]
    fn creates_reads_appends_and_replaces_by_title() {
        let (lib, root) = library();
        let note = lib.create("Trip plan", "Pack [[Your First Note|light]].", None, &["travel".into()]).unwrap();
        assert_eq!(note.title, "Trip plan");
        assert_eq!(note.tags, vec!["travel"]);

        lib.append("trip PLAN", "- [ ] Book train").unwrap();
        let view = lib.read(&note.id).unwrap();
        assert!(view.content.ends_with("- [ ] Book train\n"));
        assert_eq!(lib.read("Your First Note").unwrap().linked_from, vec!["Trip plan"]);

        lib.replace("Trip plan", "# Trip plan\n\nRewritten.").unwrap();
        assert_eq!(lib.read("Trip plan").unwrap().content, "# Trip plan\n\nRewritten.\n");
        let versions = lib.vault.history.list(&note.id).unwrap();
        assert!(lib.vault.history.read(&note.id, &versions[0].id).unwrap().contains("Book train"), "replaced body is kept");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn unknown_titles_suggest_similar_ones() {
        let (lib, root) = library();
        let err = lib.read("Tagdown").unwrap_err();
        assert!(err.contains("\"Welcome to Tagdown\""), "{err}");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn search_sees_notes_written_after_the_first_search() {
        let (mut lib, root) = library();
        assert!(lib.search("zeppelin", 10).unwrap().is_empty());
        lib.create("Airships", "A zeppelin floats.", None, &[]).unwrap();
        assert_eq!(lib.search("zeppelin", 10).unwrap()[0].note.title, "Airships");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn appends_to_a_journal_day() {
        let (lib, root) = library();
        let day = resolve_day(Some("2026-10-13")).unwrap();
        assert!(lib.journal(day).unwrap().is_none());
        lib.append_to_journal(day, "- Met [[Trip plan]] people").unwrap();
        lib.append_to_journal(day, "- Lunch").unwrap();
        let (note, content) = lib.journal(day).unwrap().unwrap();
        assert_eq!(note.title, "2026-10-13");
        assert_eq!(content, "# 2026-10-13\n\n- Met [[Trip plan]] people\n- Lunch\n");
        assert!(resolve_day(Some("someday")).is_err());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn lists_tasks_outside_code() {
        let (lib, root) = library();
        lib.create("Chores", "- [ ] Water plants\n- [x] Laundry\n```\n- [ ] not a task\n```\n#home", None, &[]).unwrap();
        let open = lib.tasks(TaskFilter::Open, None).unwrap();
        assert_eq!(open.iter().map(|t| t.text.as_str()).collect::<Vec<_>>(), vec!["Water plants"]);
        assert_eq!(open[0].line, 3);
        assert_eq!(lib.tasks(TaskFilter::All, Some("home")).unwrap().len(), 2);
        assert!(lib.tasks(TaskFilter::All, Some("work")).unwrap().is_empty());
        std::fs::remove_dir_all(root).ok();
    }
}
