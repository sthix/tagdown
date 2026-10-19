//! Calendar import and meeting notes remain ordinary Markdown and properties.
use std::{collections::{BTreeMap, HashSet}, fs, path::PathBuf};

use chrono::{NaiveDate, NaiveDateTime, Local, TimeZone};
use serde::{Deserialize, Serialize};

use crate::{journal::append_block, links::{normalize_title, LinkTargets}, models::Note, properties::PropertyValue, types::type_of, vault::Vault};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub uid: String,
    pub title: String,
    pub day: String,
    pub time: String,
    pub timezone: String,
    pub location: String,
    pub description: String,
    pub attendees: Vec<String>,
    pub recurring: bool,
    pub recurrence_id: String,
    pub existing_note_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingDraft {
    pub title: String,
    pub day: String,
    #[serde(default)] pub time: String,
    #[serde(default)] pub timezone: String,
    #[serde(default)] pub location: String,
    #[serde(default)] pub description: String,
    #[serde(default)] pub attendees: Vec<String>,
    #[serde(default)] pub project: String,
    #[serde(default)] pub series: String,
    #[serde(default)] pub calendar_uid: String,
    #[serde(default)] pub recurrence_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedMeeting {
    pub note: Note,
    pub existed: bool,
    pub changed: Vec<Note>,
}

fn text(value: &str) -> String {
    let mut chars = value.chars();
    let mut result = String::new();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n' | 'N') => result.push('\n'),
                Some(c) => result.push(c),
                None => result.push('\\'),
            }
        } else { result.push(c); }
    }
    result
}

fn split_outside_quotes(value: &str, separator: char) -> Vec<&str> {
    let mut quoted = false;
    let mut from = 0;
    let mut parts = Vec::new();
    for (at, c) in value.char_indices() {
        if c == '"' { quoted = !quoted; }
        if c == separator && !quoted { parts.push(&value[from..at]); from = at + c.len_utf8(); }
    }
    parts.push(&value[from..]);
    parts
}

fn calendar_date(value: &str, timezone: &str) -> Result<(String, String, String), String> {
    if value.len() == 8 {
        let day = NaiveDate::parse_from_str(value, "%Y%m%d").map_err(|_| "Invalid calendar date")?;
        return Ok((day.to_string(), String::new(), String::new()));
    }
    let utc = value.ends_with('Z');
    let raw = value.trim_end_matches('Z');
    let date = NaiveDateTime::parse_from_str(raw, "%Y%m%dT%H%M%S").map_err(|_| "Invalid calendar time")?;
    if utc {
        let local = chrono::Utc.from_utc_datetime(&date).with_timezone(&Local);
        Ok((local.date_naive().to_string(), local.format("%H:%M").to_string(), "Local time".into()))
    } else {
        Ok((date.date().to_string(), date.format("%H:%M").to_string(), timezone.to_string()))
    }
}

