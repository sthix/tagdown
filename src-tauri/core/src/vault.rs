use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::{Arc, Mutex}};

use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    history::History,
    frontmatter::{derive_preview, derive_tags, derive_title, split_any, word_count, write_frontmatter},
    models::{FolderRecord, Note, NoteContent, NoteFrontmatter, SortOrder, VaultMeta},
    properties::{parse_properties, set_property, write_entry, Property, PropertyValue},
    watcher::FileTracker,
};

const NOTE_EXT: &str = "md";
const LEGACY_NOTE_EXT: &str = "td";
/// Vaults from version 2 on keep folders as directories on disk.
const VAULT_VERSION: u32 = 2;
pub(crate) const ARCHIVE_ID: &str = "archive";
pub(crate) const ARCHIVE_DIR: &str = "Archive";
/// Where images added to notes go; not a folder of notes.
pub(crate) const ATTACHMENTS_DIR: &str = "attachments";

#[derive(Debug, Clone)]
pub struct Vault {
    pub root: PathBuf,
    pub meta: VaultMeta,
    /// Shared by every clone, so the file watcher can tell the app's own writes apart.
    pub tracker: Arc<FileTracker>,
    pub history: History,
    /// Where each note was last seen, so finding one rarely means reading them all.
    paths: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl Vault {
    /// Open the vault the app last had open (see `vaults`), creating the default one if needed.
    pub fn open_or_create_active() -> Result<Self, String> {
        Self::open_or_create(crate::vaults::VaultList::load().active_root()?)
    }

    /// The vault used until another is chosen: `~/Documents/Tagdown`.
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
            // A folder that already holds notes (from another app, say) gets no starter notes.
            let seed = !has_markdown(&root);
            let meta = VaultMeta {
                version: VAULT_VERSION,
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
            if seed {
                Self::seed_notes(&root)?;
            }
            meta
        };
        let history = History::new(&root);
        let mut vault = Self { root, meta, tracker: Arc::default(), history, paths: Arc::default() };
        if vault.meta.version < VAULT_VERSION {
            vault.move_folders_to_disk()?;
        }
        vault.sync_folders()?;
        Ok(vault)
    }

