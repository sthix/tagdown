//! Named queries stored with a vault, independently of its Markdown notes.

use std::{fs, io::Write};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::vault::Vault;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    pub query: String,
}

impl Vault {
    pub fn list_collections(&self) -> Result<Vec<Collection>, String> {
        let path = self.root.join(".tagdown/collections.json");
        match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| format!("Could not read collections: {e}")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(format!("Could not read collections: {e}")),
        }
    }

    /// The caller validates the query against the vault's current search index.
    pub fn save_collection(&self, id: Option<&str>, name: &str, icon: &str, query: &str) -> Result<Collection, String> {
        let (name, icon, query) = (name.trim(), icon.trim(), query.trim());
        if name.is_empty() || name.chars().count() > 100 {
            return Err("Use a collection name between 1 and 100 characters.".into());
        }
        if icon.chars().count() > 16 {
            return Err("Use a short icon, such as one emoji.".into());
        }
        if query.len() > 4000 {
            return Err("Collection rules must be at most 4000 bytes.".into());
        }
        let mut collections = self.list_collections()?;
        if collections.iter().any(|c| Some(c.id.as_str()) != id && c.name.to_lowercase() == name.to_lowercase()) {
            return Err("A collection with that name already exists.".into());
        }
        let collection = Collection {
            id: id.map(String::from).unwrap_or_else(|| Uuid::new_v4().to_string()),
            name: name.into(), icon: icon.into(), query: query.into(),
        };
        if id.is_some() {
            let existing = collections.iter_mut().find(|c| c.id == collection.id).ok_or("This collection no longer exists.")?;
            *existing = collection.clone();
        } else {
            collections.push(collection.clone());
        }
        self.write_collections(&collections)?;
        Ok(collection)
    }

    pub fn delete_collection(&self, id: &str) -> Result<(), String> {
        let mut collections = self.list_collections()?;
        collections.retain(|c| c.id != id);
        self.write_collections(&collections)
    }

    fn write_collections(&self, collections: &[Collection]) -> Result<(), String> {
        let directory = self.root.join(".tagdown");
        let temporary = directory.join(format!("collections-{}.tmp", Uuid::new_v4()));
        let result = (|| -> Result<(), String> {
            let data = serde_json::to_vec_pretty(collections).map_err(|e| e.to_string())?;
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
            file.write_all(&data).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
            fs::rename(&temporary, directory.join("collections.json")).map_err(|e| e.to_string())
        })();
        if result.is_err() { let _ = fs::remove_file(temporary); }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> Vault {
        let root = std::env::temp_dir().join(format!("tagdown-collections-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Existing.md"), "# Existing\n\nKeep this note.").unwrap();
        Vault::open_or_create(root).unwrap()
    }

    #[test]
    fn collections_survive_reopening_and_do_not_change_notes() {
        let vault = vault();
        assert!(vault.list_collections().unwrap().is_empty());
        let saved = vault.save_collection(None, " Projects ", " 📚 ", " type:Project show:table sort:title columns:status ").unwrap();
        assert_eq!(saved.name, "Projects");
        let reopened = Vault::open_existing(vault.root.clone()).unwrap();
        assert_eq!(reopened.list_collections().unwrap(), vec![saved.clone()]);
        let updated = reopened.save_collection(Some(&saved.id), "Active projects", "", "type:Project status=active show:cards").unwrap();
        assert_eq!(updated.id, saved.id);
        assert_eq!(reopened.list_collections().unwrap(), vec![updated]);
        reopened.delete_collection(&saved.id).unwrap();
        assert!(reopened.list_collections().unwrap().is_empty());
        assert_eq!(fs::read_to_string(vault.root.join("Existing.md")).unwrap(), "# Existing\n\nKeep this note.");
        fs::remove_dir_all(vault.root).unwrap();
    }

    #[test]
    fn rejects_invalid_updates_without_overwriting_saved_collections() {
        let vault = vault();
        let saved = vault.save_collection(None, "Books", "", "type:Book").unwrap();
        assert!(vault.save_collection(None, " books ", "", "").is_err());
        assert!(vault.save_collection(None, " ", "", "").is_err());
        assert!(vault.save_collection(Some("missing"), "Other", "", "").is_err());
        assert!(vault.save_collection(None, "Other", "", &"x".repeat(4001)).is_err());
        assert_eq!(vault.list_collections().unwrap(), vec![saved]);
        fs::remove_dir_all(vault.root).unwrap();
    }

    #[test]
    fn collections_are_isolated_by_vault_and_corruption_is_preserved() {
        let a = vault();
        let b = vault();
        a.save_collection(None, "Work", "", "show:table").unwrap();
        assert!(b.list_collections().unwrap().is_empty());
        let path = a.root.join(".tagdown/collections.json");
        fs::write(&path, "broken json").unwrap();
        assert!(a.list_collections().is_err());
        assert!(a.save_collection(None, "Other", "", "").is_err());
        assert!(a.delete_collection("anything").is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "broken json");
        fs::remove_dir_all(a.root).unwrap();
        fs::remove_dir_all(b.root).unwrap();
    }
}
