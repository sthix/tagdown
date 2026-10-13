use std::sync::Mutex;

use tauri::{Emitter, State};

use crate::{commands::search::SearchState, models::{Note, NoteContent, SortOrder}, AppState};

#[tauri::command]
pub async fn list_notes(folder_id: Option<String>, sort: SortOrder, state: State<'_, Mutex<AppState>>) -> Result<Vec<Note>, String> {
    state.lock().map_err(|e| e.to_string())?.vault.list_notes(folder_id, sort)
}

#[tauri::command]
pub async fn get_note_content(id: String, state: State<'_, Mutex<AppState>>) -> Result<NoteContent, String> {
    state.lock().map_err(|e| e.to_string())?.vault.get_note_content(&id)
}

#[tauri::command]
pub async fn create_note(folder_id: Option<String>, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<Note, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let note = state.vault.create_note(folder_id)?;
    search.index(&note, &state.vault.get_note_content(&note.id)?.content);
    let _ = app.emit("note-saved", &note);
    Ok(note)
}

#[tauri::command]
pub async fn save_note(id: String, content: String, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<Note, String> {
    let note = state.lock().map_err(|e| e.to_string())?.vault.save_note(&id, content.clone())?;
    search.index(&note, &content);
    let _ = app.emit("note-saved", &note);
    Ok(note)
}

#[tauri::command]
pub async fn move_note(id: String, folder_id: Option<String>, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<Note, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let note = state.vault.update_note_folder(&id, folder_id)?;
    search.index(&note, &state.vault.get_note_content(&id)?.content);
    let _ = app.emit("note-moved", &note);
    Ok(note)
}

#[tauri::command]
pub async fn star_note(id: String, starred: bool, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<Note, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let note = state.vault.star_note(&id, starred)?;
    search.index(&note, &state.vault.get_note_content(&id)?.content);
    let _ = app.emit("note-saved", &note);
    Ok(note)
}

#[tauri::command]
pub async fn delete_note(id: String, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.vault.delete_note(&id)?;
    // Archived notes are not searchable.
    search.forget(&id);
    let _ = app.emit("note-deleted", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn destroy_note(id: String, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.vault.destroy_note(&id)?;
    search.forget(&id);
    Ok(())
}

/// The journal page for `day` (YYYY-MM-DD), created from the template when it doesn't exist yet.
#[tauri::command]
pub async fn open_journal(day: String, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<Note, String> {
    let day = crate::journal::parse_day(&day).ok_or_else(|| format!("not a day: {day}"))?;
    let state = state.lock().map_err(|e| e.to_string())?;
    let (note, created) = state.vault.open_journal(day)?;
    if created {
        search.index(&note, &state.vault.get_note_content(&note.id)?.content);
        let _ = app.emit("note-saved", &note);
    }
    Ok(note)
}