    /// Read `vault.json` again, for a long-lived copy (the file watcher's)
    /// to see folders made since it was taken.
    pub fn reload_meta(&mut self) {
        let path = self.root.join(".tagdown").join("vault.json");
        if let Some(meta) = fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()) {
            self.meta = meta;
        }
    }

    pub fn save_meta(&self) -> Result<(), String> {
        let path = self.root.join(".tagdown").join("vault.json");
        fs::write(path, serde_json::to_string_pretty(&self.meta).unwrap()).map_err(|e| e.to_string())
    }

    pub fn list_notes(&self, folder_id: Option<String>, sort: SortOrder) -> Result<Vec<Note>, String> {
        let mut notes = Vec::new();
        for path in self.note_paths() {
            let Ok((meta, content)) = self.read_note(&path) else { continue; };
            // `starred` and `journal` are views across folders rather than folders.
            let wanted = match folder_id.as_deref() {
                None => true,
                Some("starred") => meta.starred,
                Some("journal") => meta.journal.is_some() && meta.folder_id.as_deref() != Some("archive"),
                Some(folder) => meta.folder_id.as_deref() == Some(folder),
            };
            if !wanted { continue; }
            notes.push(self.note_at(&path, meta, &content));
        }
        sort_notes(&mut notes, sort);
        Ok(notes)
    }

    /// Every note with its body, for building the search index.
    pub fn notes_with_content(&self) -> Result<Vec<(Note, String)>, String> {
        let mut notes = Vec::new();
        for path in self.note_paths() {
            let Ok((meta, content)) = self.read_note(&path) else { continue; };
            let note = self.note_at(&path, meta, &content);
            notes.push((note, content));
        }
        Ok(notes)
    }

    pub fn get_note_content(&self, id: &str) -> Result<NoteContent, String> {
        let (_, content) = self.read_note(&self.note_path(id)?)?;
        Ok(NoteContent { id: id.into(), content })
    }

    pub fn create_note(&self, folder_id: Option<String>) -> Result<Note, String> {
        self.create_note_with(folder_id, "# Untitled\n", None, &[])
    }

    /// Create a note with `content` as its body, optionally as the journal page
    /// for a day, starting with `properties` in its frontmatter.
    pub(crate) fn create_note_with(&self, folder_id: Option<String>, content: &str, journal: Option<NaiveDate>, properties: &[Property]) -> Result<Note, String> {
        for p in properties { crate::properties::check_key(&p.key)?; p.value.validate()?; }
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
            extra: properties.iter().map(|p| write_entry(&p.key, &p.value)).collect(),
        };
        let path = self.folder_dir(meta.folder_id.as_deref())?.join(format!("note-{}.{NOTE_EXT}", meta.id));
        self.write_note(&path, &write_frontmatter(&meta, content))?;
        self.remember(&meta.id, &path);
        Ok(self.note_at(&path, meta, content))
    }

    /// Mark a note as the journal page for `day`, or as no journal page.
    pub(crate) fn set_journal(&self, id: &str, journal: Option<NaiveDate>) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let (mut meta, content) = self.read_note(&path)?;
        meta.journal = journal;
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(self.note_at(&path, meta, &content))
    }

    pub fn save_note(&self, id: &str, content: String) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let (mut meta, previous) = self.read_note(&path)?;
        self.keep_version(id, &previous, &content);
        meta.title = title_of(&path, &content);
        meta.tags = next_tags(&meta.tags, &previous, &content);
        meta.updated = Utc::now();
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(self.note_at(&path, meta, &content))
    }

    /// Replace a note's body without touching its edit time, for changes the
    /// user didn't make in that note (such as links following a rename).
    pub fn rewrite_content(&self, id: &str, content: &str) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let (mut meta, previous) = self.read_note(&path)?;
        self.keep_version(id, &previous, content);
        meta.title = title_of(&path, content);
        meta.tags = next_tags(&meta.tags, &previous, content);
        self.write_note(&path, &write_frontmatter(&meta, content))?;
        Ok(self.note_at(&path, meta, content))
    }

    /// File a note in a folder (or the vault's top level): its file moves into
    /// that folder's directory.
    pub fn update_note_folder(&self, id: &str, folder_id: Option<String>) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let (mut meta, content) = self.read_note(&path)?;
        let dir = self.folder_dir(folder_id.as_deref())?;
        meta.folder_id = folder_id;
        meta.updated = Utc::now();
        let text = write_frontmatter(&meta, &content);
        self.write_note(&path, &text)?;
        if path.parent() != Some(dir.as_path()) {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
            let target = free_path(&dir, &name);
            self.tracker.record(&target, &text);
            fs::rename(&path, &target).map_err(|e| e.to_string())?;
            self.remember(&meta.id, &target);
            return Ok(self.note_at(&target, meta, &content));
        }
        Ok(self.note_at(&path, meta, &content))
    }

    /// Set (`Some`) or remove (`None`) the property `key` of a note, or rename
    /// the property `rename_from` to `key`. The body is left as it is.
    pub fn set_property(&self, id: &str, key: &str, value: Option<PropertyValue>, rename_from: Option<&str>) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let (mut meta, content) = self.read_note(&path)?;
        set_property(&mut meta.extra, key, value.as_ref(), rename_from)?;
        meta.updated = Utc::now();
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(self.note_at(&path, meta, &content))
    }

    /// Change related properties together, without an intermediate state on disk.
    pub(crate) fn set_properties(&self, id: &str, changes: &[(String, Option<PropertyValue>)]) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let (mut meta, content) = self.read_note(&path)?;
        for (key, value) in changes { set_property(&mut meta.extra, key, value.as_ref(), None)?; }
        meta.updated = Utc::now();
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(self.note_at(&path, meta, &content))
    }

    /// Add `properties` the note doesn't have yet (by name, ignoring case), in
    /// one write. Says which were added; with none, the file is left alone.
    pub fn add_properties(&self, id: &str, properties: &[Property]) -> Result<(Note, Vec<String>), String> {
        let path = self.note_path(id)?;
        let (mut meta, content) = self.read_note(&path)?;
        let mut taken: Vec<String> = parse_properties(&meta.extra).into_iter().map(|p| p.key.to_lowercase()).collect();
        let mut added = Vec::new();
        for p in properties {
            if taken.contains(&p.key.to_lowercase()) {
                continue;
            }
            set_property(&mut meta.extra, &p.key, Some(&p.value), None)?;
            taken.push(p.key.to_lowercase());
            added.push(p.key.clone());
        }
        if !added.is_empty() {
            meta.updated = Utc::now();
            self.write_note(&path, &write_frontmatter(&meta, &content))?;
        }
        Ok((self.note_at(&path, meta, &content), added))
    }

    /// Point links to `old_title` in a note's properties at `new_title`,
    /// without touching its edit time; `None` when nothing linked there. Links
    /// whose target `keep` accepts stay as they are (see `links::rename_links`).
    pub fn rename_property_links(&self, id: &str, old_title: &str, new_title: &str, keep: &dyn Fn(&str) -> bool) -> Result<Option<Note>, String> {
        let path = self.note_path(id)?;
        let (mut meta, content) = self.read_note(&path)?;
        let mut changed = false;
        for entry in meta.extra.iter_mut() {
            if let Some(next) = crate::links::rename_links(entry, old_title, new_title, keep) {
                *entry = next;
                changed = true;
            }
        }
        if !changed {
            return Ok(None);
        }
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(Some(self.note_at(&path, meta, &content)))
    }

    pub fn star_note(&self, id: &str, starred: bool) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let (mut meta, content) = self.read_note(&path)?;
        meta.starred = starred;
        meta.updated = Utc::now();
        self.write_note(&path, &write_frontmatter(&meta, &content))?;
        Ok(self.note_at(&path, meta, &content))
    }

    pub fn delete_note(&self, id: &str) -> Result<(), String> {
        self.update_note_folder(id, Some("archive".into())).map(|_| ())
    }

    pub fn destroy_note(&self, id: &str) -> Result<(), String> {
        fs::remove_file(self.note_path(id)?).map_err(|e| e.to_string())?;
        if let Ok(mut paths) = self.paths.lock() {
            paths.remove(id);
        }
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

    /// The note read from the file at `path`.
    pub(crate) fn note_at(&self, path: &Path, meta: NoteFrontmatter, content: &str) -> Note {
        let mut note = note_from_meta(meta, content);
        note.path = self.relative_path(path);
        note
    }

    /// `path` relative to the vault, `/`-separated.
    pub fn relative_path(&self, path: &Path) -> String {
        let relative = path.strip_prefix(&self.root).unwrap_or(path);
        relative.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
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

    /// Every note file in the vault: Markdown anywhere but hidden folders
    /// (Tagdown's own `.tagdown`, and the likes of `.git` or `.obsidian`).
    pub fn note_paths(&self) -> Vec<PathBuf> {
        WalkDir::new(&self.root)
            .into_iter()
            .filter_entry(|entry| entry.depth() == 0 || !is_skipped(entry))
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.into_path())
            .filter(|path| path.extension().and_then(|s| s.to_str()) == Some(NOTE_EXT))
            .collect()
    }

    fn note_path(&self, id: &str) -> Result<PathBuf, String> {
        let known = self.paths.lock().ok().and_then(|paths| paths.get(id).cloned());
        if let Some(path) = known {
            if self.read_note(&path).is_ok_and(|(meta, _)| meta.id == id) {
                return Ok(path);
            }
        }
        let paths = self.note_paths();
        let file_name = format!("note-{id}.{NOTE_EXT}");
        if let Some(path) = paths.iter().find(|path| path.file_name().and_then(|n| n.to_str()) == Some(file_name.as_str())) {
            self.remember(id, path);
            return Ok(path.clone());
        }
        paths
            .into_iter()
            .find(|path| self.read_note(path).is_ok_and(|(meta, _)| meta.id == id))
            .ok_or_else(|| format!("note not found: {id}"))
    }

    /// The id of the note last seen at `path`, if any.
    pub fn id_at(&self, path: &Path) -> Option<String> {
        let paths = self.paths.lock().ok()?;
        paths.iter().find(|(_, seen)| seen.as_path() == path).map(|(id, _)| id.clone())
            .or_else(|| path.file_stem()?.to_str()?.strip_prefix("note-").map(str::to_string))
    }

    fn remember(&self, id: &str, path: &Path) {
        if let Ok(mut paths) = self.paths.lock() {
            paths.insert(id.to_string(), path.to_path_buf());
        }
    }

    /// Read the note at `path`. Markdown files Tagdown didn't write are notes
    /// too: until Tagdown first saves one, its id comes from where it sits,
    /// and its dates from the file. A note's folder is the directory it's in.
    pub fn read_note(&self, path: &Path) -> Result<(NoteFrontmatter, String), String> {
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let (loose, content) = split_any(&raw);
        let file_time = |created: bool| {
            path.metadata().ok()
                .and_then(|m| if created { m.created().ok() } else { m.modified().ok() })
                .map(DateTime::<Utc>::from)
                .unwrap_or_else(Utc::now)
        };
        let managed = loose.id.is_some();
        let mut tags = loose.tags;
        if !managed {
            for tag in derive_tags(&content) {
                if !tags.contains(&tag) { tags.push(tag); }
            }
        }
        let meta = NoteFrontmatter {
            id: loose.id.unwrap_or_else(|| self.adopted_id(path)),
            title: loose.title.filter(|_| managed).unwrap_or_else(|| title_of(path, &content)),
            tags,
            starred: loose.starred,
            folder_id: self.folder_of(path),
            created: loose.created.unwrap_or_else(|| file_time(true)),
            updated: loose.updated.unwrap_or_else(|| file_time(false)),
            journal: loose.journal,
            extra: loose.extra,
        };
        self.remember(&meta.id, path);
        Ok((meta, content))
    }

    /// A stable id for a file Tagdown hasn't written to, from its place in the vault.
    fn adopted_id(&self, path: &Path) -> String {
        let relative = path.strip_prefix(&self.root).unwrap_or(path).to_string_lossy();
        // FNV-1a: unlike std's hasher, the same on every build.
        let hash = relative.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3));
        format!("md-{hash:016x}")
    }
}

