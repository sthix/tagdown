use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

mod commands;

// The vault lives in `tagdown-core`; re-exported so commands can use `crate::models` etc.
pub use tagdown_core::{history, journal, links, models, query, search_index, site, tasks, vault, watcher};

use commands::search::SearchState;
use search_index::SearchIndex;
use vault::Vault;

pub struct AppState {
    pub vault: Vault,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let vault = Vault::open_or_create_default().expect("failed to open or create default vault");
    let search = open_search_index(&vault);
    let (watch_vault, watch_search) = (vault.clone(), search.0.clone());
    let vault_root = vault.root.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(AppState { vault }))
        .manage(search)
        .setup(move |app| {
            // Images in notes load from the vault through the asset protocol.
            app.asset_protocol_scope().allow_directory(&vault_root, true)?;
            let handle = app.handle().clone();
            let emit = move |event: &'static str, payload: serde_json::Value| { let _ = handle.emit(event, payload); };
            match watcher::start(watch_vault, watch_search, emit) {
                Ok(watcher) => { app.manage(watcher); }
                Err(e) => eprintln!("vault watcher unavailable: {e}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::notes::list_notes,
            commands::notes::get_note_content,
            commands::notes::create_note,
            commands::notes::save_note,
            commands::notes::move_note,
            commands::notes::star_note,
            commands::notes::delete_note,
            commands::notes::destroy_note,
            commands::notes::open_journal,
            commands::folders::list_folders,
            commands::folders::create_folder,
            commands::folders::rename_folder,
            commands::folders::update_folder_icon,
            commands::folders::move_folder,
            commands::folders::delete_folder,
            commands::search::search,
            commands::links::backlinks,
            commands::query::run_query,
            commands::site::site_notes,
            commands::site::inspect_site_dir,
            commands::site::write_site,
            commands::query::set_task_done,
            commands::history::list_versions,
            commands::history::get_version,
            commands::history::snapshot_note,
            commands::history::restore_version,
            commands::links::rename_links,
            commands::tags::list_tags,
            commands::tags::create_tag,
            commands::tags::delete_tag,
            commands::export::export_html,
            commands::export::vault_path,
            commands::export::reveal_vault,
            commands::export::reveal_note,
            commands::attachments::save_attachment,
            commands::attachments::import_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Open the vault's search index and rebuild it from the notes on a background
/// thread, so launch isn't blocked and edits made outside the app are picked up.
fn open_search_index(vault: &Vault) -> SearchState {
    let index = match SearchIndex::open(&vault.root.join(".tagdown").join("search.idx")) {
        Ok(index) => Arc::new(index),
        Err(e) => {
            eprintln!("search index unavailable: {e}");
            return SearchState(None);
        }
    };
    let (rebuild, vault) = (index.clone(), vault.clone());
    std::thread::spawn(move || {
        if let Err(e) = vault.notes_with_content().and_then(|notes| rebuild.rebuild(notes)) {
            eprintln!("search index rebuild failed: {e}");
        }
    });
    SearchState(Some(index))
}
