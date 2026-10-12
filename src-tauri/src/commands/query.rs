use std::sync::Mutex;

use tauri::State;

use crate::{
    commands::search::SearchState,
    models::Note,
    query::{self, QueryOutput},
    tasks, AppState,
};

/// Results for a `<query … />` block in the note `exclude_id`.
#[tauri::command]
pub async fn run_query(query: String, exclude_id: Option<String>, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<QueryOutput, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let notes = state.vault.notes_with_content()?;
    query::run(&query, notes, search.0.as_deref(), &state.vault.meta.folders, exclude_id.as_deref())
}

/// Tick or untick a task in any note, as long as `line` still holds `text`.
#[tauri::command]
pub async fn set_task_done(id: String, line: usize, text: String, done: bool, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<Note, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let content = state.vault.get_note_content(&id)?.content;
    let next = tasks::set_task_done(&content, line, &text, done)?;
    let note = state.vault.save_note(&id, next.clone())?;
    search.index(&note, &next);
    Ok(note)
}
