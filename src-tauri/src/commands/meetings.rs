use std::sync::Mutex;
use tauri::{Emitter, State};
use tagdown_core::meetings::{CalendarEvent, CreatedMeeting, MeetingDraft};
use crate::{AppState, commands::search::SearchState};

#[tauri::command]
pub async fn read_calendar_file(path: String, state: State<'_, Mutex<AppState>>) -> Result<Vec<CalendarEvent>, String> {
    let file = std::path::PathBuf::from(path);
    if file.extension().and_then(|e| e.to_str()).is_none_or(|e| !e.eq_ignore_ascii_case("ics")) { return Err("Choose an iCalendar (.ics) file.".into()); }
    if std::fs::metadata(&file).map_err(|e| e.to_string())?.len() > 5_000_000 { return Err("Calendar files must be smaller than 5 MB.".into()); }
    let raw = std::fs::read_to_string(file).map_err(|e| format!("Could not read the calendar: {e}"))?;
    state.lock().map_err(|e| e.to_string())?.vault.calendar_events(&raw)
}

#[tauri::command]
pub async fn create_meeting(draft: MeetingDraft, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>, search: State<'_, SearchState>) -> Result<CreatedMeeting, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let result = state.vault.create_meeting(draft)?;
    for note in &result.changed {
        let content = state.vault.get_note_content(&note.id)?.content;
        search.index(note, &content);
        let _ = app.emit("note-changed-externally", serde_json::json!({"note": note, "content": content}));
    }
    Ok(result)
}
