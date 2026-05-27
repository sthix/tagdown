use std::sync::Mutex;

mod commands;
mod frontmatter;
mod models;
mod search_index;
mod vault;

use vault::Vault;

pub struct AppState {
    pub vault: Vault,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let vault = Vault::open_or_create_default().expect("failed to open or create default vault");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(AppState { vault }))
        .invoke_handler(tauri::generate_handler![
            commands::notes::list_notes,
            commands::notes::get_note_content,
            commands::notes::create_note,
            commands::notes::save_note,
            commands::notes::move_note,
            commands::notes::star_note,
            commands::notes::delete_note,
            commands::notes::destroy_note,
            commands::folders::list_folders,
            commands::folders::create_folder,
            commands::folders::rename_folder,
            commands::folders::update_folder_icon,
            commands::folders::move_folder,
            commands::folders::delete_folder,
            commands::search::search,
            commands::tags::list_tags,
            commands::tags::create_tag,
            commands::tags::delete_tag,
            commands::export::export_html,
            commands::export::export_pdf,
            commands::export::reveal_vault,
            commands::export::reveal_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