/// RFC 5545 line unfolding, quoted parameters, escaped text, and separate
/// recurrence overrides. RRULE expansion belongs to the calendar provider.
pub fn parse_calendar(raw: &str) -> Result<Vec<CalendarEvent>, String> {
    if raw.len() > 5_000_000 { return Err("Calendar files must be smaller than 5 MB.".into()); }
    let normalized = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    if !normalized.lines().any(|l| l.trim() == "BEGIN:VCALENDAR") { return Err("Choose an iCalendar (.ics) export.".into()); }
    let mut lines: Vec<String> = Vec::new();
    for line in normalized.lines() {
        if line.starts_with([' ', '\t']) {
            if let Some(previous) = lines.last_mut() { previous.push_str(&line[1..]); }
        } else { lines.push(line.to_string()); }
    }
    let mut events = Vec::new();
    let mut event: Option<CalendarEvent> = None;
    let mut nested = 0usize;
    let mut cancelled = false;
    for line in lines {
        if line == "BEGIN:VEVENT" { event = Some(CalendarEvent::default()); nested = 0; cancelled = false; continue; }
        if line == "END:VEVENT" {
            if let Some(e) = event.take() {
                if !cancelled && !e.uid.is_empty() && !e.day.is_empty() {
                    if e.uid.len() > 4096 { return Err("Calendar event identifier is too long.".into()); }
                    events.push(e);
                    if events.len() > 5000 { return Err("Import at most 5,000 calendar events at once.".into()); }
                }
            }
            continue;
        }
        let Some(e) = event.as_mut() else { continue };
        if line.starts_with("BEGIN:") { nested += 1; continue; }
        if line.starts_with("END:") { nested = nested.saturating_sub(1); continue; }
        if nested > 0 { continue; }
        let parts = split_outside_quotes(&line, ':');
        if parts.len() < 2 { continue; }
        let header = parts[0];
        let value = &line[header.len() + 1..];
        let params = split_outside_quotes(header, ';');
        let parameter = |key: &str| params.iter().skip(1).find_map(|part| part.split_once('=').filter(|(name, _)| name.eq_ignore_ascii_case(key)).map(|(_, value)| value.trim_matches('"')));
        match params[0].to_ascii_uppercase().as_str() {
            "UID" => e.uid = text(value),
            "SUMMARY" => e.title = text(value).replace(['\n', '\r'], " "),
            "DTSTART" => {
                let (day, time, timezone) = calendar_date(value, parameter("TZID").unwrap_or_default())?;
                e.day = day; e.time = time; e.timezone = timezone;
            }
            "LOCATION" => e.location = text(value),
            "DESCRIPTION" => e.description = text(value),
            "ATTENDEE" => {
                let name = text(parameter("CN").unwrap_or_else(|| value.strip_prefix("mailto:").or_else(|| value.strip_prefix("MAILTO:")).unwrap_or(value)));
                if !name.is_empty() && !e.attendees.contains(&name) && e.attendees.len() < 100 { e.attendees.push(name); }
            }
            "RRULE" => e.recurring = true,
            "RECURRENCE-ID" => e.recurrence_id = value.to_string(),
            "STATUS" => cancelled = value.eq_ignore_ascii_case("CANCELLED"),
            _ => {},
        }
    }
    if event.is_some() { return Err("The calendar export is incomplete.".into()); }
    events.sort_by(|a, b| (&a.day, &a.time, &a.title).cmp(&(&b.day, &b.time, &b.title)));
    let mut seen = HashSet::new();
    events.retain(|event| seen.insert((event.uid.clone(), event.recurrence_id.clone())));
    Ok(events)
}

fn property<'a>(note: &'a Note, key: &str) -> Option<&'a PropertyValue> {
    note.properties.iter().find(|p| p.key.eq_ignore_ascii_case(key)).map(|p| &p.value)
}

fn calendar_match(note: &Note, uid: &str, recurrence: &str) -> bool {
    !uid.is_empty() && property(note, "calendar_uid").is_some_and(|v| v.display() == uid)
        && property(note, "calendar_occurrence").map(|v| v.display()).unwrap_or_default() == recurrence
}

fn clean_title(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 250 || value.contains(['\n', '\r', '[', ']', '|', '#']) {
        return Err(format!("{label} needs a name of at most 250 characters without link punctuation or line breaks."));
    }
    Ok(value.to_string())
}

/// Keep a multi-note meeting operation recoverable when a later write fails.
/// Existing files are restored verbatim, including their frontmatter.
#[derive(Default)]
struct MeetingWrites {
    created: Vec<String>,
    originals: Vec<(PathBuf, String)>,
}

impl MeetingWrites {
    fn remember(&mut self, vault: &Vault, note: &Note) -> Result<(), String> {
        if self.created.contains(&note.id) { return Ok(()); }
        let path = vault.note_file_path(&note.id)?;
        if !self.originals.iter().any(|(p, _)| p == &path) {
            self.originals.push((path.clone(), fs::read_to_string(path).map_err(|e| e.to_string())?));
        }
        Ok(())
    }

    fn rollback(self, vault: &Vault, error: String) -> String {
        let mut failures = Vec::new();
        for (path, original) in self.originals.into_iter().rev() {
            vault.tracker.record(&path, &original);
            if let Err(e) = fs::write(&path, original) { failures.push(format!("{}: {e}", path.display())); }
        }
        for id in self.created.into_iter().rev() {
            if let Err(e) = vault.destroy_note(&id) { failures.push(format!("{id}: {e}")); }
        }
        if failures.is_empty() { error } else { format!("{error}. Some changes could not be restored: {}", failures.join("; ")) }
    }
}

