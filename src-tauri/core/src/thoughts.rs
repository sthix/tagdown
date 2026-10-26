//! A review queue derived from ordinary notes and their links.

use std::collections::{HashMap, HashSet};

use crate::{
    frontmatter::split_any,
    links::{links_from, LinkTargets},
    models::Note,
    properties::PropertyValue,
    types::template_type,
};

#[derive(Default)]
pub struct ReviewIndex {
    pub empty: HashSet<String>,
    pub unlinked: HashSet<String>,
    pub thoughts: HashMap<String, Vec<String>>,
}

pub fn can_review(note: &Note) -> bool {
    note.folder_id.as_deref() != Some("archive") && note.journal.is_none() && template_type(&note.title).is_none()
}

pub fn inbox(note: &Note) -> Option<bool> {
    note.properties.iter().find(|p| p.key.eq_ignore_ascii_case("inbox")).and_then(|p| {
        if let PropertyValue::Checkbox(value) = p.value { Some(value) } else { None }
    })
}

/// A real body can be prose, code, math, an image or an embed. A title and tags alone aren't a body.
pub fn has_body(content: &str) -> bool {
    let (_, body) = split_any(content);
    let mut fence: Option<&str> = None;
    for line in body.lines() {
        let text = line.trim();
        let marker = ["```", "~~~"].into_iter().find(|marker| text.starts_with(marker));
        if let Some(marker) = marker {
            if fence.is_none() { fence = Some(marker); }
            else if fence == Some(marker) { fence = None; }
            else { return true; }
            continue;
        }
        if text.is_empty() { continue; }
        if fence.is_some() { return true; }
        let heading = text.trim_start_matches('#');
        if heading.len() < text.len() && (heading.is_empty() || heading.starts_with(char::is_whitespace)) { continue; }
        if text.starts_with(":::") || text == "$$" || text.starts_with("<!--") && text.ends_with("-->") { continue; }
        if text.chars().all(|c| c.is_whitespace() || matches!(c, '-' | '*' | '_')) { continue; }
        if text.split_whitespace().all(|word| word.starts_with('#') && word.len() > 1) { continue; }
        let text = crate::links::strip_line_marker(text);
        if text.is_empty() || matches!(text, "[ ]" | "[x]" | "[X]") { continue; }
        if text.split_whitespace().all(|word| word.starts_with('#') && word.len() > 1) { continue; }
        if text.starts_with('^') && !text.contains(char::is_whitespace) { continue; }
        return true;
    }
    false
}

