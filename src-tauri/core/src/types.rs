// Note types, in the spirit of Capacities' object types but kept as plain
// text. A note's type is its `type:` property (`type: Book`). A note titled
// "<Type> Template" ("Book Template") says how new notes of that type start:
// with its properties and their values, and with its body, where `{{title}}`,
// `{{date}}`, `{{weekday}}`, `{{yesterday}}` and `{{tomorrow}}` are filled in.
// The template's own `icon:` (an emoji) is the type's icon; new notes don't get it.
//
// A template property whose value links to a type, `author: "[[Person]]"` or
// `attendees: ["[[Person]]"]`, is a link field: in notes of the type it holds
// links to notes of that other type, and new notes start with it empty.

use std::collections::HashMap;

use chrono::{Local, NaiveDate};
use serde::Serialize;

use crate::{
    journal::{fill_template, strip_title},
    links::normalize_title,
    models::Note,
    properties::{parse_scalar, Property, PropertyValue},
    vault::Vault,
};

/// The property naming a note's type.
pub const TYPE_KEY: &str = "type";
/// A template's property naming its type's icon.
pub const ICON_KEY: &str = "icon";
pub const PARENT_KEY: &str = "extends";
pub const EXCLUDE_KEY: &str = "exclude";
const TEMPLATE_SUFFIX: &str = " template";
const ARCHIVE: &str = "archive";

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteType {
    pub name: String,
    pub icon: Option<String>,
    /// The note titled "<name> Template", if there is one.
    pub template_id: Option<String>,
    /// Notes of this type, outside the Archive and besides the template.
    pub count: usize,
    /// Properties that link to notes of another type, from the template.
    pub links: Vec<LinkField>,
    pub parent: Option<String>,
    pub ancestors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InheritedProperty {
    pub property: Property,
    pub source: String,
    pub enabled: bool,
    pub overridden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInheritance {
    pub parent: Option<String>,
    pub parents: Vec<String>,
    pub excluded: Vec<String>,
    pub inherited: Vec<InheritedProperty>,
    pub error: Option<String>,
}

struct ResolvedTemplate {
    fields: Vec<(Property, String)>,
    ancestors: Vec<String>,
    inherited: Vec<InheritedProperty>,
}

fn control_key(key: &str) -> bool {
    [TYPE_KEY, PARENT_KEY, EXCLUDE_KEY].iter().any(|k| key.eq_ignore_ascii_case(k))
}

fn parent_of(note: &Note) -> Option<String> {
    let PropertyValue::Text(text) = &note.properties.iter().find(|p| p.key.eq_ignore_ascii_case(PARENT_KEY))?.value else { return None };
    let text = text.trim();
    let text = text.strip_prefix("[[").and_then(|t| t.strip_suffix("]]")).map_or(text, |t| t.split('|').next().unwrap_or(t)).trim();
    let name = template_type(text).unwrap_or_else(|| text.to_string());
    (!name.is_empty()).then_some(name)
}

fn excluded_by(note: &Note) -> Vec<String> {
    match note.properties.iter().find(|p| p.key.eq_ignore_ascii_case(EXCLUDE_KEY)).map(|p| &p.value) {
        Some(PropertyValue::List(keys)) => keys.clone(),
        Some(PropertyValue::Text(key)) if !key.trim().is_empty() => vec![key.trim().into()],
        _ => Vec::new(),
    }
}

fn validate_parent(name: &str, parent: Option<&str>, templates: &[&Note]) -> Result<(), String> {
    let mut visiting = vec![normalize_title(name)];
    let mut next = parent.map(str::to_string);
    while let Some(parent) = next {
        let key = normalize_title(&parent);
        if visiting.contains(&key) || visiting.len() >= 128 {
            return Err("A template cannot inherit from itself or one of its children.".into());
        }
        visiting.push(key.clone());
        let note = templates.iter().find(|n| template_type(&n.title).is_some_and(|t| normalize_title(&t) == key))
            .ok_or_else(|| format!("There is no {parent} parent template. Restore it or choose another parent."))?;
        next = parent_of(note);
    }
    Ok(())
}

/// Resolve from the live template notes each time, so parent edits are inherited
/// without copying them into the child's file. A child's own properties win.
fn resolve_template(note: &Note, templates: &[&Note], visiting: &mut Vec<String>) -> Result<ResolvedTemplate, String> {
    let name = template_type(&note.title).ok_or("This note is not a template")?;
    let key = normalize_title(&name);
    if visiting.contains(&key) || visiting.len() >= 128 {
        return Err(format!("Template inheritance forms a cycle at {name}. Choose a different parent."));
    }
    visiting.push(key);
    let excluded = excluded_by(note);
    let mut fields = Vec::new();
    let mut ancestors = Vec::new();
    let mut inherited = Vec::new();
    if let Some(parent) = parent_of(note) {
        let parent_note = templates.iter().find(|n| template_type(&n.title).is_some_and(|t| normalize_title(&t) == normalize_title(&parent)))
            .ok_or_else(|| format!("The {parent} parent template is unavailable. Restore it or choose a different parent."))?;
        let resolved = resolve_template(parent_note, templates, visiting)?;
        ancestors.push(template_type(&parent_note.title).unwrap());
        ancestors.extend(resolved.ancestors);
        for (property, source) in resolved.fields {
            let enabled = !excluded.iter().any(|key| key.eq_ignore_ascii_case(&property.key));
            let overridden = note.properties.iter().any(|p| p.key.eq_ignore_ascii_case(&property.key));
            if !property.key.eq_ignore_ascii_case(ICON_KEY) {
                inherited.push(InheritedProperty { property: property.clone(), source: source.clone(), enabled, overridden });
            }
            if enabled { fields.push((property, source)); }
        }
    }
    for property in note.properties.iter().filter(|p| !control_key(&p.key)) {
        // A blank icon lets a child keep its parent's icon.
        if property.key.eq_ignore_ascii_case(ICON_KEY) && property.value.is_empty() { continue; }
        if let Some((value, source)) = fields.iter_mut().find(|(p, _)| p.key.eq_ignore_ascii_case(&property.key)) {
            *value = property.clone();
            *source = name.clone();
        } else { fields.push((property.clone(), name.clone())); }
    }
    visiting.pop();
    Ok(ResolvedTemplate { fields, ancestors, inherited })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkField {
    pub key: String,
    /// The type its notes are, as the type list spells it.
    pub target: String,
    /// A list of links rather than one.
    pub list: bool,
}

/// `[[Name]]` when `Name` is one of `types`, as `types` spells it.
fn type_link(text: &str, types: &[String]) -> Option<String> {
    let inner = text.trim().strip_prefix("[[")?.strip_suffix("]]")?;
    let name = inner.split('|').next().unwrap_or(inner).trim();
    types.iter().find(|t| normalize_title(t) == normalize_title(name)).cloned()
}

/// The link field a template property declares, if it is one.
fn link_field(property: &Property, types: &[String]) -> Option<LinkField> {
    let (target, list) = match &property.value {
        PropertyValue::Text(t) => (type_link(t, types)?, false),
        PropertyValue::List(items) if items.len() == 1 => (type_link(&items[0], types)?, true),
        _ => return None,
    };
    Some(LinkField { key: property.key.clone(), target, list })
}

/// The type a note says it is: its `type:` text (a `[[link]]` counts by its title).
pub fn type_of(note: &Note) -> Option<String> {
    let value = note.properties.iter().find(|p| p.key.eq_ignore_ascii_case(TYPE_KEY))?;
    let PropertyValue::Text(text) = &value.value else { return None };
    let text = text.trim();
    let text = text.strip_prefix("[[").and_then(|t| t.strip_suffix("]]")).map_or(text, |inner| inner.split('|').next().unwrap_or(inner)).trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// The type a template's title defines: "Book Template" defines "Book".
pub fn template_type(title: &str) -> Option<String> {
    let title = title.trim();
    let cut = title.len().checked_sub(TEMPLATE_SUFFIX.len())?;
    let (name, suffix) = (title.get(..cut)?, title.get(cut..)?);
    (suffix.eq_ignore_ascii_case(TEMPLATE_SUFFIX) && !name.trim().is_empty()).then(|| name.trim().to_string())
}

/// Every type in use or with a template, by name. Archived notes don't count.
pub fn list_types(notes: &[Note]) -> Vec<NoteType> {
    list_types_with_disabled(notes, &[])
}

pub(crate) fn list_types_with_disabled(notes: &[Note], disabled: &[String]) -> Vec<NoteType> {
    let live: Vec<&Note> = notes.iter().filter(|n| n.folder_id.as_deref() != Some(ARCHIVE)).collect();
    let mut types: Vec<NoteType> = Vec::new();
    let mut spellings: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for note in &live {
        if disabled.contains(&note.id) { continue; }
        if let Some(name) = template_type(&note.title) {
            if !types.iter().any(|t| normalize_title(&t.name) == normalize_title(&name)) {
                let icon = note.properties.iter().find(|p| p.key.eq_ignore_ascii_case(ICON_KEY)).map(|p| p.value.display()).filter(|i| !i.trim().is_empty());
                types.push(NoteType { name, icon, template_id: Some(note.id.clone()), ..NoteType::default() });
            }
            continue;
        }
        if let Some(name) = note.journal.map(|_| "Journal".to_string()).or_else(|| type_of(note)) {
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
                types.push(NoteType { name, count, ..NoteType::default() });
            }
        }
    }
    // Link fields can point at any type, so they're read once every type is known.
    let names: Vec<String> = types.iter().map(|t| t.name.clone()).chain(live.iter().filter_map(|n| template_type(&n.title))).collect();
    for t in &mut types {
        if let Some(template) = live.iter().find(|n| template_type(&n.title).is_some_and(|name| normalize_title(&name) == normalize_title(&t.name))) {
            t.parent = parent_of(template);
            if let Ok(resolved) = resolve_template(template, &live, &mut Vec::new()) {
                t.parent = resolved.ancestors.first().cloned();
                t.ancestors = resolved.ancestors;
                t.icon = resolved.fields.iter().find(|(p, _)| p.key.eq_ignore_ascii_case(ICON_KEY)).map(|(p, _)| p.value.display());
                t.links = resolved.fields.iter().filter_map(|(p, _)| link_field(p, &names)).collect();
            } else {
                t.links = template.properties.iter().filter(|p| !control_key(&p.key)).filter_map(|p| link_field(p, &names)).collect();
            }
        }
    }
    let direct_counts: Vec<_> = types.iter().map(|t| (t.name.clone(), t.count, t.ancestors.clone())).collect();
    for (_, count, ancestors) in direct_counts {
        for ancestor in ancestors {
            if let Some(parent) = types.iter_mut().find(|t| normalize_title(&t.name) == normalize_title(&ancestor)) { parent.count += count; }
        }
    }
    types.sort_by_key(|t| t.name.to_lowercase());
    types
}

/// What a note of type `name` titled `title` starts with, from `template`
/// (its note and body): the properties (`type:` first) and the body below the
/// title. Link fields (links to one of `types`) start empty.
pub fn from_template(name: &str, title: &str, template: Option<(&Note, &str)>, types: &[String], day: NaiveDate) -> (Vec<Property>, String) {
    let fill = |text: &str| fill_template(text, day).replace("{{title}}", title);
    let mut properties = vec![Property { key: TYPE_KEY.into(), value: PropertyValue::Text(name.into()) }];
    let Some((note, content)) = template else { return (properties, String::new()) };
    for p in &note.properties {
        if control_key(&p.key) || p.key.eq_ignore_ascii_case(ICON_KEY) {
            continue;
        }
        let value = match (&p.value, link_field(p, types)) {
            (_, Some(LinkField { list: true, .. })) => PropertyValue::List(Vec::new()),
            (_, Some(_)) => PropertyValue::Text(String::new()),
            // `due: "{{date}}"` becomes a date once filled in.
            (PropertyValue::Text(t), _) if t.contains("{{") => parse_scalar(&fill(t)),
            (PropertyValue::List(items), _) => PropertyValue::List(items.iter().map(|i| fill(i)).collect()),
            (other, _) => other.clone(),
        };
        properties.push(Property { key: p.key.clone(), value });
    }
    (properties, fill(&strip_title(content)))
}

impl Vault {
    pub fn template_inheritance(&self, id: &str) -> Result<TemplateInheritance, String> {
        let notes = self.notes_with_content()?;
        let note = notes.iter().find(|(n, _)| n.id == id).map(|(n, _)| n).ok_or("Template not found")?;
        let name = template_type(&note.title).ok_or("This note is not a template")?;
        let templates: Vec<_> = notes.iter().filter(|(n, _)| n.folder_id.as_deref() != Some(ARCHIVE)).map(|(n, _)| n).collect();
        let mut parents: Vec<_> = templates.iter().filter_map(|n| template_type(&n.title))
            .filter(|parent| validate_parent(&name, Some(parent), &templates).is_ok()).collect();
        parents.sort_by_key(|n| n.to_lowercase());
        parents.dedup_by(|a, b| normalize_title(a) == normalize_title(b));
        let resolved = resolve_template(note, &templates, &mut Vec::new());
        Ok(TemplateInheritance {
            parent: resolved.as_ref().ok().and_then(|r| r.ancestors.first().cloned()).or_else(|| parent_of(note)),
            parents, excluded: excluded_by(note),
            inherited: resolved.as_ref().map(|r| r.inherited.clone()).unwrap_or_default(),
            error: resolved.err(),
        })
    }

    pub fn set_template_inheritance(&self, id: &str, parent: Option<&str>, excluded: Vec<String>) -> Result<Note, String> {
        let notes = self.notes_with_content()?;
        let note = notes.iter().find(|(n, _)| n.id == id).map(|(n, _)| n).ok_or("Template not found")?;
        let name = template_type(&note.title).ok_or("This note is not a template")?;
        let templates: Vec<_> = notes.iter().filter(|(n, _)| n.folder_id.as_deref() != Some(ARCHIVE)).map(|(n, _)| n).collect();
        let parent = parent.map(str::trim).filter(|p| !p.is_empty());
        validate_parent(&name, parent, &templates)?;
        let parent = parent.and_then(|p| templates.iter().filter_map(|n| template_type(&n.title)).find(|name| normalize_title(name) == normalize_title(p)));
        let mut keys = Vec::new();
        for key in excluded.into_iter().map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
            if control_key(&key) || key.eq_ignore_ascii_case(ICON_KEY) { return Err(format!("{key} is template metadata, not an inherited property.")); }
            if !keys.iter().any(|k: &String| k.eq_ignore_ascii_case(&key)) { keys.push(key); }
        }
        self.set_properties(id, &[
            (PARENT_KEY.into(), parent.map(PropertyValue::Text)),
            (EXCLUDE_KEY.into(), (!keys.is_empty()).then_some(PropertyValue::List(keys))),
        ])
    }

    pub fn create_type_template(&self, name: &str, parent: Option<&str>) -> Result<Note, String> {
        let name = name.trim();
        if name.is_empty() || name.contains(['\n', '\r']) { return Err("A type needs a single-line name.".into()); }
        let notes = self.notes_with_content()?;
        let templates: Vec<_> = notes.iter().filter(|(n, _)| n.folder_id.as_deref() != Some(ARCHIVE)).map(|(n, _)| n).collect();
        let parent = parent.map(str::trim).filter(|p| !p.is_empty());
        if let Some(existing) = templates.iter().find(|n| template_type(&n.title).is_some_and(|t| normalize_title(&t) == normalize_title(name))) {
            if parent.is_some() { return Err(format!("The {name} template already exists. Edit its parent in the template.")); }
            return Ok((*existing).clone());
        }
        validate_parent(name, parent, &templates)?;
        let mut properties = vec![Property { key: ICON_KEY.into(), value: PropertyValue::Text(String::new()) }];
        if let Some(parent) = parent {
            let parent = templates.iter().filter_map(|n| template_type(&n.title)).find(|n| normalize_title(n) == normalize_title(parent)).unwrap();
            properties.push(Property { key: PARENT_KEY.into(), value: PropertyValue::Text(parent) });
        }
        self.create_note_with(None, &format!("# {name} Template\n\n"), None, &properties)
    }

    pub fn note_types(&self) -> Result<Vec<NoteType>, String> {
        let disabled = self.disabled_template_ids()?;
        let notes: Vec<Note> = self.notes_with_content()?.into_iter().map(|(n, _)| n).collect();
        Ok(list_types_with_disabled(&notes, &disabled))
    }

    pub(crate) fn type_names(&self) -> Result<Vec<String>, String> {
        let mut names: Vec<_> = self.note_types()?.into_iter().map(|t| t.name).collect();
        for (note, _) in self.notes_with_content()? {
            if note.folder_id.as_deref() != Some(ARCHIVE) {
                if let Some(name) = template_type(&note.title) {
                    if !names.iter().any(|n| normalize_title(n) == normalize_title(&name)) { names.push(name); }
                }
            }
        }
        Ok(names)
    }

    /// The template note for the type `name`, with its body.
    pub(crate) fn type_template(&self, name: &str) -> Result<Option<(Note, String)>, String> {
        let wanted = normalize_title(name);
        let disabled = self.disabled_template_ids()?;
        let notes = self.notes_with_content()?;
        let templates: Vec<_> = notes.iter().filter(|(n, _)| n.folder_id.as_deref() != Some(ARCHIVE)).map(|(n, _)| n).collect();
        let found = notes.iter().find(|(n, _)| {
            n.folder_id.as_deref() != Some(ARCHIVE) && !disabled.contains(&n.id) && template_type(&n.title).is_some_and(|t| normalize_title(&t) == wanted)
        });
        let Some((note, content)) = found else { return Ok(None) };
        let resolved = resolve_template(note, &templates, &mut Vec::new())?;
        let mut note = note.clone();
        note.properties = resolved.fields.into_iter().map(|(p, _)| p).collect();
        Ok(Some((note, content.clone())))
    }

    /// A new note of the type `name` titled `title`, started from the type's template.
    pub fn create_typed_note(&self, name: &str, title: &str, folder_id: Option<String>) -> Result<Note, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("A type needs a name.".into());
        }
        if normalize_title(name) == "journal" {
            let day = crate::journal::parse_day(title).unwrap_or_else(|| Local::now().date_naive());
            return self.open_journal(day).map(|(note, _)| note);
        }
        let title = if title.trim().is_empty() { "Untitled" } else { title.trim() };
        let template = self.type_template(name)?;
        // The template's spelling of the type, so notes agree with it.
        let name = template.as_ref().and_then(|(n, _)| template_type(&n.title)).unwrap_or_else(|| name.to_string());
        let types = self.type_names()?;
        let (properties, body) = from_template(&name, title, template.as_ref().map(|(n, c)| (n, c.as_str())), &types, Local::now().date_naive());
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
        let (properties, _) = from_template(&name, &note.title, Some((&template, &content)), &self.type_names()?, Local::now().date_naive());
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
        assert_eq!(template_type("Journal Template"), Some("Journal".into()));
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
            NoteType { name: "Book".into(), icon: Some("📚".into()), template_id: types[0].template_id.clone(), count: 1, ..NoteType::default() },
            NoteType { name: "project".into(), count: 3, ..NoteType::default() },
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
    fn templates_declare_link_fields_that_start_empty() {
        let (vault, root) = vault();
        write(&vault, "# Person Template", &[]);
        write(&vault, "# Book Template", &[("author", "\"[[person]]\""), ("readers", "[\"[[Person|someone]]\"]"), ("series", "\"[[Dune]]\""), ("pair", "[\"[[Person]]\", x]")]);
        let book = vault.note_types().unwrap().into_iter().find(|t| t.name == "Book").unwrap();
        assert_eq!(book.links, vec![
            LinkField { key: "author".into(), target: "Person".into(), list: false },
            LinkField { key: "readers".into(), target: "Person".into(), list: true },
        ], "links to a type; a link to a note, or a list with more, is a value");
        let note = vault.create_typed_note("Book", "Dune", None).unwrap();
        let values: Vec<(&str, PropertyValue)> = note.properties.iter().map(|p| (p.key.as_str(), p.value.clone())).collect();
        assert_eq!(values, vec![
            ("type", PropertyValue::Text("Book".into())),
            ("author", PropertyValue::Text(String::new())),
            ("readers", PropertyValue::List(vec![])),
            ("series", PropertyValue::Text("[[Dune]]".into())),
            ("pair", PropertyValue::List(vec!["[[Person]]".into(), "x".into()])),
        ]);
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

    #[test]
    fn child_templates_inherit_exclude_and_override_properties() {
        let (vault, root) = vault();
        write(&vault, "# Person Template\n\nParent body", &[("icon", "👤"), ("email", "\"\""), ("company", "Independent"), ("agent", "\"[[Person]]\"")]);
        let author = vault.create_type_template("Author", Some("person")).unwrap();
        vault.set_property(&author.id, "Company", Some(parse_scalar("Publisher")), None).unwrap();
        vault.set_property(&author.id, "genre", Some(parse_scalar("Fiction")), None).unwrap();
        vault.save_note(&author.id, "# Author Template\n\n## Bibliography\n".into()).unwrap();
        vault.set_template_inheritance(&author.id, Some("Person"), vec!["EMAIL".into()]).unwrap();
        let schema = vault.template_inheritance(&author.id).unwrap();
        assert_eq!(schema.parent.as_deref(), Some("Person"));
        assert!(schema.inherited.iter().any(|p| p.property.key == "email" && !p.enabled && p.source == "Person"));
        assert!(schema.inherited.iter().any(|p| p.property.key == "company" && p.overridden));
        let note = vault.create_typed_note("author", "Ursula", None).unwrap();
        assert_eq!(type_of(&note).as_deref(), Some("Author"));
        assert!(!note.properties.iter().any(|p| ["email", "extends", "exclude", "icon"].contains(&p.key.as_str())));
        assert!(note.properties.iter().any(|p| p.key == "Company" && p.value == parse_scalar("Publisher")));
        assert!(note.properties.iter().any(|p| p.key == "genre"));
        assert!(note.properties.iter().any(|p| p.key == "agent" && p.value == parse_scalar("\"\"")));
        assert_eq!(vault.get_note_content(&note.id).unwrap().content, "# Ursula\n\n## Bibliography\n");
        let types = vault.note_types().unwrap();
        let kind = types.iter().find(|t| t.name == "Author").unwrap();
        assert_eq!(kind.parent.as_deref(), Some("Person"));
        assert_eq!(kind.icon.as_deref(), Some("👤"));
        assert_eq!(kind.links, vec![LinkField { key: "agent".into(), target: "Person".into(), list: false }]);
        assert_eq!(types.iter().find(|t| t.name == "Person").unwrap().count, 1);
        vault.set_property(&author.id, "Company", None, None).unwrap();
        let reverted = vault.create_typed_note("Author", "Next", None).unwrap();
        assert!(reverted.properties.iter().any(|p| p.key == "company" && p.value.display() == "Independent"));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn inheritance_follows_parent_edits_and_multiple_levels() {
        let (vault, root) = vault();
        let person = write(&vault, "# Person Template", &[("email", "\"\""), ("company", "Independent")]);
        let author = vault.create_type_template("Author", Some("Person")).unwrap();
        vault.set_template_inheritance(&author.id, Some("Person"), vec!["company".into()]).unwrap();
        let novelist = vault.create_type_template("Novelist", Some("Author")).unwrap();
        let first = vault.create_typed_note("Novelist", "First", None).unwrap();
        assert!(!first.properties.iter().any(|p| p.key == "company"));
        vault.set_property(&person.id, "website", Some(parse_scalar("\"\"")), None).unwrap();
        let next = vault.create_typed_note("Novelist", "Next", None).unwrap();
        assert!(next.properties.iter().any(|p| p.key == "website"));
        assert!(!first.properties.iter().any(|p| p.key == "website"));
        assert!(vault.template_inheritance(&novelist.id).unwrap().inherited.iter().any(|p| p.property.key == "website" && p.source == "Person"));
        let kinds = vault.note_types().unwrap();
        assert_eq!(kinds.iter().find(|t| t.name == "Novelist").unwrap().ancestors, vec!["Author", "Person"]);
        assert_eq!(kinds.iter().find(|t| t.name == "Person").unwrap().count, 2);
        vault.set_template_inheritance(&author.id, Some("Person"), vec![]).unwrap();
        assert!(vault.create_typed_note("Novelist", "Third", None).unwrap().properties.iter().any(|p| p.key == "company"));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn invalid_parents_and_cycles_do_not_write_or_create_notes() {
        let (vault, root) = vault();
        let person = vault.create_type_template("Person", None).unwrap();
        let author = vault.create_type_template("Author", Some("Person")).unwrap();
        assert!(vault.set_template_inheritance(&person.id, Some("Author"), vec![]).is_err());
        assert!(vault.set_template_inheritance(&author.id, Some("author"), vec![]).is_err());
        assert!(vault.set_template_inheritance(&author.id, Some("Missing"), vec![]).is_err());
        assert!(vault.template_inheritance(&person.id).unwrap().parent.is_none());
        assert!(!vault.template_inheritance(&person.id).unwrap().parents.contains(&"Author".into()));
        let count = vault.notes_with_content().unwrap().len();
        assert!(vault.create_type_template("Bad", Some("Missing")).is_err());
        assert!(vault.create_type_template("Bad\nName", None).is_err());
        assert!(vault.create_type_template("Author", Some("Person")).is_err());
        assert_eq!(vault.notes_with_content().unwrap().len(), count);
        // Files may be edited outside Tagdown. A malformed chain stays editable.
        vault.set_property(&person.id, PARENT_KEY, Some(parse_scalar("Author")), None).unwrap();
        assert!(vault.template_inheritance(&author.id).unwrap().error.is_some());
        assert!(vault.create_typed_note("Author", "Blocked", None).is_err());
        assert_eq!(vault.notes_with_content().unwrap().len(), count);
        assert!(vault.note_types().unwrap().iter().any(|t| t.name == "Author"));
        vault.set_template_inheritance(&person.id, None, vec![]).unwrap();
        assert!(vault.create_typed_note("Author", "Fixed", None).is_ok());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn applying_a_child_type_adds_only_missing_enabled_properties() {
        let (vault, root) = vault();
        write(&vault, "# Person Template", &[("email", "\"\""), ("company", "Independent")]);
        let author = vault.create_type_template("Author", Some("Person")).unwrap();
        vault.set_property(&author.id, "genre", Some(parse_scalar("Fiction")), None).unwrap();
        vault.set_template_inheritance(&author.id, Some("Person"), vec!["company".into()]).unwrap();
        let note = write(&vault, "# Sam", &[("type", "Author"), ("email", "sam@example.test"), ("company", "My publisher")]);
        let (note, added) = vault.apply_type(&note.id).unwrap();
        assert_eq!(added, vec!["genre"]);
        assert!(note.properties.iter().any(|p| p.key == "email" && p.value.display() == "sam@example.test"));
        assert!(note.properties.iter().any(|p| p.key == "company" && p.value.display() == "My publisher"));
        assert!(vault.apply_type(&note.id).unwrap().1.is_empty());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn switching_a_builtin_parent_off_keeps_its_child_schema() {
        let (vault, root) = vault();
        vault.ensure_builtin_templates().unwrap();
        let author = vault.create_type_template("Author", Some("Person")).unwrap();
        vault.set_builtin_template_enabled("Person", false).unwrap();
        let note = vault.create_typed_note("Author", "Writer", None).unwrap();
        assert!(note.properties.iter().any(|p| p.key == "email"));
        let parent = vault.builtin_templates().unwrap().into_iter().find(|t| t.name == "Person").unwrap().template_id.unwrap();
        vault.delete_note(&parent).unwrap();
        assert!(vault.template_inheritance(&author.id).unwrap().error.is_some());
        assert!(vault.create_typed_note("Author", "Blocked", None).is_err());
        vault.set_template_inheritance(&author.id, None, vec![]).unwrap();
        assert_eq!(vault.create_typed_note("Author", "Independent", None).unwrap().properties.len(), 1);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn queries_for_a_parent_include_children_and_support_negation() {
        let (vault, root) = vault();
        vault.create_type_template("Person", None).unwrap();
        vault.create_type_template("Author", Some("Person")).unwrap();
        let writer = vault.create_typed_note("Author", "Writer", None).unwrap();
        vault.create_typed_note("Person", "Reader", None).unwrap();
        vault.create_typed_note("Book", "Novel", None).unwrap();
        let query = |filter: &str| crate::query::run(filter, vault.notes_with_content().unwrap(), None, &[], None).unwrap();
        let people = query("type:person sort:title");
        assert_eq!(people.notes.iter().map(|n| n.title.as_str()).collect::<Vec<_>>(), vec!["Reader", "Writer"]);
        assert_eq!(query("type:Author").notes[0].id, writer.id);
        assert!(!query("-type:Person").notes.iter().any(|n| n.id == writer.id));
        assert_eq!(query("type=\"[[Person]]\"").total, 2);
        std::fs::remove_dir_all(root).ok();
    }
}
