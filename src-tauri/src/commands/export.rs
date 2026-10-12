use std::{fs, sync::Mutex};

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::AppState;

/// Write an export the frontend rendered (standalone HTML) to the chosen path.
#[tauri::command]
pub async fn export_html(html: String, dest_path: String) -> Result<String, String> {
    fs::write(&dest_path, html).map_err(|e| e.to_string())?;
    Ok(dest_path)
}

#[tauri::command]
pub async fn reveal_vault(app: tauri::AppHandle, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let root = state.lock().map_err(|e| e.to_string())?.vault.root.clone();
    app.opener().reveal_item_in_dir(root).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reveal_note(id: String, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let path = state.lock().map_err(|e| e.to_string())?.vault.note_file_path(&id)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}