/// The note's title: its first `# ` heading, else (for files Tagdown didn't
/// name) the file name.
fn title_of(path: &Path, content: &str) -> String {
    let title = derive_title(content);
    if title != "Untitled" {
        return title;
    }
    match path.file_stem().and_then(|s| s.to_str()) {
        Some(stem) if !stem.starts_with("note-") && !stem.trim().is_empty() => stem.to_string(),
        _ => title,
    }
}

/// Tags after an edit: the body's `#tags`, plus tags the frontmatter lists
/// that the body never had (other apps keep tags there).
fn next_tags(tags: &[String], previous: &str, content: &str) -> Vec<String> {
    let before = derive_tags(previous);
    let mut next = derive_tags(content);
    for tag in tags {
        if !before.contains(tag) && !next.contains(tag) {
            next.push(tag.clone());
        }
    }
    next
}

pub(crate) fn is_hidden(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|n| n.starts_with('.'))
}

/// Entries below the vault that hold no notes of its own: hidden ones (Tagdown's
/// `.tagdown`, `.git`, `.obsidian`) and other vaults kept inside this one.
pub(crate) fn is_skipped(entry: &walkdir::DirEntry) -> bool {
    is_hidden(entry.file_name()) || (entry.file_type().is_dir() && crate::vaults::is_vault(entry.path()))
}

