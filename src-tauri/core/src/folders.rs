// Folders are directories in the vault. `vault.json` keeps what disk can't:
// each folder's id, icon and place in the sidebar order. A folder's directory
// is its name under its parent's directory; the Archive is `Archive/`.
//
// Folders made, renamed or removed in Finder are picked up by `sync_folders`;
// changes made in Tagdown are done on disk first.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    frontmatter::split_any,
    models::{FolderRecord, Note},
    vault::{free_path, is_hidden, is_skipped, Vault, ARCHIVE_DIR, ARCHIVE_ID, ATTACHMENTS_DIR},
};

impl Vault {
    /// The folder a note at `path` is in, from the directory it sits in.
    pub(crate) fn folder_of(&self, path: &Path) -> Option<String> {
        let dir = path.parent()?.strip_prefix(&self.root).ok()?;
        if dir.as_os_str().is_empty() {
            return None;
        }
        if dir.starts_with(ARCHIVE_DIR) {
            return Some(ARCHIVE_ID.into());
        }
        self.folder_paths().into_iter().find(|(_, path)| path == dir).map(|(id, _)| id)
    }

    /// Each folder's directory, relative to the vault.
    fn folder_paths(&self) -> HashMap<String, PathBuf> {
        self.meta.folders.iter().filter_map(|f| Some((f.id.clone(), self.folder_rel_path(&f.id)?))).collect()
    }

    fn folder_rel_path(&self, id: &str) -> Option<PathBuf> {
        if id == ARCHIVE_ID {
            return Some(PathBuf::from(ARCHIVE_DIR));
        }
        let mut names = Vec::new();
        let mut next = Some(id.to_string());
        while let Some(id) = next {
            // A parent loop in a hand-edited vault.json must not hang the app.
            if names.len() > 64 {
                return None;
            }
            let record = self.meta.folders.iter().find(|f| f.id == id)?;
            names.push(record.name.clone());
            next = record.parent_id.clone();
        }
        Some(names.iter().rev().collect())
    }

    /// The directory notes in `folder_id` live in; the vault itself for none.
    pub(crate) fn folder_dir(&self, folder_id: Option<&str>) -> Result<PathBuf, String> {
        match folder_id {
            None => Ok(self.root.clone()),
            Some(id) => {
                let dir = self.root.join(self.folder_rel_path(id).ok_or("folder not found")?);
                fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                Ok(dir)
            }
        }
    }

    /// Bring the folder list in line with the directories on disk: new
    /// directories become folders, folders whose directory is gone are dropped.
    /// Returns whether anything changed.
    pub fn sync_folders(&mut self) -> Result<bool, String> {
        let mut by_path: HashMap<PathBuf, String> = self.folder_paths().into_iter().map(|(id, path)| (path, id)).collect();
        let mut keep = HashSet::from([ARCHIVE_ID.to_string()]);
        let mut next_order = self.meta.folders.iter().filter(|f| f.id != ARCHIVE_ID).map(|f| f.sort_order + 1).max().unwrap_or(0);
        let mut changed = false;
        // Parents come before their children.
        for dir in self.folder_dirs_on_disk() {
            if let Some(id) = by_path.get(&dir) {
                keep.insert(id.clone());
                continue;
            }
            let parent_id = dir.parent().filter(|p| !p.as_os_str().is_empty()).and_then(|p| by_path.get(p)).cloned();
            let id = Uuid::new_v4().to_string();
            let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            self.meta.folders.push(FolderRecord { id: id.clone(), name, parent_id, sort_order: next_order, icon: None });
            next_order += 1;
            by_path.insert(dir, id.clone());
            keep.insert(id);
            changed = true;
        }
        let before = self.meta.folders.len();
        self.meta.folders.retain(|f| keep.contains(&f.id));
        changed |= self.meta.folders.len() != before;
        if changed {
            self.save_meta()?;
        }
        Ok(changed)
    }

