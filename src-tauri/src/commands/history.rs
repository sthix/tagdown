use std::sync::Mutex;

use chrono::Utc;
use tauri::State;

use crate::{commands::search::SearchState, history::Snapshot, models::Note, AppState};

/// Earlier versions of a note, newest first.
#[tauri::command]
pub async fn list_versions(id: String, state: State<'_, Mutex<AppState>>) -> Result<Vec<Snapshot>, String> {
    state.lock().map_err(|e| e.to_string())?.vault.history.list(&id)
}

#[tauri::command]
pub async fn get_version(id: String, version_id: String, state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    state.lock().map_err(|e| e.to_string())?.vault.history.read(&id, &version_id)
}

/// Keep `content` as a version, e.g. the side a conflict prompt discards.
#[tauri::command]
pub async fn snapshot_note(id: String, content: String, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.vault.history.snapshot(&id, &content, Utc::now())
}

/// Bring back an earlier version. The current one is kept first, so a
/// restore can itself be undone from the history.
#[tauri::command]
pub async fn restore_version(
    id: String,
    version_id: String,
    state: State<'_, Mutex<AppState>>,
    search: State<'_, SearchState>,
) -> Result<Note, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let vault = &state.vault;
    let restored = vault.history.read(&id, &version_id)?;
    let current = vault.get_note_content(&id)?.content;
    vault.history.snapshot(&id, &current, Utc::now())?;
    let note = vault.save_note(&id, restored.clone())?;
    search.index(&note, &restored);
    Ok(note)
}
