use std::{path::PathBuf, sync::Mutex};

use serde::Serialize;
use tauri::State;

use crate::{
    models::Note,
    site::{self, SiteDir, SiteFile},
    AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteNote {
    note: Note,
    content: String,
    folder: Option<String>,
}

/// The notes to publish: all of them, one folder (with its subfolders), or one
/// tag (with nested tags). Archived notes are never published.
#[tauri::command]
pub async fn site_notes(folder_id: Option<String>, tag: Option<String>, state: State<'_, Mutex<AppState>>) -> Result<Vec<SiteNote>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let folders = &state.vault.meta.folders;
    let in_folder = |id: Option<&str>| -> bool {
        let Some(wanted) = folder_id.as_deref() else { return true };
        let mut current = id.map(str::to_string);
        while let Some(f) = current {
            if f == wanted {
                return true;
            }
            current = folders.iter().find(|r| r.id == f).and_then(|r| r.parent_id.clone());
        }
        false
    };
    let tag = tag.map(|t| t.trim_start_matches('#').to_lowercase());
    Ok(state
        .vault
        .notes_with_content()?
        .into_iter()
        .filter(|(n, _)| n.folder_id.as_deref() != Some("archive"))
        .filter(|(n, _)| in_folder(n.folder_id.as_deref()))
        .filter(|(n, _)| tag.as_ref().is_none_or(|t| n.tags.iter().any(|nt| nt == t || nt.starts_with(&format!("{t}/")))))
        .map(|(note, content)| {
            let folder = note.folder_id.as_ref().and_then(|id| folders.iter().find(|f| &f.id == id)).map(|f| f.name.clone());
            SiteNote { note, content, folder }
        })
        .collect())
}

#[tauri::command]
pub async fn inspect_site_dir(dir: String) -> Result<SiteDir, String> {
    Ok(site::inspect(&PathBuf::from(dir)))
}

/// Write a rendered site; returns how many stale pages were removed.
#[tauri::command]
pub async fn write_site(dir: String, files: Vec<SiteFile>) -> Result<usize, String> {
    site::write(&PathBuf::from(dir), &files)
}
