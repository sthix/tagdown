// Note types, in the spirit of Capacities' object types but kept as plain
// text. A note's type is its `type:` property (`type: Book`). A note titled
// "<Type> Template" ("Book Template") says how new notes of that type start:
// with its properties and their values, and with its body, where `{{title}}`,
// `{{date}}`, `{{weekday}}`, `{{yesterday}}` and `{{tomorrow}}` are filled in.
// The template's own `icon:` (an emoji) is the type's icon; new notes don't get it.

use std::collections::HashMap;

use chrono::{Local, NaiveDate};
use serde::Serialize;

use crate::{
    journal::{fill_template, strip_title, TEMPLATE_TITLE},
    links::normalize_title,
    models::Note,
    properties::{parse_scalar, Property, PropertyValue},
    vault::Vault,
};

/// The property naming a note's type.
pub const TYPE_KEY: &str = "type";
/// A template's property naming its type's icon.
pub const ICON_KEY: &str = "icon";
const TEMPLATE_SUFFIX: &str = " template";
const ARCHIVE: &str = "archive";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteType {
    pub name: String,
    pub icon: Option<String>,
    /// The note titled "<name> Template", if there is one.
    pub template_id: Option<String>,
    /// Notes of this type, outside the Archive and besides the template.
    pub count: usize,
}

/// The type a note says it is: its `type:` text (a `[[link]]` counts by its title).
pub fn type_of(note: &Note) -> Option<String> {
    let value = note.properties.iter().find(|p| p.key.eq_ignore_ascii_case(TYPE_KEY))?;
    let PropertyValue::Text(text) = &value.value else { return None };
    let text = text.trim();
    let text = text.strip_prefix("[[").and_then(|t| t.strip_suffix("]]")).map_or(text, |inner| inner.split('|').next().unwrap_or(inner)).trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// The type a template's title defines: "Book Template" defines "Book". The
/// Journal Template is the journal's, not a type's.
pub fn template_type(title: &str) -> Option<String> {
    let title = title.trim();
    if normalize_title(title) == normalize_title(TEMPLATE_TITLE) {
        return None;
    }
    let cut = title.len().checked_sub(TEMPLATE_SUFFIX.len())?;
    let (name, suffix) = (title.get(..cut)?, title.get(cut..)?);
    (suffix.eq_ignore_ascii_case(TEMPLATE_SUFFIX) && !name.trim().is_empty()).then(|| name.trim().to_string())
}

/// Every type in use or with a template, by name. Archived notes don't count.
pub fn list_types(notes: &[Note]) -> Vec<NoteType> {
    let live: Vec<&Note> = notes.iter().filter(|n| n.folder_id.as_deref() != Some(ARCHIVE)).collect();
    let mut types: Vec<NoteType> = Vec::new();
    let mut spellings: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for note in &live {
        if let Some(name) = template_type(&note.title) {
            if !types.iter().any(|t| normalize_title(&t.name) == normalize_title(&name)) {
                let icon = note.properties.iter().find(|p| p.key.eq_ignore_ascii_case(ICON_KEY)).map(|p| p.value.display()).filter(|i| !i.trim().is_empty());
                types.push(NoteType { name, icon, template_id: Some(note.id.clone()), count: 0 });
            }
            continue;
        }
        if let Some(name) = type_of(note) {
            *spellings.entry(normalize_title(&name)).or_default().entry(name).or_default() += 1;
        }
    }
    for (key, counts) in spellings {
        let count = counts.values().sum();
        match types.iter_mut().find(|t| normalize_title(&t.name) == key) {
            Some(t) => t.count = count,
            None => {
                // The spelling most notes use, alphabetically first on a tie.
                let name = counts.iter().max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0))).map(|(n, _)| n.clone()).unwrap_or(key);
                types.push(NoteType { name, icon: None, template_id: None, count });
            }
        }
    }
    types.sort_by_key(|t| t.name.to_lowercase());
    types
}

/// What a note of type `name` titled `title` starts with, from `template`
/// (its note and body): the properties (`type:` first) and the body below the title.
pub fn from_template(name: &str, title: &str, template: Option<(&Note, &str)>, day: NaiveDate) -> (Vec<Property>, String) {
    let fill = |text: &str| fill_template(text, day).replace("{{title}}", title);
    let mut properties = vec![Property { key: TYPE_KEY.into(), value: PropertyValue::Text(name.into()) }];
    let Some((note, content)) = template else { return (properties, String::new()) };
    for p in &note.properties {
        if p.key.eq_ignore_ascii_case(TYPE_KEY) || p.key.eq_ignore_ascii_case(ICON_KEY) {
            continue;
        }
        let value = match &p.value {
            // `due: "{{date}}"` becomes a date once filled in.
            PropertyValue::Text(t) if t.contains("{{") => parse_scalar(&fill(t)),
            PropertyValue::List(items) => PropertyValue::List(items.iter().map(|i| fill(i)).collect()),
            other => other.clone(),
        };
        properties.push(Property { key: p.key.clone(), value });
    }
    (properties, fill(&strip_title(content)))
}

impl Vault {
    pub fn note_types(&self) -> Result<Vec<NoteType>, String> {
        let notes: Vec<Note> = self.notes_with_content()?.into_iter().map(|(n, _)| n).collect();
        Ok(list_types(&notes))
    }

    /// The template note for the type `name`, with its body.
    fn type_template(&self, name: &str) -> Result<Option<(Note, String)>, String> {
        let wanted = normalize_title(name);
        Ok(self.notes_with_content()?.into_iter().find(|(n, _)| {
            n.folder_id.as_deref() != Some(ARCHIVE) && template_type(&n.title).is_some_and(|t| normalize_title(&t) == wanted)
        }))
    }

