//! Editable starter templates and their per-vault availability.
use std::{collections::BTreeMap, fs};

use serde::{Deserialize, Serialize};

use crate::{links::normalize_title, models::Note, properties::{parse_scalar, Property}, vault::Vault};

struct Starter {
    name: &'static str,
    icon: &'static str,
    description: &'static str,
    body: &'static str,
    properties: &'static [(&'static str, &'static str)],
}

const STARTERS: &[Starter] = &[
    Starter { name: "Journal", icon: "📅", description: "Daily priorities, notes, and reflection.", body: "## {{weekday}}, {{date}}\n\n## Priorities\n\n\n## Notes\n\n\n## Reflection\n\n\n[[{{yesterday}}|Yesterday]] · [[{{tomorrow}}|Tomorrow]]\n", properties: &[] },
    Starter { name: "Book", icon: "📚", description: "Reading notes, key ideas, and quotes.", body: "## Key ideas\n\n\n## Notes\n\n\n## Quotes\n", properties: &[("author", "\"[[Person]]\""), ("status", "To read"), ("rating", "0")] },
    Starter { name: "Person", icon: "👤", description: "Contact details and notes about people.", body: "## About\n\n\n## Notes\n", properties: &[("email", "\"\""), ("company", "\"\"")] },
    Starter { name: "Project", icon: "🚀", description: "Goals, next steps, and progress.", body: "## Goal\n\n\n## Next steps\n\n\n## Notes\n", properties: &[("status", "Planned"), ("owner", "\"[[Person]]\"")] },
    Starter { name: "Meeting", icon: "💬", description: "An agenda, decisions, and action items.", body: "## Agenda\n\n\n## Notes\n\n\n## Decisions\n\n\n## Action items\n", properties: &[("date", "\"{{date}}\""), ("attendees", "[\"[[Person]]\"]"), ("project", "\"[[Project]]\"")] },
    Starter { name: "Recipe", icon: "🍳", description: "Ingredients, instructions, and cooking notes.", body: "## Ingredients\n\n- \n\n## Instructions\n\n1. \n\n## Notes\n", properties: &[("servings", "2"), ("prep time", "\"\""), ("cook time", "\"\"")] },
];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TemplateState {
    note_id: String,
    enabled: bool,
}

type States = BTreeMap<String, TemplateState>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinTemplate {
    pub name: String,
    pub icon: String,
    pub description: String,
    pub template_id: Option<String>,
    pub enabled: bool,
}

impl Starter {
    fn title(&self) -> String { format!("{} Template", self.name) }
    fn content(&self) -> String { format!("# {}\n\n{}", self.title(), self.body) }
    fn properties(&self) -> Vec<Property> {
        std::iter::once(("icon", self.icon)).chain(self.properties.iter().copied())
            .map(|(key, value)| Property { key: key.into(), value: parse_scalar(value) }).collect()
    }
}

