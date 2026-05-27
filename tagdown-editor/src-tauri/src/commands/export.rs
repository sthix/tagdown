use std::{fs, sync::Mutex};

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::AppState;

#[tauri::command]
pub async fn export_html(id: String, dest_path: String, state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let content = state.vault.get_note_content(&id)?.content;
    let html = format!("<!doctype html><html><head><meta charset=\"utf-8\"><title>Tagdown Export</title></head><body><pre>{}</pre></body></html>", html_escape(&content));
    fs::write(&dest_path, html).map_err(|e| e.to_string())?;
    Ok(dest_path)
}

#[tauri::command]
pub async fn export_pdf(_id: String) -> Result<String, String> {
    Err("PDF export is deferred until a stable Tauri/macOS print-to-PDF path is selected".into())
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

fn html_escape(input: &str) -> String {
    input.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}