    /// A new note of the type `name` titled `title`, started from the type's template.
    pub fn create_typed_note(&self, name: &str, title: &str, folder_id: Option<String>) -> Result<Note, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("A type needs a name.".into());
        }
        let title = if title.trim().is_empty() { "Untitled" } else { title.trim() };
        let template = self.type_template(name)?;
        // The template's spelling of the type, so notes agree with it.
        let name = template.as_ref().and_then(|(n, _)| template_type(&n.title)).unwrap_or_else(|| name.to_string());
        let (properties, body) = from_template(&name, title, template.as_ref().map(|(n, c)| (n, c.as_str())), Local::now().date_naive());
        let content = format!("# {title}\n\n{}", body.trim());
        self.create_note_with(folder_id, &format!("{}\n", content.trim_end()), None, &properties)
    }

    /// Give a note its type's properties that it doesn't have yet (with the
    /// template's values), say after its `type:` was set. Its body is left alone.
    pub fn apply_type(&self, id: &str) -> Result<(Note, Vec<String>), String> {
        let note = self.notes_with_content()?.into_iter().map(|(n, _)| n).find(|n| n.id == id).ok_or_else(|| format!("no note with id {id}"))?;
        let Some(name) = type_of(&note) else { return Ok((note, Vec::new())) };
        let Some((template, content)) = self.type_template(&name)? else { return Ok((note, Vec::new())) };
        if template.id == note.id {
            return Ok((note, Vec::new()));
        }
        let (properties, _) = from_template(&name, &note.title, Some((&template, &content)), Local::now().date_naive());
        self.add_properties(id, &properties[1..])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (Vault, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("tagdown-types-{}", uuid::Uuid::new_v4()));
        (Vault::open_or_create(root.clone()).unwrap(), root)
    }

    fn write(vault: &Vault, content: &str, properties: &[(&str, &str)]) -> Note {
        let note = vault.create_note(None).unwrap();
        vault.save_note(&note.id, content.into()).unwrap();
        let mut last = None;
        for (key, value) in properties {
            last = Some(vault.set_property(&note.id, key, Some(parse_scalar(value)), None).unwrap());
        }
        last.unwrap_or(note)
    }

    #[test]
    fn templates_name_types() {
        assert_eq!(template_type("Book Template"), Some("Book".into()));
        assert_eq!(template_type("reading list template"), Some("reading list".into()));
        assert_eq!(template_type("Journal Template"), None);
        assert_eq!(template_type("Template"), None);
        assert_eq!(template_type("Templates"), None);
    }

    #[test]
    fn lists_types_from_templates_and_notes() {
        let (vault, root) = vault();
        write(&vault, "# Book Template\n\nBy {{title}}", &[("icon", "📚"), ("author", "\"\"")]);
        write(&vault, "# Dune", &[("type", "book")]);
        write(&vault, "# Atlas", &[("type", "Project")]);
        write(&vault, "# Beacon", &[("type", "\"[[project]]\"")]);
        write(&vault, "# Comet", &[("type", "project")]);
        let types = vault.note_types().unwrap();
        assert_eq!(types, vec![
            NoteType { name: "Book".into(), icon: Some("📚".into()), template_id: types[0].template_id.clone(), count: 1 },
            NoteType { name: "project".into(), icon: None, template_id: None, count: 3 },
        ], "the template's spelling wins; otherwise the most used one");
        assert!(types[0].template_id.is_some());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn new_notes_start_from_the_template() {
        let (vault, root) = vault();
        write(&vault, "# Book Template\n\n## Notes on {{title}}\n\nStarted {{date}}.", &[("icon", "📚"), ("type", "Book"), ("rating", "0"), ("started", "\"{{date}}\""), ("shelves", "[to-read]")]);
        let note = vault.create_typed_note("book", "Dune", None).unwrap();
        let today = Local::now().date_naive();
        let content = vault.get_note_content(&note.id).unwrap().content;
        assert_eq!(content, format!("# Dune\n\n## Notes on Dune\n\nStarted {}.\n", today.format("%Y-%m-%d")));
        assert_eq!(note.properties, vec![
            Property { key: "type".into(), value: PropertyValue::Text("Book".into()) },
            Property { key: "rating".into(), value: PropertyValue::Number(0.0) },
            Property { key: "started".into(), value: PropertyValue::Date(today) },
            Property { key: "shelves".into(), value: PropertyValue::List(vec!["to-read".into()]) },
        ], "the type as the template spells it, no icon, placeholders filled");
        let plain = vault.create_typed_note("Recipe", "", None).unwrap();
        assert_eq!((plain.title.as_str(), plain.properties.len()), ("Untitled", 1), "a type without a template");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn setting_a_type_adds_its_missing_properties() {
        let (vault, root) = vault();
        write(&vault, "# Person Template", &[("icon", "🙂"), ("email", "\"\""), ("team", "Design")]);
        let note = write(&vault, "# Sam", &[("type", "person"), ("team", "Ops")]);
        let (note, added) = vault.apply_type(&note.id).unwrap();
        assert_eq!(added, vec!["email"]);
        assert_eq!(note.properties.iter().map(|p| (p.key.as_str(), p.value.display())).collect::<Vec<_>>(), vec![("type", "person".into()), ("team", "Ops".into()), ("email", String::new())]);
        let (_, again) = vault.apply_type(&note.id).unwrap();
        assert!(again.is_empty());
        std::fs::remove_dir_all(root).ok();
    }
}