/// One whole-vault pass: connections count both ways, including property links, aliases and paths.
pub fn review_index(notes: &[(Note, String)]) -> ReviewIndex {
    let mut review = ReviewIndex::default();
    let live: Vec<_> = notes.iter().filter(|(n, _)| n.folder_id.as_deref() != Some("archive") && template_type(&n.title).is_none()).collect();
    let targets = LinkTargets::new(live.iter().map(|(n, _)| n));
    let mut connected = HashSet::new();
    for (note, body) in &live {
        for target in links_from(note, body, &targets) {
            connected.insert(note.id.clone());
            connected.insert(target);
        }
    }
    for (note, content) in notes {
        let empty = !has_body(content);
        let unlinked = !connected.contains(&note.id);
        if empty { review.empty.insert(note.id.clone()); }
        if unlinked { review.unlinked.insert(note.id.clone()); }
        if !can_review(note) || inbox(note) == Some(false) { continue; }
        let mut reasons = Vec::new();
        if inbox(note) == Some(true) { reasons.push("captured".into()); }
        if note.title.trim().is_empty() || note.title.trim().eq_ignore_ascii_case("untitled") { reasons.push("untitled".into()); }
        if empty { reasons.push("empty".into()); }
        if unlinked { reasons.push("unlinked".into()); }
        if !reasons.is_empty() { review.thoughts.insert(note.id.clone(), reasons); }
    }
    review
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::properties::Property;

    fn note(id: &str, title: &str, content: &str) -> (Note, String) {
        (Note { id: id.into(), title: title.into(), preview: String::new(), tags: vec![], starred: false,
            folder_id: None, created_at: Default::default(), updated_at: Default::default(), word_count: 0,
            journal: None, properties: vec![], path: format!("{id}.md") }, content.into())
    }

    #[test]
    fn body_detection_keeps_code_math_images_and_embeds_but_skips_scaffolding() {
        for body in ["", "# Title\n\n#tag/idea #other", "---\ninbox: true\n---\n# Title\n\n- [ ] ", "# Title\n\n::: tip\n:::\n\n---", "# Title\n\n^block"] {
            assert!(!has_body(body), "{body:?}");
        }
        for body in ["# Title\n\nAn idea.", "# Title\n\n```md\n# In code\n```", "# Title\n\n```\n[ ]\n```", "# Title\n\n$$\nx=2\n$$", "# Title\n\n![](attachments/a.png)", "# Title\n\n![[Other#^block]]", "# Title\n\n<query tag:idea />"] {
            assert!(has_body(body), "{body:?}");
        }
    }

    #[test]
    fn incoming_and_property_links_connect_notes_while_self_missing_and_archived_links_do_not() {
        let mut notes = vec![
            note("a", "Alpha", "# Alpha\n\nAn idea."),
            note("b", "Beta", "# Beta\n\nSee [[Alpha]]."),
            note("c", "Gamma", "# Gamma\n\nSee [[Gamma]], [[Missing]] and `[[Alpha]]`."),
            note("d", "Delta", "# Delta\n\nDetails."),
            note("e", "Epsilon", "# Epsilon\n\nDetails."),
            note("archive", "Old", "# Old\n\n[[Gamma]]"),
        ];
        notes[3].0.properties.push(Property { key: "related".into(), value: PropertyValue::Text("[[e]]".into()) });
        notes[5].0.folder_id = Some("archive".into());
        let review = review_index(&notes);
        assert_eq!(review.thoughts.len(), 1);
        assert_eq!(review.thoughts["c"], vec!["unlinked"]);
        for id in ["a", "b", "d", "e"] { assert!(!review.unlinked.contains(id), "{id}"); }
    }

    #[test]
    fn explicit_choices_override_heuristics_and_system_notes_stay_out() {
        let mut notes = vec![
            note("done", "Processed", "# Processed"),
            note("capture", "Capture", "# Capture\n\nSee [[Linked]]."),
            note("linked", "Linked", "# Linked\n\nDetails."),
            note("template", "Book Template", "# Book Template\n\n[[Lone]]"),
            note("journal", "2026-10-26", "# 2026-10-26"),
            note("lone", "Lone", "# Lone\n\nDetails."),
        ];
        for (at, value) in [(0, false), (1, true), (3, true), (4, true)] {
            notes[at].0.properties.push(Property { key: "inbox".into(), value: PropertyValue::Checkbox(value) });
        }
        notes[4].0.journal = chrono::NaiveDate::from_ymd_opt(2026, 10, 26);
        let review = review_index(&notes);
        assert!(!review.thoughts.contains_key("done"));
        assert_eq!(review.thoughts["capture"], vec!["captured"]);
        assert!(!review.thoughts.contains_key("template"));
        assert!(!review.thoughts.contains_key("journal"));
        assert!(review.thoughts.contains_key("lone"));
    }

    #[test]
    fn processing_and_sending_back_survive_reopening_without_changing_the_body() {
        use crate::{query, vault::Vault};
        let root = std::env::temp_dir().join(format!("tagdown-thoughts-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let body = "# An idea\n\nA thought to develop.\n";
        std::fs::write(root.join("Idea.md"), body).unwrap();
        let vault = Vault::open_or_create(root.clone()).unwrap();
        let initial = query::run("is:thought", vault.notes_with_content().unwrap(), None, &[], None).unwrap();
        let id = &initial.notes[0].id;
        vault.set_property(id, "inbox", Some(PropertyValue::Checkbox(false)), None).unwrap();
        let reopened = Vault::open_existing(root.clone()).unwrap();
        assert!(query::run("is:thought", reopened.notes_with_content().unwrap(), None, &[], None).unwrap().notes.is_empty());
        assert_eq!(reopened.get_note_content(id).unwrap().content, body);
        reopened.set_property(id, "inbox", Some(PropertyValue::Checkbox(true)), None).unwrap();
        let returned = query::run("is:thought", reopened.notes_with_content().unwrap(), None, &[], None).unwrap();
        assert_eq!(returned.notes.len(), 1);
        assert!(returned.notes[0].thought_reasons.contains(&"captured".into()));
        reopened.set_property(id, "inbox", None, None).unwrap();
        assert_eq!(reopened.get_note_content(id).unwrap().content, body);
        std::fs::remove_dir_all(root).unwrap();
    }
}
