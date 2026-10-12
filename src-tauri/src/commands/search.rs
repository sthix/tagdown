use std::sync::Arc;

use tauri::State;

use crate::{models::{Note, SearchResult}, search_index::SearchIndex};

/// The vault's search index; `None` when it could not be opened (for example
/// when another instance of the app holds the index lock).
pub struct SearchState(pub Option<Arc<SearchIndex>>);

impl SearchState {
    /// Index a note after it changed. Failures are logged, never surfaced:
    /// a stale search result must not fail a save.
    pub fn index(&self, note: &Note, content: &str) {
        if let Some(index) = &self.0 {
            if let Err(e) = index.upsert(note, content) {
                eprintln!("search index: failed to index note {}: {e}", note.id);
            }
        }
    }

    pub fn forget(&self, id: &str) {
        if let Some(index) = &self.0 {
            if let Err(e) = index.remove(id) {
                eprintln!("search index: failed to remove note {id}: {e}");
            }
        }
    }
}

#[tauri::command]
pub async fn search(query: String, search: State<'_, SearchState>) -> Result<Vec<SearchResult>, String> {
    match &search.0 {
        Some(index) => index.search(&query),
        None => Err("search index is unavailable".into()),
    }
}