    /// Directories that are folders, relative to the vault, parents first.
    fn folder_dirs_on_disk(&self) -> Vec<PathBuf> {
        WalkDir::new(&self.root)
            .min_depth(1)
            .sort_by_file_name()
            .into_iter()
            .filter_entry(|entry| {
                let name = entry.file_name();
                !is_skipped(entry) && !(entry.depth() == 1 && (name == ARCHIVE_DIR || name == ATTACHMENTS_DIR))
            })
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_dir())
            .filter_map(|entry| entry.path().strip_prefix(&self.root).ok().map(Path::to_path_buf))
            .collect()
    }

    /// Vaults before version 2 kept folders in `vault.json` only, with every
    /// note at the top. Give each folder a directory and move its notes in.
    pub(crate) fn move_folders_to_disk(&mut self) -> Result<(), String> {
        let depth = |vault: &Self, id: &str| {
            let mut depth = 0;
            let mut parent = vault.meta.folders.iter().find(|f| f.id == id).and_then(|f| f.parent_id.clone());
            while let Some(id) = parent.filter(|_| depth < 64) {
                depth += 1;
                parent = vault.meta.folders.iter().find(|f| f.id == id).and_then(|f| f.parent_id.clone());
            }
            depth
        };
        let mut order: Vec<String> = self.meta.folders.iter().filter(|f| f.id != ARCHIVE_ID).map(|f| f.id.clone()).collect();
        order.sort_by_key(|id| depth(self, id));
        // Directory names must be valid and unique among their siblings.
        let mut taken: HashSet<(Option<String>, String)> = HashSet::new();
        for id in order {
            let record = self.meta.folders.iter().find(|f| f.id == id).cloned().ok_or("folder not found")?;
            let base = clean_folder_name(&record.name);
            let mut name = base.clone();
            let mut n = 1;
            loop {
                let reserved = record.parent_id.is_none() && is_reserved(&name);
                if !reserved && taken.insert((record.parent_id.clone(), name.to_lowercase())) {
                    break;
                }
                n += 1;
                name = format!("{base} {n}");
            }
            if let Some(f) = self.meta.folders.iter_mut().find(|f| f.id == id) {
                f.name = name;
            }
            self.folder_dir(Some(&id))?;
        }
        for path in self.note_paths() {
            let Ok(raw) = fs::read_to_string(&path) else { continue };
            let Some(folder_id) = split_any(&raw).0.folder_id else { continue };
            let Some(dir) = self.folder_rel_path(&folder_id).map(|p| self.root.join(p)) else { continue };
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            if path.parent() != Some(dir.as_path()) {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                fs::rename(&path, free_path(&dir, name)).map_err(|e| e.to_string())?;
            }
        }
        self.meta.version = 2;
        self.save_meta()
    }

    pub fn create_folder(&mut self, name: &str, parent_id: Option<String>, icon: Option<String>) -> Result<FolderRecord, String> {
        let name = valid_folder_name(name, parent_id.is_none())?;
        if parent_id.as_deref() == Some(ARCHIVE_ID) {
            return Err("folders can't go in the Archive".into());
        }
        let dir = self.folder_dir(parent_id.as_deref())?.join(&name);
        if dir.exists() {
            return Err(format!("there's already a folder named “{name}” there"));
        }
        fs::create_dir(&dir).map_err(|e| e.to_string())?;
        let sort_order = self.meta.folders.len() as u32;
        let record = FolderRecord { id: Uuid::new_v4().to_string(), name, parent_id, sort_order, icon };
        self.meta.folders.push(record.clone());
        self.save_meta()?;
        Ok(record)
    }

    /// Rename a folder and its directory.
    pub fn rename_folder(&mut self, id: &str, name: &str) -> Result<FolderRecord, String> {
        if id == ARCHIVE_ID {
            return Err("the Archive can't be renamed".into());
        }
        let parent_id = self.meta.folders.iter().find(|f| f.id == id).ok_or("folder not found")?.parent_id.clone();
        let name = valid_folder_name(name, parent_id.is_none())?;
        let old = self.folder_dir(Some(id))?;
        let new = old.with_file_name(&name);
        self.move_dir(&old, &new, &name)?;
        let record = self.meta.folders.iter_mut().find(|f| f.id == id).ok_or("folder not found")?;
        record.name = name;
        let record = record.clone();
        self.save_meta()?;
        Ok(record)
    }

    /// Move a folder's directory under `parent_id` (the top level for none).
    /// The sidebar order is the caller's to set.
    pub fn move_folder_into(&mut self, id: &str, parent_id: Option<String>) -> Result<(), String> {
        let record = self.meta.folders.iter().find(|f| f.id == id).ok_or("folder not found")?.clone();
        if record.parent_id == parent_id {
            return Ok(());
        }
        if parent_id.as_deref() == Some(ARCHIVE_ID) {
            return Err("folders can't go in the Archive".into());
        }
        if parent_id.is_none() && is_reserved(&record.name) {
            return Err(format!("“{}” is reserved for Tagdown at the top of the vault", record.name));
        }
        let old = self.folder_dir(Some(id))?;
        let new = self.folder_dir(parent_id.as_deref())?.join(&record.name);
        self.move_dir(&old, &new, &record.name)?;
        if let Some(f) = self.meta.folders.iter_mut().find(|f| f.id == id) {
            f.parent_id = parent_id;
        }
        Ok(())
    }

    /// Delete a folder and its subfolders. Their notes move to the top of the
    /// vault; a folder holding other files is left alone.
    pub fn delete_folder(&mut self, id: &str) -> Result<Vec<Note>, String> {
        if id == ARCHIVE_ID {
            return Err("the Archive can't be deleted".into());
        }
        let name = self.meta.folders.iter().find(|f| f.id == id).ok_or("folder not found")?.name.clone();
        let dir = self.folder_dir(Some(id))?;
        let files: Vec<PathBuf> = WalkDir::new(&dir).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()).map(|e| e.into_path()).collect();
        let is_note = |path: &Path| {
            path.extension().and_then(|s| s.to_str()) == Some("md")
                && !path.strip_prefix(&dir).unwrap_or(path).components().any(|c| is_hidden(c.as_os_str()))
        };
        if let Some(other) = files.iter().find(|path| !is_note(path) && path.file_name().is_some_and(|n| n != ".DS_Store")) {
            let shown = other.strip_prefix(&self.root).unwrap_or(other).display();
            return Err(format!("“{name}” also holds files that aren't notes, such as “{shown}”. Move them out in Finder first."));
        }
        let mut moved = Vec::new();
        for path in files.iter().filter(|path| is_note(path)) {
            let (meta, _) = self.read_note(path)?;
            moved.push(self.update_note_folder(&meta.id, None)?);
        }
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        self.sync_folders()?;
        Ok(moved)
    }

    /// Rename a directory, telling the file watcher the notes inside are the
    /// app's own doing.
    fn move_dir(&self, old: &Path, new: &Path, name: &str) -> Result<(), String> {
        if old == new {
            return Ok(());
        }
        // On a case-insensitive disk, "work" → "Work" finds itself.
        let same_but_case = old.parent() == new.parent()
            && old.file_name().map(|n| n.to_string_lossy().to_lowercase()) == Some(name.to_lowercase());
        if new.exists() && !same_but_case {
            return Err(format!("there's already a folder named “{name}” there"));
        }
        for entry in WalkDir::new(old).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()) {
            if let Ok(raw) = fs::read_to_string(entry.path()) {
                self.tracker.record(entry.path(), &raw);
            }
        }
        fs::rename(old, new).map_err(|e| e.to_string())
    }
}

