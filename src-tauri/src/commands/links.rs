use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::{
    commands::search::SearchState,
    links::{self, normalize_title, Backlink},
    models::Note,
    AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOutcome {
    /// False when the new title is not usable yet (empty, or another note's
    /// title); the caller should retry from the same old title later.
    applied: bool,
    /// Notes whose links were rewritten.
    updated: u32,
}

fn is_live(note: &Note) -> bool {
    note.folder_id.as_deref() != Some("archive")
}

/// Notes that link to `id`, most recently edited first.
#[tauri::command]
pub async fn backlinks(id: String, state: State<'_, Mutex<AppState>>) -> Result<Vec<Backlink>, String> {
    let notes = state.lock().map_err(|e| e.to_string())?.vault.notes_with_content()?;
    Ok(links::backlinks(notes, &id))
}

/// Point links at a note's new title after it was renamed.
#[tauri::command]
pub async fn rename_links(
    id: String,
    old_title: String,
    new_title: String,
    state: State<'_, Mutex<AppState>>,
    search: State<'_, SearchState>,
) -> Result<RenameOutcome, String> {
    let (old, new) = (normalize_title(&old_title), normalize_title(&new_title));
    if old.is_empty() || old == new {
        return Ok(RenameOutcome { applied: true, updated: 0 });
    }
    if new.is_empty() || new == "untitled" {
        return Ok(RenameOutcome { applied: false, updated: 0 });
    }
    let state = state.lock().map_err(|e| e.to_string())?;
    let notes = state.vault.notes_with_content()?;
    let others = || notes.iter().filter(|(note, _)| note.id != id && is_live(note));
    // Moving links onto a title another note has would hijack them; wait until
    // the title is unique (the user may still be typing).
    if others().any(|(note, _)| normalize_title(&note.title) == new) {
        return Ok(RenameOutcome { applied: false, updated: 0 });
    }
    // Links to a title another note shares are ambiguous: leave them alone.
    if others().any(|(note, _)| normalize_title(&note.title) == old) {
        return Ok(RenameOutcome { applied: true, updated: 0 });
    }
    let mut updated = 0;
    // The renamed note itself is skipped: its editor owns its content.
    for (note, content) in notes.iter().filter(|(note, _)| note.id != id) {
        if let Some(next) = links::rename_links(content, &old_title, &new_title) {
            let saved = state.vault.rewrite_content(&note.id, &next)?;
            search.index(&saved, &next);
            updated += 1;
        }
    }
    Ok(RenameOutcome { applied: true, updated })
}
