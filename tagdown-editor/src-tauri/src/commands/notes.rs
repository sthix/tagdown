use std::sync::Mutex;

use tauri::{Emitter, State};

use crate::{models::{Note, NoteContent, SortOrder}, AppState};

#[tauri::command]
pub async fn list_notes(folder_id: Option<String>, sort: SortOrder, state: State<'_, Mutex<AppState>>) -> Result<Vec<Note>, String> {
    state.lock().map_err(|e| e.to_string())?.vault.list_notes(folder_id, sort)
}

#[tauri::command]
pub async fn get_note_content(id: String, state: State<'_, Mutex<AppState>>) -> Result<NoteContent, String> {
    state.lock().map_err(|e| e.to_string())?.vault.get_note_content(&id)
}

#[tauri::command]
pub async fn create_note(folder_id: Option<String>, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>) -> Result<Note, String> {
    let note = state.lock().map_err(|e| e.to_string())?.vault.create_note(folder_id)?;
    let _ = app.emit("note-saved", &note);
    Ok(note)
}

#[tauri::command]
pub async fn save_note(id: String, content: String, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>) -> Result<Note, String> {
    let note = state.lock().map_err(|e| e.to_string())?.vault.save_note(&id, content)?;
    let _ = app.emit("note-saved", &note);
    Ok(note)
}

#[tauri::command]
pub async fn move_note(id: String, folder_id: Option<String>, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>) -> Result<Note, String> {
    let note = state.lock().map_err(|e| e.to_string())?.vault.update_note_folder(&id, folder_id)?;
    let _ = app.emit("note-moved", &note);
    Ok(note)
}

#[tauri::command]
pub async fn star_note(id: String, starred: bool, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>) -> Result<Note, String> {
    let note = state.lock().map_err(|e| e.to_string())?.vault.star_note(&id, starred)?;
    let _ = app.emit("note-saved", &note);
    Ok(note)
}

#[tauri::command]
pub async fn delete_note(id: String, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.vault.delete_note(&id)?;
    let _ = app.emit("note-deleted", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn destroy_note(id: String, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.vault.destroy_note(&id)
}
