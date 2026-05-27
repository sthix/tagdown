use std::sync::Mutex;

use tauri::State;

use crate::{models::{SearchResult, SortOrder}, search_index::search_notes, AppState};

#[tauri::command]
pub async fn search(query: String, state: State<'_, Mutex<AppState>>) -> Result<Vec<SearchResult>, String> {
    let notes = state.lock().map_err(|e| e.to_string())?.vault.list_notes(None, SortOrder::UpdatedDesc)?;
    Ok(search_notes(notes, &query))
}
