use std::{fs, path::{Path, PathBuf}, sync::Arc};

use chrono::{NaiveDate, Utc};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    history::History,
    frontmatter::{derive_preview, derive_tags, derive_title, split_frontmatter, word_count, write_frontmatter},
    models::{FolderRecord, Note, NoteContent, NoteFrontmatter, SortOrder, VaultMeta},
    watcher::FileTracker,
};

const NOTE_EXT: &str = "md";
const LEGACY_NOTE_EXT: &str = "td";

#[derive(Debug, Clone)]
pub struct Vault {
    pub root: PathBuf,
    pub meta: VaultMeta,
    /// Shared by every clone, so the file watcher can tell the app's own writes apart.
    pub tracker: Arc<FileTracker>,
    pub history: History,
}

impl Vault {
    pub fn open_or_create_default() -> Result<Self, String> {
        Self::open_or_create(Self::default_root()?)
    }

    /// The vault the app uses: `~/Documents/Tagdown`.
    pub fn default_root() -> Result<PathBuf, String> {
        let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
        Ok(PathBuf::from(home).join("Documents").join("Tagdown"))
    }

    /// Open a vault that already exists, without creating or seeding anything.
    pub fn open_existing(root: PathBuf) -> Result<Self, String> {
        if !root.join(".tagdown").join("vault.json").is_file() {
            return Err(format!("no Tagdown vault at {}", root.display()));
        }
        Self::open_or_create(root)
    }

    pub fn open_or_create(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join(".tagdown")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("Archive")).map_err(|e| e.to_string())?;
        Self::migrate_legacy_notes(&root)?;
        let meta_path = root.join(".tagdown").join("vault.json");
        let meta = if meta_path.exists() {
            serde_json::from_str(&fs::read_to_string(&meta_path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?
        } else {
            let meta = VaultMeta {
                version: 1,
                name: "My Notes".into(),
                created: Utc::now(),
                folders: vec![FolderRecord {
                    id: "archive".into(),
                    name: "Archive".into(),
                    parent_id: None,
                    sort_order: u32::MAX,
                    icon: Some("archive".into()),
                }],
                tags: Vec::new(),
            };
            fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap()).map_err(|e| e.to_string())?;
            Self::seed_notes(&root)?;
            meta
        };
        let history = History::new(&root);
        Ok(Self { root, meta, tracker: Arc::default(), history })
    }

    pub fn save_meta(&self) -> Result<(), String> {
        let path = self.root.join(".tagdown").join("vault.json");
        fs::write(path, serde_json::to_string_pretty(&self.meta).unwrap()).map_err(|e| e.to_string())
    }

    pub fn list_notes(&self, folder_id: Option<String>, sort: SortOrder) -> Result<Vec<Note>, String> {
        let mut notes = Vec::new();
        for path in self.note_paths() {
            let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let Ok((meta, content)) = split_frontmatter(&raw) else { continue; };
            // `starred` and `journal` are views across folders rather than folders.
            let wanted = match folder_id.as_deref() {
                None => true,
                Some("starred") => meta.starred,
                Some("journal") => meta.journal.is_some() && meta.folder_id.as_deref() != Some("archive"),
                Some(folder) => meta.folder_id.as_deref() == Some(folder),
            };
            if !wanted { continue; }
            notes.push(note_from_meta(meta, &content));
        }
        sort_notes(&mut notes, sort);
        Ok(notes)
    }

    /// Every note with its body, for building the search index.
    pub fn notes_with_content(&self) -> Result<Vec<(Note, String)>, String> {
        let mut notes = Vec::new();
        for path in self.note_paths() {
            let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let Ok((meta, content)) = split_frontmatter(&raw) else { continue; };
            let note = note_from_meta(meta, &content);
            notes.push((note, content));
        }
        Ok(notes)
    }