/// A name a folder (and its directory) can have.
fn valid_folder_name(name: &str, at_top: bool) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err("a folder needs a name".into());
    }
    if name.contains(['/', ':']) {
        return Err("folder names can't contain / or :".into());
    }
    if name.starts_with('.') {
        return Err("folder names can't start with a dot".into());
    }
    if at_top && is_reserved(name) {
        return Err(format!("“{name}” is reserved for Tagdown at the top of the vault"));
    }
    Ok(name.to_string())
}

fn is_reserved(name: &str) -> bool {
    name.eq_ignore_ascii_case(ARCHIVE_DIR) || name.eq_ignore_ascii_case(ATTACHMENTS_DIR)
}

/// A pre-version-2 folder name made safe for a directory.
fn clean_folder_name(name: &str) -> String {
    let cleaned: String = name.trim().replace(['/', ':'], "-");
    let cleaned = cleaned.trim_start_matches('.').trim().to_string();
    if cleaned.is_empty() { "Folder".into() } else { cleaned }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SortOrder;

    fn temp_vault() -> (PathBuf, Vault) {
        let dir = std::env::temp_dir().join(format!("tagdown-folders-{}", Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        (dir, vault)
    }

    #[test]
    fn folders_are_directories() {
        let (dir, mut vault) = temp_vault();
        let work = vault.create_folder("Work", None, None).unwrap();
        let ideas = vault.create_folder("Ideas", Some(work.id.clone()), None).unwrap();
        assert!(dir.join("Work/Ideas").is_dir());

        let note = vault.create_note(Some(ideas.id.clone())).unwrap();
        let path = vault.note_file_path(&note.id).unwrap();
        assert_eq!(path.parent().unwrap(), dir.join("Work/Ideas"));

        vault.rename_folder(&work.id, "Projects").unwrap();
        assert!(dir.join("Projects/Ideas").is_dir() && !dir.join("Work").exists());
        assert_eq!(vault.list_notes(Some(ideas.id.clone()), SortOrder::UpdatedDesc).unwrap().len(), 1);

        vault.move_folder_into(&ideas.id, None).unwrap();
        assert!(dir.join("Ideas").is_dir());
        let moved = vault.update_note_folder(&note.id, Some(work.id.clone())).unwrap();
        assert_eq!(moved.folder_id.as_deref(), Some(work.id.as_str()));
        assert_eq!(vault.note_file_path(&note.id).unwrap().parent().unwrap(), dir.join("Projects"));

        assert!(vault.create_folder("Projects", None, None).is_err(), "names are unique among siblings");
        assert!(vault.create_folder("archive", None, None).is_err(), "reserved");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn directories_made_elsewhere_become_folders() {
        let (dir, mut vault) = temp_vault();
        fs::create_dir_all(dir.join("Reading/Books")).unwrap();
        fs::create_dir_all(dir.join(".obsidian")).unwrap();
        fs::write(dir.join("Reading/Books/Dune.md"), "---\ntags: [scifi]\ncreated: 2024-01-02\n---\n\nSpice.\n").unwrap();
        assert!(vault.sync_folders().unwrap());
        let names: Vec<&str> = vault.meta.folders.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"Reading") && names.contains(&"Books") && !names.contains(&".obsidian"));
        let books = vault.meta.folders.iter().find(|f| f.name == "Books").unwrap().clone();
        let reading = vault.meta.folders.iter().find(|f| f.name == "Reading").unwrap();
        assert_eq!(books.parent_id.as_deref(), Some(reading.id.as_str()));

        // A plain Markdown file is a note, titled by its file name.
        let notes = vault.list_notes(Some(books.id.clone()), SortOrder::UpdatedDesc).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Dune");
        assert_eq!(notes[0].tags, vec!["scifi"]);
        // Saving it keeps its id and the tag only its frontmatter has.
        let saved = vault.save_note(&notes[0].id, "Spice must flow. #desert".into()).unwrap();
        assert_eq!(saved.id, notes[0].id);
        assert_eq!(saved.tags, vec!["desert", "scifi"]);
        assert_eq!(vault.list_notes(None, SortOrder::UpdatedDesc).unwrap().iter().filter(|n| n.id == saved.id).count(), 1);

        fs::remove_dir_all(dir.join("Reading")).unwrap();
        vault.sync_folders().unwrap();
        assert!(!vault.meta.folders.iter().any(|f| f.name == "Reading" || f.name == "Books"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn deleting_a_folder_keeps_its_notes() {
        let (dir, mut vault) = temp_vault();
        let work = vault.create_folder("Work", None, None).unwrap();
        let note = vault.create_note(Some(work.id.clone())).unwrap();
        fs::write(dir.join("Work/report.pdf"), b"%PDF").unwrap();
        assert!(vault.delete_folder(&work.id).is_err(), "other files block it");
        fs::remove_file(dir.join("Work/report.pdf")).unwrap();
        let moved = vault.delete_folder(&work.id).unwrap();
        assert_eq!(moved.len(), 1);
        assert!(!dir.join("Work").exists());
        assert_eq!(vault.note_file_path(&note.id).unwrap().parent().unwrap(), dir.as_path());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn version_1_folders_move_to_disk() {
        let (dir, mut vault) = temp_vault();
        // A version 1 vault: folders only in vault.json, notes at the top.
        let note = vault.create_note(None).unwrap();
        let path = vault.note_file_path(&note.id).unwrap();
        vault.meta.folders.push(FolderRecord { id: "w".into(), name: "Work/Home".into(), parent_id: None, sort_order: 0, icon: None });
        vault.meta.folders.push(FolderRecord { id: "w2".into(), name: "work-home".into(), parent_id: None, sort_order: 1, icon: None });
        vault.meta.version = 1;
        vault.save_meta().unwrap();
        let raw = fs::read_to_string(&path).unwrap().replace("folder_id: null", "folder_id: w");
        fs::write(&path, raw).unwrap();

        let reopened = Vault::open_or_create(dir.clone()).unwrap();
        assert_eq!(reopened.meta.version, 2);
        assert!(dir.join("Work-Home").is_dir() && dir.join("work-home 2").is_dir());
        assert_eq!(reopened.note_file_path(&note.id).unwrap().parent().unwrap(), dir.join("Work-Home"));
        assert_eq!(reopened.list_notes(Some("w".into()), SortOrder::UpdatedDesc).unwrap().len(), 1);
        fs::remove_dir_all(&dir).ok();
    }
}
