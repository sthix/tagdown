//! Shared opt-out policy for integrated AI and AI-facing vault access.
use crate::{models::Note, properties::PropertyValue};

/// Archived notes and any truthy or malformed `ai_exclude` value are private.
pub fn note_allows_ai(note: &Note) -> bool {
    note.folder_id.as_deref() != Some("archive") && !note.properties.iter().any(|p| p.key.eq_ignore_ascii_case("ai_exclude") && match &p.value {
        PropertyValue::Checkbox(value) => *value,
        PropertyValue::Text(value) => !matches!(value.trim().to_ascii_lowercase().as_str(), "false" | "no" | "0"),
        _ => true,
    })
}

/// Duplicate IDs can make a later vault lookup read a different file. Keep all
/// copies out of AI-facing operations until their IDs are made unique.
pub fn visible_notes(notes: Vec<(Note, String)>) -> Vec<(Note, String)> {
    let mut counts = std::collections::HashMap::new();
    for (note, _) in &notes { *counts.entry(note.id.clone()).or_insert(0usize) += 1; }
    notes.into_iter().filter(|(note, _)| counts.get(&note.id) == Some(&1) && note_allows_ai(note)).collect()
}
