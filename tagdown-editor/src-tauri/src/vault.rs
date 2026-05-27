use std::{fs, path::{Path, PathBuf}};

use chrono::Utc;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    frontmatter::{derive_preview, derive_tags, derive_title, split_frontmatter, word_count, write_frontmatter},
    models::{FolderRecord, Note, NoteContent, NoteFrontmatter, SortOrder, VaultMeta},
};

#[derive(Debug, Clone)]
pub struct Vault {
    pub root: PathBuf,
    pub meta: VaultMeta,
}

impl Vault {
    pub fn open_or_create_default() -> Result<Self, String> {
        let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
        let root = PathBuf::from(home).join("Documents").join("Tagdown");
        Self::open_or_create(root)
    }

    pub fn open_or_create(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join(".tagdown")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("Archive")).map_err(|e| e.to_string())?;
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
        Ok(Self { root, meta })
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
            if folder_id.as_deref() == Some("starred") && !meta.starred { continue; }
            if let Some(ref folder) = folder_id {
                if folder != "starred" && meta.folder_id.as_ref() != Some(folder) { continue; }
            }
            notes.push(note_from_meta(meta, &content));
        }
        sort_notes(&mut notes, sort);
        Ok(notes)
    }

    pub fn get_note_content(&self, id: &str) -> Result<NoteContent, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let (_, content) = split_frontmatter(&raw)?;
        Ok(NoteContent { id: id.into(), content })
    }

    pub fn create_note(&self, folder_id: Option<String>) -> Result<Note, String> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let content = "# Untitled\n";
        let meta = NoteFrontmatter {
            id: id.clone(),
            title: "Untitled".into(),
            tags: derive_tags(content),
            starred: false,
            folder_id,
            created: now,
            updated: now,
        };
        fs::write(self.path_for_new_note(&meta), write_frontmatter(&meta, content)).map_err(|e| e.to_string())?;
        Ok(note_from_meta(meta, content))
    }

    pub fn save_note(&self, id: &str, content: String) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (mut meta, _) = split_frontmatter(&raw)?;
        meta.title = derive_title(&content);
        meta.tags = derive_tags(&content);
        meta.updated = Utc::now();
        fs::write(path, write_frontmatter(&meta, &content)).map_err(|e| e.to_string())?;
        Ok(note_from_meta(meta, &content))
    }

    pub fn update_note_folder(&self, id: &str, folder_id: Option<String>) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (mut meta, content) = split_frontmatter(&raw)?;
        meta.folder_id = folder_id;
        meta.updated = Utc::now();
        fs::write(path, write_frontmatter(&meta, &content)).map_err(|e| e.to_string())?;
        Ok(note_from_meta(meta, &content))
    }

    pub fn star_note(&self, id: &str, starred: bool) -> Result<Note, String> {
        let path = self.note_path(id)?;
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (mut meta, content) = split_frontmatter(&raw)?;
        meta.starred = starred;
        meta.updated = Utc::now();
        fs::write(path, write_frontmatter(&meta, &content)).map_err(|e| e.to_string())?;
        Ok(note_from_meta(meta, &content))
    }

    pub fn delete_note(&self, id: &str) -> Result<(), String> {
        self.update_note_folder(id, Some("archive".into())).map(|_| ())
    }

    pub fn destroy_note(&self, id: &str) -> Result<(), String> {
        fs::remove_file(self.note_path(id)?).map_err(|e| e.to_string())
    }

    pub fn note_file_path(&self, id: &str) -> Result<PathBuf, String> {
        self.note_path(id)
    }

    fn seed_notes(root: &Path) -> Result<(), String> {
        for title in ["Welcome to Tagdown", "Tagdown Cheat Sheet", "Your First Note"] {
            let now = Utc::now();
            let id = Uuid::new_v4().to_string();
            let meta = NoteFrontmatter { id: id.clone(), title: title.into(), tags: Vec::new(), starred: false, folder_id: None, created: now, updated: now };
            let content = format!("# {}\n\nStart writing in Tagdown.", title);
            fs::write(root.join(format!("note-{id}.td")), write_frontmatter(&meta, &content)).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn note_paths(&self) -> Vec<PathBuf> {
        WalkDir::new(&self.root)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.into_path())
            .filter(|path| path.extension().and_then(|s| s.to_str()) == Some("td"))
            .collect()
    }

    fn note_path(&self, id: &str) -> Result<PathBuf, String> {
        self.note_paths()
            .into_iter()
            .find(|path| path.file_name().and_then(|n| n.to_str()).is_some_and(|name| name == format!("note-{id}.td")))
            .ok_or_else(|| format!("note not found: {id}"))
    }

    fn path_for_new_note(&self, meta: &NoteFrontmatter) -> PathBuf {
        self.root.join(format!("note-{}.td", meta.id))
    }
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