impl Vault {
    pub fn calendar_events(&self, raw: &str) -> Result<Vec<CalendarEvent>, String> {
        let notes = self.list_notes(None, crate::models::SortOrder::UpdatedDesc)?;
        let mut events = parse_calendar(raw)?;
        for event in &mut events {
            event.existing_note_id = notes.iter().find(|n| n.folder_id.as_deref() != Some("archive") && calendar_match(n, &event.uid, &event.recurrence_id)).map(|n| n.id.clone());
        }
        Ok(events)
    }

    pub fn create_meeting(&self, draft: MeetingDraft) -> Result<CreatedMeeting, String> {
        let title = clean_title(&draft.title, "Meeting")?;
        let day = crate::journal::parse_day(&draft.day).ok_or("Choose a valid meeting date.")?;
        if draft.attendees.len() > 100 || draft.description.len() > 100_000 || draft.location.len() > 2000 || draft.calendar_uid.len() > 4096 || draft.recurrence_id.len() > 200 || draft.timezone.len() > 200 { return Err("Meeting details are too long.".into()); }
        if !draft.time.is_empty() && chrono::NaiveTime::parse_from_str(&draft.time, "%H:%M").is_err() { return Err("Meeting time must be HH:MM.".into()); }
        let attendees = draft.attendees.iter().map(|a| clean_title(a, "Attendee")).collect::<Result<Vec<_>, _>>()?;
        let project = (!draft.project.trim().is_empty()).then(|| clean_title(&draft.project, "Project")).transpose()?;
        let series = (!draft.series.trim().is_empty()).then(|| clean_title(&draft.series, "Series")).transpose()?;
        let mut notes = self.list_notes(None, crate::models::SortOrder::UpdatedDesc)?;
        if let Some(note) = notes.iter().find(|n| n.folder_id.as_deref() != Some("archive") && calendar_match(n, &draft.calendar_uid, &draft.recurrence_id)) {
            return Ok(CreatedMeeting { note: note.clone(), existed: true, changed: Vec::new() });
        }
        if notes.iter().any(|n| calendar_match(n, &draft.calendar_uid, &draft.recurrence_id)) {
            return Err("This calendar event already has an archived meeting note. Restore that note before importing the event again.".into());
        }
        // Validate every link and template before creating any files. A name or
        // alias already used by a different type cannot silently change roles.
        let live: Vec<_> = notes.iter().filter(|n| n.folder_id.as_deref() != Some("archive")).collect();
        let targets = LinkTargets::new(live.iter().copied());
        let types = self.note_types()?;
        let mut plans: BTreeMap<String, (String, String, Option<Note>)> = BTreeMap::new();
        let mut identities: BTreeMap<String, String> = BTreeMap::new();
        for (name, kind) in attendees.iter().map(|n| (n, "Person"))
            .chain(project.iter().map(|n| (n, "Project")))
            .chain(series.iter().map(|n| (n, "Meeting series"))) {
            let key = normalize_title(name);
            if let Some((_, existing_kind, _)) = plans.get(&key) {
                if existing_kind != kind { return Err(format!("{name} cannot be both {existing_kind} and {kind}. Choose distinct names.")); }
                continue;
            }
            let ids = targets.resolve(name);
            if ids.len() > 1 || (ids.is_empty() && targets.alias_matches(name).len() > 1) {
                return Err(format!("More than one note matches {name}. Choose a unique title before linking it."));
            }
            let existing = ids.first().and_then(|id| live.iter().find(|n| n.id == *id)).map(|n| (*n).clone());
            if let Some(note) = &existing {
                if let Some(actual) = type_of(note) {
                    let compatible = normalize_title(&actual) == normalize_title(kind) || types.iter().any(|t| normalize_title(&t.name) == normalize_title(&actual) && t.ancestors.iter().any(|a| normalize_title(a) == normalize_title(kind)));
                    if !compatible { return Err(format!("{} is a {actual} note. Choose a {kind} note or another name.", note.title)); }
                }
                if let Some(previous) = identities.insert(note.id.clone(), kind.into()) {
                    if previous != kind { return Err(format!("{} cannot be both {previous} and {kind}. Choose distinct notes.", note.title)); }
                }
            } else { self.type_template(kind)?; }
            plans.insert(key, (name.clone(), kind.into(), existing));
        }
        let template = self.type_template("Meeting")?;
        self.type_template("Journal")?;
        let type_names = self.type_names()?;
        let mut writes = MeetingWrites::default();
        let result = (|| -> Result<CreatedMeeting, String> {
        let mut changed = Vec::new();
        let mut linked = BTreeMap::new();
        for (key, (name, kind, existing)) in plans {
            let note = if let Some(note) = existing { note } else {
                let note = self.create_typed_note(&kind, &name, None)?;
                writes.created.push(note.id.clone());
                notes.push(note.clone());
                changed.push(note.clone());
                note
            };
            linked.insert(key, note);
        }
        let mut people = Vec::new();
        for name in &attendees {
            let person = linked.get(&normalize_title(name)).unwrap().clone();
            if !people.iter().any(|n: &Note| n.id == person.id) { people.push(person); }
        }
        let project = project.as_ref().map(|name| linked.get(&normalize_title(name)).unwrap());
        let series = series.as_ref().map(|name| linked.get(&normalize_title(name)).unwrap());
        let base = format!("{} {}{}", day, if draft.time.is_empty() { String::new() } else { format!("{} ", draft.time) }, title);
        let mut full_title = base.clone();
        let mut count = 2;
        while notes.iter().any(|n| normalize_title(&n.title) == normalize_title(&full_title)) { full_title = format!("{base} ({count})"); count += 1; }
        let (mut fields, body) = crate::types::from_template("Meeting", &full_title, template.as_ref().map(|(n, c)| (n, c.as_str())), &type_names, day);
        let mut properties: Vec<(String, Option<PropertyValue>)> = vec![
            ("date".into(), Some(PropertyValue::Date(day))),
            ("attendees".into(), Some(PropertyValue::List(people.iter().map(|n| format!("[[{}]]", n.title)).collect()))),
            ("project".into(), project.as_ref().map(|n| PropertyValue::Text(format!("[[{}]]", n.title)))),
            ("series".into(), series.as_ref().map(|n| PropertyValue::Text(format!("[[{}]]", n.title)))),
        ];
        for (key, value) in [("time", draft.time.as_str()), ("timezone", &draft.timezone), ("location", &draft.location), ("calendar_uid", &draft.calendar_uid), ("calendar_occurrence", &draft.recurrence_id)] {
            if !value.is_empty() { properties.push((key.into(), Some(PropertyValue::Text(value.into())))); }
        }
        for (key, value) in properties {
            fields.retain(|p| !p.key.eq_ignore_ascii_case(&key));
            if let Some(value) = value { fields.push(crate::properties::Property { key, value }); }
        }
        let mut content = format!("# {full_title}\n\n{}\n", body.trim());
        // Use the configured Meeting template, retaining its structure and fields.
        if !draft.description.trim().is_empty() { content = append_block(&content, &format!("## Event description\n\n{}", draft.description.trim())); }
        let note = self.create_note_with(None, &content, None, &fields)?;
        writes.created.push(note.id.clone());
        changed.push(note.clone());
        // find_journal can add journal metadata to an imported daily note.
        if let Some(existing) = notes.iter().find(|n| n.folder_id.as_deref() != Some("archive") && (n.journal == Some(day) || n.title == day.to_string())) { writes.remember(self, existing)?; }
        let (journal, created) = self.open_journal(day)?;
        if created { writes.created.push(journal.id.clone()); } else { writes.remember(self, &journal)?; }
        let journal_content = self.get_note_content(&journal.id)?.content;
        changed.push(self.save_note(&journal.id, append_block(&journal_content, &format!("- [[{full_title}]]")))?);
        if let Some(series) = series {
            writes.remember(self, series)?;
            let content = self.get_note_content(&series.id)?.content;
            changed.push(self.save_note(&series.id, append_block(&content, &format!("- [[{full_title}]]")))?);
        }
        Ok(CreatedMeeting { note, existed: false, changed })
        })();
        result.map_err(|error| writes.rollback(self, error))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (Vault, PathBuf) {
        let root = std::env::temp_dir().join(format!("tagdown-meetings-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open_or_create(root.clone()).unwrap();
        vault.ensure_builtin_templates().unwrap();
        (vault, root)
    }

    fn draft() -> MeetingDraft {
        MeetingDraft { title: "Planning".into(), day: "2026-10-19".into(), time: "10:00".into(), timezone: String::new(), location: String::new(), description: String::new(), attendees: Vec::new(), project: String::new(), series: String::new(), calendar_uid: String::new(), recurrence_id: String::new() }
    }

    #[test]
    fn calendar_deduplicates_nonadjacent_uids_but_keeps_recurrences() {
        let raw = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:one\nDTSTART:20261019\nSUMMARY:First\nEND:VEVENT\nBEGIN:VEVENT\nUID:two\nDTSTART:20261020\nSUMMARY:Other\nEND:VEVENT\nBEGIN:VEVENT\nUID:one\nDTSTART:20261021\nSUMMARY:Duplicate\nEND:VEVENT\nBEGIN:VEVENT\nUID:one\nRECURRENCE-ID:20261026\nDTSTART:20261026\nSUMMARY:Next occurrence\nEND:VEVENT\nEND:VCALENDAR";
        let events = parse_calendar(raw).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events.iter().filter(|e| e.uid == "one").count(), 2);
    }

    #[test]
    fn wrong_type_and_cross_role_names_fail_before_creating_related_notes() {
        let (vault, root) = vault();
        let project = vault.create_typed_note("Project", "Atlas", None).unwrap();
        vault.set_property(&project.id, "aliases", Some(PropertyValue::List(vec!["Atlas team".into()])), None).unwrap();
        let before = vault.list_notes(None, crate::models::SortOrder::UpdatedDesc).unwrap().len();
        let mut invalid = draft();
        invalid.attendees = vec!["A new person".into(), "Atlas team".into()];
        let error = vault.create_meeting(invalid).err().unwrap();
        assert!(error.contains("Project note"), "{error}");
        assert_eq!(vault.list_notes(None, crate::models::SortOrder::UpdatedDesc).unwrap().len(), before);
        let mut invalid = draft();
        invalid.attendees = vec!["Same name".into()];
        invalid.project = "same NAME".into();
        assert!(vault.create_meeting(invalid).err().unwrap().contains("both Person and Project"));
        assert_eq!(vault.list_notes(None, crate::models::SortOrder::UpdatedDesc).unwrap().len(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn aliases_reuse_people_and_archive_matching_requires_restoration() {
        let (vault, root) = vault();
        let person = vault.create_typed_note("Person", "Samuel Rivera", None).unwrap();
        vault.set_property(&person.id, "aliases", Some(PropertyValue::Text("Sam".into())), None).unwrap();
        let mut first = draft();
        first.calendar_uid = "recurring".into();
        first.attendees = vec!["Sam".into(), "Samuel Rivera".into()];
        let meeting = vault.create_meeting(first.clone()).unwrap().note;
        assert_eq!(property(&meeting, "attendees").unwrap().texts(), ["[[Samuel Rivera]]"]);
        let mut next = first.clone();
        next.day = "2026-10-26".into();
        next.recurrence_id = "20261026T100000".into();
        let second = vault.create_meeting(next).unwrap();
        assert!(!second.existed);
        assert_ne!(second.note.id, meeting.id);
        vault.delete_note(&meeting.id).unwrap();
        assert!(vault.create_meeting(first).err().unwrap().contains("archived meeting note"));
        let raw = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:recurring\nDTSTART:20261019\nSUMMARY:Planning\nEND:VEVENT\nEND:VCALENDAR";
        assert!(vault.calendar_events(raw).unwrap()[0].existing_note_id.is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn meeting_template_dates_use_the_meeting_day_and_bad_templates_create_nothing() {
        let (vault, root) = vault();
        let template = vault.type_template("Meeting").unwrap().unwrap().0;
        vault.save_note(&template.id, "# Meeting Template\n\n{{weekday}} {{date}}".into()).unwrap();
        let meeting = vault.create_meeting(draft()).unwrap();
        assert!(vault.get_note_content(&meeting.note.id).unwrap().content.contains("Monday 2026-10-19"));
        vault.set_property(&template.id, "extends", Some(PropertyValue::Text("Missing type".into())), None).unwrap();
        let before = vault.list_notes(None, crate::models::SortOrder::UpdatedDesc).unwrap().len();
        let mut invalid = draft();
        invalid.attendees = vec!["New person".into()];
        assert!(vault.create_meeting(invalid).is_err());
        assert_eq!(vault.list_notes(None, crate::models::SortOrder::UpdatedDesc).unwrap().len(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_restores_original_metadata_and_removes_new_related_notes() {
        let (vault, root) = vault();
        let existing = vault.create_typed_note("Meeting series", "Weekly planning", None).unwrap();
        let path = vault.note_file_path(&existing.id).unwrap();
        let original = fs::read_to_string(&path).unwrap();
        let mut writes = MeetingWrites::default();
        writes.remember(&vault, &existing).unwrap();
        vault.save_note(&existing.id, "# Weekly planning\n\nA partial write".into()).unwrap();
        let related = vault.create_typed_note("Person", "Temporary attendee", None).unwrap();
        writes.created.push(related.id.clone());
        assert_eq!(writes.rollback(&vault, "A later write failed".into()), "A later write failed");
        assert_eq!(fs::read_to_string(path).unwrap(), original);
        assert!(vault.get_note_content(&related.id).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn calendar_unfolds_text_ignores_alarms_and_keeps_overrides() {
        let raw = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:one\r\nDTSTART;TZID=Europe/Berlin:20261019T100000\r\nSUMMARY:Planning\\, week\r\n 43\r\nATTENDEE;CN=\"Sam; Rivera\":mailto:sam@example.com\r\nDESCRIPTION:First\\nSecond\r\nRRULE:FREQ=WEEKLY\r\nBEGIN:VALARM\r\nDESCRIPTION:Ignore me\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:one\r\nRECURRENCE-ID:20261026T090000Z\r\nDTSTART;VALUE=DATE:20261026\r\nSUMMARY:Override\r\nEND:VEVENT\r\nEND:VCALENDAR";
        let events = parse_calendar(raw).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].title, "Planning, week43");
        assert_eq!(events[0].description, "First\nSecond");
        assert_eq!(events[0].attendees, ["Sam; Rivera"]);
        assert_eq!(events[0].timezone, "Europe/Berlin");
        assert!(events[0].recurring);
        assert_eq!(events[1].day, "2026-10-26");
    }

    #[test]
    fn invalid_cancelled_and_incomplete_calendars() {
        assert!(parse_calendar("no calendar").is_err());
        assert!(parse_calendar("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261399\nEND:VEVENT").is_err());
        assert!(parse_calendar("BEGIN:VCALENDAR\nBEGIN:VEVENT").is_err());
        assert!(parse_calendar("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART:20261019\nSTATUS:CANCELLED\nEND:VEVENT\nEND:VCALENDAR").unwrap().is_empty());
    }

    #[test]
    fn meeting_links_people_journal_and_deduplicates_calendar_event() {
        let root = std::env::temp_dir().join(format!("tagdown-meetings-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open_or_create(root.clone()).unwrap();
        vault.ensure_builtin_templates().unwrap();
        let draft = || MeetingDraft { title: "Weekly planning".into(), day: "2026-10-19".into(), time: "10:00".into(), timezone: "Europe/Berlin".into(), location: "Room 1".into(), description: "Review roadmap".into(), attendees: vec!["Sam Rivera".into(), "Sam Rivera".into()], project: "Atlas".into(), series: "Weekly planning series".into(), calendar_uid: "event-1".into(), recurrence_id: "20261019T100000".into() };
        let first = vault.create_meeting(draft()).unwrap();
        assert!(!first.existed);
        assert_eq!(property(&first.note, "attendees").unwrap().texts(), ["[[Sam Rivera]]"]);
        let journal = vault.find_journal(NaiveDate::from_ymd_opt(2026, 10, 19).unwrap()).unwrap().unwrap();
        assert!(vault.get_note_content(&journal.id).unwrap().content.contains(&first.note.title));
        assert!(vault.get_note_content(&first.note.id).unwrap().content.contains("Review roadmap"));
        let second = vault.create_meeting(draft()).unwrap();
        assert!(second.existed);
        assert_eq!(second.note.id, first.note.id);
        assert!(second.changed.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
