use crate::models::{Note, SearchResult};

pub fn search_notes(notes: Vec<Note>, query: &str) -> Vec<SearchResult> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }

    notes
        .into_iter()
        .filter_map(|note| {
            let haystack = format!("{} {} {}", note.title, note.preview, note.tags.join(" ")).to_lowercase();
            haystack.contains(&q).then(|| SearchResult {
                excerpt: note.preview.clone(),
                score: if note.title.to_lowercase().contains(&q) { 2.0 } else { 1.0 },
                note,
            })
        })
        .take(20)
        .collect()
}
