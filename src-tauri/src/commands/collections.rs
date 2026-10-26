use std::sync::Mutex;
use tauri::State;
use tagdown_core::collections::Collection;

use crate::{commands::search::SearchState, query, AppState};

#[tauri::command]
pub async fn list_collections(state: State<'_, Mutex<AppState>>) -> Result<Vec<Collection>, String> {
    state.lock().map_err(|e| e.to_string())?.vault.list_collections()
}

/// Rules are checked without reading the notes, so changing a layout stays quick in a large vault.
#[tauri::command]
pub async fn save_collection(id: Option<String>, name: String, icon: String, query: String, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<Collection, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    query::validate(&query, search.0.as_deref(), &state.vault.meta.folders)?;
    state.vault.save_collection(id.as_deref(), &name, &icon, &query)
}

#[tauri::command]
pub async fn delete_collection(id: String, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.vault.delete_collection(&id)
}