fn has_markdown(root: &Path) -> bool {
    WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !is_skipped(entry))
        .filter_map(Result::ok)
        .any(|entry| entry.file_type().is_file() && entry.path().extension().and_then(|s| s.to_str()) == Some(NOTE_EXT))
}

/// The vault-relative path of a file called `name` anywhere in the vault, for
/// Obsidian's `![[photo.png]]`, which names an image without its folder. The
/// one nearest the top wins, as in Obsidian.
pub fn find_file_by_name(root: &Path, name: &str) -> Option<String> {
    let wanted = name.to_lowercase();
    WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !is_skipped(entry))
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && entry.file_name().to_str().is_some_and(|n| n.to_lowercase() == wanted))
        .min_by_key(|entry| entry.depth())
        .and_then(|entry| entry.path().strip_prefix(root).ok()?.to_str().map(str::to_string))
}

/// `dir/name`, or `dir/name 2.md` and so on when that's taken.
pub(crate) fn free_path(dir: &Path, name: &str) -> PathBuf {
    let (stem, ext) = name.rsplit_once('.').map_or((name, String::new()), |(s, e)| (s, format!(".{e}")));
    (1..)
        .map(|n| if n == 1 { dir.join(name) } else { dir.join(format!("{stem} {n}{ext}")) })
        .find(|path| !path.exists())
        .expect("some name is free")
}