    pub fn get_note_content(&self, id: &str) -> Result<NoteContent, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let (_, content) = split_frontmatter(&raw)?;
        Ok(NoteContent { id: id.into(), content })
    }

    pub fn create_note(&self, folder_id: Option<String>) -> Result<Note, String> {
        self.create_note_with(folder_id, "# Untitled\n", None)
    }

    /// Create a note with `content` as its body, optionally as the journal page for a day.
    pub(crate) fn create_note_with(&self, folder_id: Option<String>, content: &str, journal: Option<NaiveDate>) -> Result<Note, String> {
        let now = Utc::now();
        let meta = NoteFrontmatter {
            id: Uuid::new_v4().to_string(),
            title: derive_title(content),
            tags: derive_tags(content),
            starred: false,
            folder_id,
            created: now,
            updated: now,
            journal,
            extra: Vec::new(),
        };
        self.write_note(&self.path_for_new_note(&meta), &write_frontmatter(&meta, content))?;
        Ok(note_from_meta(meta, content))
    }

    /// Mark a note as the journal page for `day`, or as no journal page.
    pub(crate) fn set_journal(&self, id: &str, journal: Option<NaiveDate>) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (mut meta, content) = split_frontmatter(&raw)?;
        meta.journal = journal;
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(note_from_meta(meta, &content))
    }

    pub fn save_note(&self, id: &str, content: String) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (mut meta, previous) = split_frontmatter(&raw)?;
        self.keep_version(id, &previous, &content);
        meta.title = derive_title(&content);
        meta.tags = derive_tags(&content);
        meta.updated = Utc::now();
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(note_from_meta(meta, &content))
    }

    /// Replace a note's body without touching its edit time, for changes the
    /// user didn't make in that note (such as links following a rename).
    pub fn rewrite_content(&self, id: &str, content: &str) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (mut meta, previous) = split_frontmatter(&raw)?;
        self.keep_version(id, &previous, content);
        meta.title = derive_title(content);
        meta.tags = derive_tags(content);
        self.write_note(&path, &write_frontmatter(&meta, content))?;
        Ok(note_from_meta(meta, content))
    }

    pub fn update_note_folder(&self, id: &str, folder_id: Option<String>) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (mut meta, content) = split_frontmatter(&raw)?;
        meta.folder_id = folder_id;
        meta.updated = Utc::now();
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(note_from_meta(meta, &content))
    }

    pub fn star_note(&self, id: &str, starred: bool) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (mut meta, content) = split_frontmatter(&raw)?;
        meta.starred = starred;
        meta.updated = Utc::now();
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(note_from_meta(meta, &content))
    }

    pub fn delete_note(&self, id: &str) -> Result<(), String> {
        self.update_note_folder(id, Some("archive".into())).map(|_| ())
    }

    pub fn destroy_note(&self, id: &str) -> Result<(), String> {
        fs::remove_file(self.note_path(id)?).map_err(|e| e.to_string())?;
        self.history.remove_all(id)
    }

    /// Version history must never block a save: failures are only logged.
    fn keep_version(&self, id: &str, previous: &str, next: &str) {
        if let Err(e) = self.history.before_save(id, previous, next, Utc::now()) {
            eprintln!("history: could not snapshot note {id}: {e}");
        }
    }

    /// Write a note file, recording the content for the file watcher first.
    fn write_note(&self, path: &Path, text: &str) -> Result<(), String> {
        self.tracker.record(path, text);
        fs::write(path, text).map_err(|e| e.to_string())
    }

    pub fn note_file_path(&self, id: &str) -> Result<PathBuf, String> {
        self.note_path(id)
    }

    fn seed_notes(root: &Path) -> Result<(), String> {
        for title in ["Welcome to Tagdown", "Tagdown Cheat Sheet", "Your First Note"] {
            let now = Utc::now();
            let id = Uuid::new_v4().to_string();
            let meta = NoteFrontmatter { id: id.clone(), title: title.into(), tags: Vec::new(), starred: false, folder_id: None, created: now, updated: now, journal: None, extra: Vec::new() };
            let content = format!("# {}\n\nStart writing in Tagdown.", title);
            fs::write(root.join(format!("note-{id}.{NOTE_EXT}")), write_frontmatter(&meta, &content)).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Renames notes from the old `.td` extension to `.md`, leaving any file
    /// alone if a `.md` sibling already exists.
    fn migrate_legacy_notes(root: &Path) -> Result<(), String> {
        let legacy: Vec<PathBuf> = WalkDir::new(root)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.into_path())
            .filter(|path| path.extension().and_then(|s| s.to_str()) == Some(LEGACY_NOTE_EXT))
            .filter(|path| path.file_name().and_then(|n| n.to_str()).is_some_and(|name| name.starts_with("note-")))
            .collect();
        for path in legacy {
            let target = path.with_extension(NOTE_EXT);
            if !target.exists() {
                fs::rename(&path, &target).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// Every note file in the vault.
    pub fn note_paths(&self) -> Vec<PathBuf> {
        WalkDir::new(&self.root)
            .into_iter()
            // Skip app data such as the search index.
            .filter_entry(|entry| entry.file_name() != ".tagdown")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.into_path())
            .filter(|path| path.extension().and_then(|s| s.to_str()) == Some(NOTE_EXT))
            .collect()
    }

    fn note_path(&self, id: &str) -> Result<PathBuf, String> {
        self.note_paths()
            .into_iter()
            .find(|path| path.file_name().and_then(|n| n.to_str()).is_some_and(|name| name == format!("note-{id}.{NOTE_EXT}")))
            .ok_or_else(|| format!("note not found: {id}"))
    }

    fn path_for_new_note(&self, meta: &NoteFrontmatter) -> PathBuf {
        self.root.join(format!("note-{}.{NOTE_EXT}", meta.id))
    }
}

pub(crate) fn note_from_meta(meta: NoteFrontmatter, content: &str) -> Note {
    Note {
        id: meta.id,
        title: meta.title,
        preview: derive_preview(content),
        tags: meta.tags,
        starred: meta.starred,
        folder_id: meta.folder_id,
        created_at: meta.created,
        updated_at: meta.updated,
        word_count: word_count(content),
        journal: meta.journal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn save_note_derives_tags_from_body() {
        let dir = env::temp_dir().join(format!("tagdown-test-{}", Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        let note = vault.create_note(None).unwrap();
        let saved = vault
            .save_note(&note.id, "# Title\n\nText with #notes/chemistry and #physics".into())
            .unwrap();
        assert_eq!(saved.tags, vec!["notes/chemistry", "physics"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rewrite_content_keeps_edit_time() {
        let dir = env::temp_dir().join(format!("tagdown-test-{}", Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        let note = vault.save_note(&vault.create_note(None).unwrap().id, "# A\n\nSee [[Old]].".into()).unwrap();
        let rewritten = vault.rewrite_content(&note.id, "# A\n\nSee [[New]].").unwrap();
        assert_eq!(rewritten.updated_at, note.updated_at);
        assert_eq!(vault.get_note_content(&note.id).unwrap().content, "# A\n\nSee [[New]].");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn notes_are_stored_as_markdown() {
        let dir = env::temp_dir().join(format!("tagdown-test-{}", Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        let note = vault.create_note(None).unwrap();
        let path = vault.note_file_path(&note.id).unwrap();
        assert_eq!(path.extension().and_then(|s| s.to_str()), Some("md"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn legacy_td_notes_are_migrated_on_open() {
        let dir = env::temp_dir().join(format!("tagdown-test-{}", Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        let note = vault.create_note(None).unwrap();
        let md = vault.note_file_path(&note.id).unwrap();
        std::fs::rename(&md, md.with_extension("td")).unwrap();

        let reopened = Vault::open_or_create(dir.clone()).unwrap();
        assert!(md.exists());
        assert!(reopened.get_note_content(&note.id).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }
}

fn sort_notes(notes: &mut [Note], sort: SortOrder) {
    match sort {
        SortOrder::UpdatedDesc => notes.sort_by_key(|n| std::cmp::Reverse(n.updated_at)),
        SortOrder::CreatedDesc => notes.sort_by_key(|n| std::cmp::Reverse(n.created_at)),
        SortOrder::TitleAsc => notes.sort_by(|a, b| a.title.cmp(&b.title)),
        SortOrder::TitleDesc => notes.sort_by(|a, b| b.title.cmp(&a.title)),
        SortOrder::WordCountDesc => notes.sort_by_key(|n| std::cmp::Reverse(n.word_count)),
    }
}
