use std::sync::Mutex;

use tauri::{Emitter, State};

use crate::{commands::search::SearchState, models::{Note, NoteContent, SortOrder}, properties::PropertyValue, types::NoteType, AppState};

#[tauri::command]
pub async fn list_notes(folder_id: Option<String>, sort: SortOrder, state: State<'_, Mutex<AppState>>) -> Result<Vec<Note>, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    // A directory made in Finder must be a folder before its notes are listed.
    state.vault.sync_folders()?;
    state.vault.list_notes(folder_id, sort)
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

/// Set, rename (`rename_from`) or remove (`value: null`) one of a note's properties.
#[tauri::command]
pub async fn set_property(
    id: String,
    key: String,
    value: Option<PropertyValue>,
    rename_from: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, Mutex<AppState>>,
    search: State<'_, SearchState>,
) -> Result<Note, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let note = state.vault.set_property(&id, &key, value, rename_from.as_deref())?;
    search.index(&note, &state.vault.get_note_content(&id)?.content);
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

#[derive(serde::Serialize)]
pub struct Appended {
    note: Note,
    content: String,
}

/// Quick capture: add `text` to the end of `day`'s journal page, starting the page if needed.
#[tauri::command]
pub async fn append_to_journal(day: String, text: String, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<Appended, String> {
    let day = crate::journal::parse_day(&day).ok_or_else(|| format!("not a day: {day}"))?;
    if text.trim().is_empty() {
        return Err("nothing to add".into());
    }
    let state = state.lock().map_err(|e| e.to_string())?;
    let (note, content) = state.vault.append_to_journal(day, &text)?;
    search.index(&note, &content);
    Ok(Appended { note, content })
}

/// The notes and open tasks of `day` (YYYY-MM-DD), shown under its journal page `id`.
#[tauri::command]
pub async fn journal_day(day: String, id: String, state: State<'_, Mutex<AppState>>) -> Result<crate::journal::DaySummary, String> {
    let day = crate::journal::parse_day(&day).ok_or_else(|| format!("not a day: {day}"))?;
    let notes = state.lock().map_err(|e| e.to_string())?.vault.notes_with_content()?;
    Ok(crate::journal::day_summary(notes, day, &id, &chrono::Local))
}

/// Every note type: the ones with a "<Type> Template" note and the ones notes use.
#[tauri::command]
pub async fn list_types(state: State<'_, Mutex<AppState>>) -> Result<Vec<NoteType>, String> {
    state.lock().map_err(|e| e.to_string())?.vault.note_types()
}

/// A new note of a type, started from its template.
#[tauri::command]
pub async fn create_typed_note(type_name: String, title: String, folder_id: Option<String>, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<Note, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let note = state.vault.create_typed_note(&type_name, &title, folder_id)?;
    search.index(&note, &state.vault.get_note_content(&note.id)?.content);
    let _ = app.emit("note-saved", &note);
    Ok(note)
}

/// Give a note the properties of its type's template that it lacks; returns
/// the note and the names of the properties added.
#[tauri::command]
pub async fn apply_type(id: String, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<(Note, Vec<String>), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let (note, added) = state.vault.apply_type(&id)?;
    if !added.is_empty() {
        search.index(&note, &state.vault.get_note_content(&id)?.content);
        let _ = app.emit("note-saved", &note);
    }
    Ok((note, added))
}