impl Vault {
    fn template_states(&self) -> Result<States, String> {
        let path = self.root.join(".tagdown/templates.json");
        match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(States::new()),
            Err(e) => Err(e.to_string()),
        }
    }

    fn save_template_states(&self, states: &States) -> Result<(), String> {
        let path = self.root.join(".tagdown/templates.json");
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(states).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        fs::rename(temporary, path).map_err(|e| e.to_string())
    }

    /// Called when the desktop opens a vault. Never replaces an existing template
    /// or recreates one the user previously removed or renamed.
    pub fn ensure_builtin_templates(&self) -> Result<(), String> {
        let mut states = self.template_states()?;
        let notes = self.notes_with_content()?;
        let mut changed = false;
        for starter in STARTERS {
            if states.contains_key(starter.name) { continue; }
            let existing = notes.iter().find(|(n, _)| normalize_title(&n.title) == normalize_title(&starter.title()));
            let note = match existing {
                Some((note, _)) => note.clone(),
                None => self.create_note_with(None, &starter.content(), None, &starter.properties())?,
            };
            states.insert(starter.name.into(), TemplateState { enabled: note.folder_id.as_deref() != Some("archive"), note_id: note.id });
            changed = true;
        }
        if changed { self.save_template_states(&states)?; }
        Ok(())
    }

    pub(crate) fn disabled_template_ids(&self) -> Result<Vec<String>, String> {
        Ok(self.template_states()?.into_values().filter(|s| !s.enabled).map(|s| s.note_id).collect())
    }

    pub fn builtin_templates(&self) -> Result<Vec<BuiltinTemplate>, String> {
        let states = self.template_states()?;
        let notes = self.notes_with_content()?;
        Ok(STARTERS.iter().map(|starter| {
            let state = states.get(starter.name);
            let note = state.and_then(|s| notes.iter().find(|(n, _)| n.id == s.note_id && n.folder_id.as_deref() != Some("archive")));
            BuiltinTemplate {
                name: starter.name.into(), icon: starter.icon.into(), description: starter.description.into(),
                template_id: note.map(|(n, _)| n.id.clone()), enabled: state.is_some_and(|s| s.enabled) && note.is_some(),
            }
        }).collect())
    }

    /// Disabling preserves the note and every note already made from it.
    pub fn set_builtin_template_enabled(&self, name: &str, enabled: bool) -> Result<(), String> {
        let starter = STARTERS.iter().find(|s| s.name == name).ok_or("Unknown built-in template")?;
        let mut states = self.template_states()?;
        let state = states.get_mut(name).ok_or("Template has not been initialized")?;
        if enabled {
            let note = self.notes_with_content()?.into_iter().find(|(n, _)| n.id == state.note_id);
            match note {
                Some((note, _)) if note.folder_id.as_deref() == Some("archive") => { self.update_note_folder(&note.id, None)?; }
                Some(_) => {},
                None => { state.note_id = self.create_note_with(None, &starter.content(), None, &starter.properties())?.id; }
            }
        }
        state.enabled = enabled;
        self.save_template_states(&states)
    }

    /// Reset just the template's body and properties, preserving its identity
    /// and availability. Existing notes are untouched.
    pub fn reset_builtin_template(&self, name: &str) -> Result<Note, String> {
        let starter = STARTERS.iter().find(|s| s.name == name).ok_or("Unknown built-in template")?;
        let mut states = self.template_states()?;
        let state = states.get_mut(name).ok_or("Template has not been initialized")?;
        let existing = self.notes_with_content()?.into_iter().find(|(n, _)| n.id == state.note_id);
        let note = match existing {
            Some((note, content)) => {
                self.history.snapshot(&note.id, &content, chrono::Utc::now())?;
                for property in &note.properties { self.set_property(&note.id, &property.key, None, None)?; }
                for property in starter.properties() { self.set_property(&note.id, &property.key, Some(property.value), None)?; }
                if note.folder_id.as_deref() == Some("archive") { self.update_note_folder(&note.id, None)?; }
                self.save_note(&note.id, starter.content())?
            }
            None => self.create_note_with(None, &starter.content(), None, &starter.properties())?,
        };
        state.note_id = note.id.clone();
        self.save_template_states(&states)?;
        Ok(note)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal::parse_day;

    fn vault() -> (Vault, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("tagdown-templates-{}", uuid::Uuid::new_v4()));
        (Vault::open_or_create(root.clone()).unwrap(), root)
    }

    fn template(vault: &Vault, name: &str) -> BuiltinTemplate {
        vault.builtin_templates().unwrap().into_iter().find(|t| t.name == name).unwrap()
    }

    #[test]
    fn starters_are_available_once_and_keep_existing_templates() {
        let (vault, root) = vault();
        let custom = vault.create_note(None).unwrap();
        vault.save_note(&custom.id, "# Journal Template\n\nMy daily routine\n".into()).unwrap();
        vault.ensure_builtin_templates().unwrap();
        assert_eq!(template(&vault, "Journal").template_id.as_deref(), Some(custom.id.as_str()));
        assert_eq!(vault.get_note_content(&custom.id).unwrap().content, "# Journal Template\n\nMy daily routine\n");
        let count = vault.notes_with_content().unwrap().len();
        vault.ensure_builtin_templates().unwrap();
        assert_eq!(vault.notes_with_content().unwrap().len(), count);
        let types = vault.note_types().unwrap();
        for starter in STARTERS {
            let kind = types.iter().find(|t| t.name == starter.name).unwrap();
            assert!(kind.template_id.is_some());
            assert_eq!(kind.count, 0);
            assert!(template(&vault, starter.name).enabled);
        }
        let meeting = vault.create_typed_note("Meeting", "Planning", None).unwrap();
        assert!(vault.get_note_content(&meeting.id).unwrap().content.contains("## Agenda"));
        assert_eq!(meeting.properties.iter().find(|p| p.key == "attendees").unwrap().value, parse_scalar("[]"));
        for (note, content) in vault.notes_with_content().unwrap() {
            if crate::types::template_type(&note.title).is_some() {
                assert!(crate::tasks::parse_tasks(&note, &content).is_empty(), "starter templates must not populate the task list");
            }
        }
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn disabled_templates_keep_edits_and_notes_across_reopening() {
        let (vault, root) = vault();
        vault.ensure_builtin_templates().unwrap();
        let id = template(&vault, "Book").template_id.unwrap();
        vault.save_note(&id, "# Book Template\n\nMy reading prompts\n".into()).unwrap();
        let first = vault.create_typed_note("Book", "First", None).unwrap();
        vault.set_builtin_template_enabled("Book", false).unwrap();
        let reopened = Vault::open_existing(root.clone()).unwrap();
        reopened.ensure_builtin_templates().unwrap();
        assert!(!template(&reopened, "Book").enabled);
        let kind = reopened.note_types().unwrap().into_iter().find(|t| t.name == "Book").unwrap();
        assert_eq!(kind.count, 1);
        assert!(kind.template_id.is_none());
        let plain = reopened.create_typed_note("Book", "Second", None).unwrap();
        assert_eq!(reopened.get_note_content(&plain.id).unwrap().content, "# Second\n");
        assert!(reopened.get_note_content(&first.id).unwrap().content.contains("My reading prompts"));
        reopened.set_builtin_template_enabled("Book", true).unwrap();
        let third = reopened.create_typed_note("Book", "Third", None).unwrap();
        assert!(reopened.get_note_content(&third.id).unwrap().content.contains("My reading prompts"));
        assert_eq!(template(&reopened, "Book").template_id, Some(id));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn journal_type_counts_pages_and_honors_the_template_switch() {
        let (vault, root) = vault();
        vault.ensure_builtin_templates().unwrap();
        let id = template(&vault, "Journal").template_id.unwrap();
        vault.set_property(&id, "mood", Some(parse_scalar("Calm")), None).unwrap();
        let day = parse_day("2026-10-19").unwrap();
        let first = vault.create_typed_note("Journal", "2026-10-19", None).unwrap();
        assert_eq!(first.journal, Some(day));
        let content = vault.get_note_content(&first.id).unwrap().content;
        assert!(content.contains("Monday, 2026-10-19"));
        assert!(!content.contains("{{"));
        assert!(first.properties.iter().any(|p| p.key == "mood"));
        assert!(!first.properties.iter().any(|p| p.key == "icon"));
        assert_eq!(vault.create_typed_note("Journal", "2026-10-19", None).unwrap().id, first.id);
        let kind = vault.note_types().unwrap().into_iter().find(|t| t.name == "Journal").unwrap();
        assert_eq!(kind.count, 1);
        assert_eq!(kind.template_id, Some(id));
        vault.set_builtin_template_enabled("Journal", false).unwrap();
        let (next, _) = vault.open_journal(parse_day("2026-10-20").unwrap()).unwrap();
        assert_eq!(vault.get_note_content(&next.id).unwrap().content, "# 2026-10-20\n");
        assert_eq!(vault.get_note_content(&first.id).unwrap().content, content);
        vault.delete_note(&first.id).unwrap();
        assert_eq!(vault.note_types().unwrap().into_iter().find(|t| t.name == "Journal").unwrap().count, 1);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn resetting_restores_properties_and_body_without_touching_existing_notes() {
        let (vault, root) = vault();
        vault.ensure_builtin_templates().unwrap();
        let id = template(&vault, "Project").template_id.unwrap();
        vault.save_note(&id, "# Project Template\n\nCustom plan\n".into()).unwrap();
        vault.set_property(&id, "custom", Some(parse_scalar("yes")), None).unwrap();
        vault.set_property(&id, "status", Some(parse_scalar("Active")), None).unwrap();
        let project = vault.create_typed_note("Project", "Launch", None).unwrap();
        vault.set_builtin_template_enabled("Project", false).unwrap();
        let reset = vault.reset_builtin_template("Project").unwrap();
        assert_eq!(reset.id, id);
        assert!(!template(&vault, "Project").enabled);
        let starter = STARTERS.iter().find(|s| s.name == "Project").unwrap();
        assert_eq!(reset.properties, starter.properties());
        assert_eq!(vault.get_note_content(&id).unwrap().content, starter.content());
        assert!(vault.history.list(&id).unwrap().iter().any(|v| vault.history.read(&id, &v.id).unwrap().contains("Custom plan")));
        assert!(vault.get_note_content(&project.id).unwrap().content.contains("Custom plan"));
        let unchanged = vault.notes_with_content().unwrap().into_iter().find(|(n, _)| n.id == project.id).unwrap().0;
        assert_eq!(unchanged.properties, project.properties);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn removed_templates_stay_removed_until_explicitly_restored() {
        let (vault, root) = vault();
        vault.ensure_builtin_templates().unwrap();
        let id = template(&vault, "Recipe").template_id.unwrap();
        vault.delete_note(&id).unwrap();
        vault.ensure_builtin_templates().unwrap();
        assert!(!template(&vault, "Recipe").enabled);
        assert!(template(&vault, "Recipe").template_id.is_none());
        vault.set_builtin_template_enabled("Recipe", true).unwrap();
        assert_eq!(template(&vault, "Recipe").template_id, Some(id.clone()));
        vault.destroy_note(&id).unwrap();
        vault.ensure_builtin_templates().unwrap();
        assert!(template(&vault, "Recipe").template_id.is_none());
        let restored = vault.reset_builtin_template("Recipe").unwrap();
        assert_ne!(restored.id, id);
        assert!(template(&vault, "Recipe").enabled);
        assert!(vault.set_builtin_template_enabled("Unknown", false).is_err());
        assert!(vault.reset_builtin_template("Unknown").is_err());
        std::fs::remove_dir_all(root).ok();
    }
}
