use std::sync::{Arc, Mutex};

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

mod commands;

// The vault lives in `tagdown-core`; re-exported so commands can use `crate::models` etc.
pub use tagdown_core::{history, journal, links, models, properties, query, search_index, site, tasks, types, vault, vaults, watcher, weblink};

use commands::search::SearchState;
use search_index::SearchIndex;
use vault::Vault;

pub struct AppState {
    pub vault: Vault,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let vault = Vault::open_or_create_active().expect("failed to open or create the vault");
    let search = open_search_index(&vault);
    let (watch_vault, watch_search) = (vault.clone(), search.0.clone());
    let vault_root = vault.root.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(AppState { vault }))
        .manage(search)
        .menu(app_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            // Tabs live in the page; it handles these.
            id @ ("new-tab" | "close-tab") => { let _ = app.emit("menu", id); }
            "close-window" => {
                if let Some(window) = app.get_webview_window("main") { let _ = window.close(); }
            }
            _ => {}
        })
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
            commands::notes::set_property,
            commands::notes::star_note,
            commands::notes::delete_note,
            commands::notes::destroy_note,
            commands::notes::open_journal,
            commands::notes::journal_day,
            commands::notes::append_to_journal,
            commands::notes::save_web_link,
            commands::notes::list_types,
            commands::notes::create_typed_note,
            commands::notes::apply_type,
            commands::folders::list_folders,
            commands::folders::create_folder,
            commands::folders::rename_folder,
            commands::folders::update_folder_icon,
            commands::folders::move_folder,
            commands::folders::delete_folder,
            commands::search::search,
            commands::links::backlinks,
            commands::links::local_graph,
            commands::links::block_ref,
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
            commands::vaults::list_vaults,
            commands::vaults::open_vault,
            commands::vaults::forget_vault,
            commands::attachments::save_attachment,
            commands::attachments::import_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The standard macOS menu, except that ⌘W closes a tab (⇧⌘W the window) and ⌘T opens one.
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        ..Default::default()
    };
    let close_window = MenuItem::with_id(app, "close-window", "Close Window", true, Some("CmdOrCtrl+Shift+W"))?;
    Menu::with_items(app, &[
        &Submenu::with_items(app, info.name.clone(), true, &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ])?,
        &Submenu::with_items(app, "File", true, &[
            &MenuItem::with_id(app, "new-tab", "New Tab", true, Some("CmdOrCtrl+T"))?,
            &MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?,
            &PredefinedMenuItem::separator(app)?,
            &close_window,
        ])?,
        &Submenu::with_items(app, "Edit", true, &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ])?,
        &Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?,
        &Submenu::with_items(app, "Window", true, &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ])?,
    ])
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