fn note_from_meta(meta: NoteFrontmatter, content: &str) -> Note {
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
        properties: parse_properties(&meta.extra),
        path: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn files_are_found_by_name_nearest_the_top() {
        let dir = env::temp_dir().join(format!("tagdown-test-{}", Uuid::new_v4()));
        fs::create_dir_all(dir.join("a/b")).unwrap();
        fs::create_dir_all(dir.join(".obsidian")).unwrap();
        fs::write(dir.join("a/b/Photo.png"), b"1").unwrap();
        fs::write(dir.join("a/photo.png"), b"2").unwrap();
        fs::write(dir.join(".obsidian/other.png"), b"3").unwrap();
        assert_eq!(find_file_by_name(&dir, "photo.PNG").as_deref(), Some("a/photo.png"));
        assert_eq!(find_file_by_name(&dir, "other.png"), None, "hidden folders are skipped");
        std::fs::remove_dir_all(&dir).ok();
    }

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
    fn properties_are_set_in_the_frontmatter_only() {
        let dir = env::temp_dir().join(format!("tagdown-test-{}", Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        let note = vault.save_note(&vault.create_note(None).unwrap().id, "# A\n\nBody".into()).unwrap();
        let set = vault.set_property(&note.id, "status", Some(PropertyValue::Text("active".into())), None).unwrap();
        assert_eq!(set.properties.len(), 1);
        let raw = std::fs::read_to_string(vault.note_file_path(&note.id).unwrap()).unwrap();
        assert!(raw.contains("\nstatus: active\n---\n\n# A\n\nBody"), "{raw}");
        // Saving the body keeps the property.
        let saved = vault.save_note(&note.id, "# A\n\nNew body".into()).unwrap();
        assert_eq!(saved.properties, set.properties);
        assert!(vault.set_property(&note.id, "status", None, None).unwrap().properties.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn specialized_properties_survive_body_edits_and_reopening() {
        let dir = env::temp_dir().join(format!("tagdown-test-{}", Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        let properties = vec![
            Property { key: "summary".into(), value: PropertyValue::Longtext("  one\n\ntwo\t".into()) },
            Property { key: "labels".into(), value: PropertyValue::Multiselect(vec!["a, b".into(), "[[Sam]]".into()]) },
            Property { key: "progress".into(), value: PropertyValue::Percent(0.75) },
            Property { key: "scheduled".into(), value: PropertyValue::Datetime("2026-10-19T14:30:00".into()) },
        ];
        let note = vault.create_note_with(None, "# Fields\n\nBody", None, &properties).unwrap();
        assert_eq!(note.properties, properties);
        vault.save_note(&note.id, "# Fields\n\nChanged body".into()).unwrap();
        drop(vault);
        let reopened = Vault::open_or_create(dir.clone()).unwrap();
        let saved = reopened.get_note_content(&note.id).unwrap();
        assert_eq!(reopened.list_notes(None, SortOrder::UpdatedDesc).unwrap().iter().find(|n| n.id == note.id).unwrap().properties, properties);
        assert_eq!(saved.content, "# Fields\n\nChanged body");
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
