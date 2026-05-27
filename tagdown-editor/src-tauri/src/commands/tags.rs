use std::sync::Mutex;

use tauri::State;

use crate::{models::{Tag, TagRecord}, AppState};

fn tag_from_record(record: &TagRecord) -> Tag {
    Tag { id: record.id.clone(), name: record.name.clone(), color: record.color.clone() }
}

fn slugify(name: &str) -> String {
    let base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '/' { c } else { '-' })
        .collect();
    let trimmed = base.trim_matches('-').to_string();
    let mut out = String::with_capacity(trimmed.len());
    let mut prev_dash = false;
    for c in trimmed.chars() {
        if c == '-' {
            if !prev_dash { out.push('-'); }
            prev_dash = true;
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    if out.is_empty() { "tag".into() } else { out }
}

#[tauri::command]
pub async fn list_tags(state: State<'_, Mutex<AppState>>) -> Result<Vec<Tag>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.vault.meta.tags.iter().map(tag_from_record).collect())
}

#[tauri::command]
pub async fn create_tag(name: String, color: String, state: State<'_, Mutex<AppState>>) -> Result<Tag, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    let base = slugify(&name);
    let mut id = base.clone();
    let mut n = 2;
    while state.vault.meta.tags.iter().any(|t| t.id == id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    let record = TagRecord { id, name: name.trim().to_string(), color };
    state.vault.meta.tags.push(record.clone());
    state.vault.save_meta()?;
    Ok(tag_from_record(&record))
}

#[tauri::command]
pub async fn delete_tag(id: String, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    let before = state.vault.meta.tags.len();
    state.vault.meta.tags.retain(|t| t.id != id);
    if state.vault.meta.tags.len() == before {
        return Err("tag not found".into());
    }
    state.vault.save_meta()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_keeps_nested_paths() {
        assert_eq!(slugify("Notes/Chemistry"), "notes/chemistry");
        assert_eq!(slugify("Hello World"), "hello-world");
    }
}
