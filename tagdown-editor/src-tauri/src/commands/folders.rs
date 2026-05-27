use std::collections::HashSet;
use std::sync::Mutex;

use tauri::{Emitter, State};
use uuid::Uuid;

use crate::{models::{Folder, FolderRecord, SortOrder}, AppState};

fn folder_from_record(record: &FolderRecord, note_count: u32) -> Folder {
    Folder {
        id: record.id.clone(),
        name: record.name.clone(),
        parent_id: record.parent_id.clone(),
        sort_order: record.sort_order,
        note_count,
        icon: record.icon.clone(),
    }
}

#[tauri::command]
pub async fn list_folders(state: State<'_, Mutex<AppState>>) -> Result<Vec<Folder>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let all_notes = state.vault.list_notes(None, SortOrder::UpdatedDesc)?;
    Ok(state.vault.meta.folders.iter().map(|f| {
        let count = all_notes.iter().filter(|n| n.folder_id.as_ref() == Some(&f.id)).count() as u32;
        folder_from_record(f, count)
    }).collect())
}

#[tauri::command]
pub async fn create_folder(name: String, parent_id: Option<String>, icon: Option<String>, state: State<'_, Mutex<AppState>>) -> Result<Folder, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref parent) = parent_id {
        if !state.vault.meta.folders.iter().any(|f| &f.id == parent) {
            return Err("parent folder not found".into());
        }
    }
    let sort_order = state.vault.meta.folders.len() as u32;
    let record = FolderRecord { id: Uuid::new_v4().to_string(), name, parent_id, sort_order, icon };
    state.vault.meta.folders.push(record.clone());
    state.vault.save_meta()?;
    Ok(folder_from_record(&record, 0))
}

#[tauri::command]
pub async fn rename_folder(id: String, name: String, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>) -> Result<Folder, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    let folder = state.vault.meta.folders.iter_mut().find(|f| f.id == id).ok_or("folder not found")?;
    folder.name = name.clone();
    let out = folder_from_record(folder, 0);
    state.vault.save_meta()?;
    let _ = app.emit("folder-renamed", &out);
    Ok(out)
}

#[tauri::command]
pub async fn update_folder_icon(id: String, icon: Option<String>, state: State<'_, Mutex<AppState>>) -> Result<Folder, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    let folder = state.vault.meta.folders.iter_mut().find(|f| f.id == id).ok_or("folder not found")?;
    folder.icon = icon;
    let out = folder_from_record(folder, 0);
    state.vault.save_meta()?;
    Ok(out)
}

#[tauri::command]
pub async fn move_folder(id: String, parent_id: Option<String>, position: Option<u32>, state: State<'_, Mutex<AppState>>) -> Result<Folder, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    if id == "archive" {
        return Err("archive folder cannot be moved".into());
    }
    if parent_id.as_ref() == Some(&id) {
        return Err("folder cannot be nested inside itself".into());
    }
    if let Some(ref parent) = parent_id {
        if !state.vault.meta.folders.iter().any(|f| &f.id == parent) {
            return Err("parent folder not found".into());
        }
        let mut descendants = HashSet::from([id.clone()]);
        let mut changed = true;
        while changed {
            changed = false;
            for folder in &state.vault.meta.folders {
                if folder.parent_id.as_ref().is_some_and(|p| descendants.contains(p)) && descendants.insert(folder.id.clone()) {
                    changed = true;
                }
            }
        }
        if descendants.contains(parent) {
            return Err("folder cannot be nested inside its own descendant".into());
        }
    }

    if !state.vault.meta.folders.iter().any(|f| f.id == id) {
        return Err("folder not found".into());
    }
    {
        let folder = state.vault.meta.folders.iter_mut().find(|f| f.id == id).unwrap();
        folder.parent_id = parent_id.clone();
    }

    let mut ordered: Vec<(u32, String)> = state.vault.meta.folders.iter()
        .filter(|f| f.parent_id == parent_id && f.id != id)
        .map(|f| (f.sort_order, f.id.clone()))
        .collect();
    ordered.sort_by_key(|(order, _)| *order);
    let mut siblings: Vec<String> = ordered.into_iter().map(|(_, id)| id).collect();
    let insert_at = position
        .map(|p| (p as usize).min(siblings.len()))
        .unwrap_or(siblings.len());
    siblings.insert(insert_at, id.clone());

    for (index, sibling_id) in siblings.iter().enumerate() {
        if let Some(record) = state.vault.meta.folders.iter_mut().find(|f| &f.id == sibling_id) {
            record.sort_order = index as u32;
        }
    }

    let folder = state.vault.meta.folders.iter().find(|f| f.id == id).unwrap();
    let out = folder_from_record(folder, 0);
    state.vault.save_meta()?;
    Ok(out)
}

#[tauri::command]
pub async fn delete_folder(id: String, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    if id == "archive" {
        return Err("archive folder cannot be deleted".into());
    }

    let mut state = state.lock().map_err(|e| e.to_string())?;
    if !state.vault.meta.folders.iter().any(|f| f.id == id) {
        return Err("folder not found".into());
    }

    let mut to_delete = HashSet::from([id.clone()]);
    let mut changed = true;
    while changed {
        changed = false;
        for folder in &state.vault.meta.folders {
            if folder.parent_id.as_ref().is_some_and(|parent| to_delete.contains(parent)) && to_delete.insert(folder.id.clone()) {
                changed = true;
            }
        }
    }

    let all_notes = state.vault.list_notes(None, SortOrder::UpdatedDesc)?;
    for note in all_notes {
        if note.folder_id.as_ref().is_some_and(|folder_id| to_delete.contains(folder_id)) {
            state.vault.update_note_folder(&note.id, None)?;
        }
    }

    state.vault.meta.folders.retain(|f| !to_delete.contains(&f.id));
    state.vault.save_meta()
}
