use std::{path::PathBuf, sync::Mutex};

use serde::Serialize;
use tauri::State;

use crate::{
    vault::Vault,
    vaults::{is_vault, VaultList},
    AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub path: String,
    pub name: String,
    pub active: bool,
    /// False when the folder is gone (deleted, or on a drive that isn't mounted).
    pub available: bool,
}

/// Every vault the app knows, the open one marked.
#[tauri::command]
pub async fn list_vaults(state: State<'_, Mutex<AppState>>) -> Result<Vec<VaultEntry>, String> {
    let open = state.lock().map_err(|e| e.to_string())?.vault.root.clone();
    let mut list = VaultList::load();
    // The open vault may be a fallback for a missing one; it still belongs on the list.
    if !list.vaults.contains(&open) {
        list.vaults.push(open.clone());
    }
    Ok(list
        .vaults
        .iter()
        .map(|path| VaultEntry {
            path: path.display().to_string(),
            name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string()),
            active: *path == open,
            available: is_vault(path),
        })
        .collect())
}

/// Open the folder at `path` as the vault, making it one if it isn't yet, and
/// relaunch so every part of the app (index, watcher, images) moves over.
#[tauri::command]
pub async fn open_vault(path: String, app: tauri::AppHandle, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    let open = state.lock().map_err(|e| e.to_string())?.vault.root.clone();
    let mut list = VaultList::load();
    if root == open {
        // Already open; only make it stick for the next launch.
        list.activate(root);
        return list.save();
    }
    if root.starts_with(&open) || open.starts_with(&root) {
        return Err("a vault can't sit inside another vault".into());
    }
    Vault::open_or_create(root.clone())?;
    list.activate(root);
    list.save()?;
    app.restart();
}

/// Take a vault off the list. Its folder and notes are left alone.
#[tauri::command]
pub async fn forget_vault(path: String, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let root = PathBuf::from(path);
    if state.lock().map_err(|e| e.to_string())?.vault.root == root {
        return Err("switch to another vault before removing this one".into());
    }
    let mut list = VaultList::load();
    list.forget(&root);
    list.save()
}
