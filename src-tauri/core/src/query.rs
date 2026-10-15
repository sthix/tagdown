// Live query blocks: `<query tag:project show:tasks />` in a note lists the
// notes or tasks across the vault that match.
//
// A query is a search (the same syntax as everywhere else: words, "phrases",
// tag:, title:, -exclusions) plus display options:
//   show:notes | tasks | table     what to list (notes by default); a table has
//                                  a column per property, editable in the app
//   columns:status,due,updated     the table's columns (title always comes first);
//                                  updated, created, folder and tags are the note's own
//   status:open | done | all       which tasks (open by default)
//   sort:updated | created | title order (most recently edited first by default)
//   sort:due | sort:-priority      by a property, ascending (or descending with -)
//   folder:Name                    only notes in this folder ("quote" names with spaces)
//   limit:N                        at most N items (50 by default)
//
// and property filters (see properties.rs), any number of them:
//   status=active                  equals; for a list, holds the item; links match by title
//   status!=done                   doesn't (notes without the property included)
//   priority=2..  due=..today+7    ranges of numbers or dates, either end open
//   has:owner  -has:owner          the property is set (not empty), or isn't
// Dates can be written as today, today+N or today-N (days). There's no `>` or
// `<`: a `>` would end the <query /> tag.

use std::cmp::Ordering;

use chrono::{Local, NaiveDate, TimeDelta};
use serde::Serialize;

use crate::{
    links::normalize_title,
    models::{FolderRecord, Note},
    properties::{parse_scalar, Property, PropertyValue},
    search_index::SearchIndex,
    tasks::{parse_tasks, Task, TaskFilter},
};

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Show {
    Notes,
    Tasks,
    Table,
}

/// Columns a table shows when the query doesn't name them, besides the ones it filters or sorts by.
const TABLE_COLUMNS: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Sort {
    Updated,
    Created,
    Title,
    Property { key: String, desc: bool },
}

#[derive(Debug, Clone, PartialEq)]
enum Match {
    Equals(String),
    Range(Option<String>, Option<String>),
    Has,
}

#[derive(Debug, Clone, PartialEq)]
struct PropertyFilter {
    key: String,
    negate: bool,
    matcher: Match,
}

#[derive(Debug, PartialEq)]
struct Spec {
    filter: String,
    show: Show,
    status: TaskFilter,
    sort: Sort,
    folder: Option<String>,
    limit: usize,
    properties: Vec<PropertyFilter>,
    /// `columns:` as written, if given.
    columns: Option<Vec<String>>,
    /// `tag:` searches that aren't excluded, for new notes in a table.
    tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryNote {
    pub id: String,
    pub title: String,
    pub folder: Option<String>,
    pub tags: Vec<String>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub properties: Vec<Property>,
}

/// What a note added from a table starts with, so it matches the query.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNote {
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
    pub properties: Vec<Property>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOutput {
    pub show: Show,
    pub notes: Vec<QueryNote>,
    pub tasks: Vec<Task>,
    /// Matches before `limit` was applied.
    pub total: usize,
    /// For notes: properties the query filters or sorts by, to show with each
    /// note. For a table: its columns after the title.
    pub columns: Vec<String>,
    /// For a table: what a note added to it starts with.
    pub new_note: Option<NewNote>,
}

/// Split a query into tokens, keeping "quoted phrases" (and `key:"quoted value"`)
/// and `[[links with spaces]]` together.
fn tokens(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut brackets = 0usize;
    for c in raw.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                current.push(c);
            }
            '[' | ']' => {
                brackets = if c == '[' { brackets + 1 } else { brackets.saturating_sub(1) };
                current.push(c);
            }
            c if c.is_whitespace() && !quoted && brackets == 0 => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// A property filter token: `key=value`, `key!=value`, `-key=value`.
fn property_filter(token: &str) -> Option<PropertyFilter> {
    let (negate, token) = token.strip_prefix('-').map_or((false, token), |t| (true, t));
    let at = token.find('=')?;
    let (key, not) = match token[..at].strip_suffix('!') {
        Some(key) => (key, true),
        None => (&token[..at], false),
    };
    let valid = key.chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_')
        && key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-');
    if !valid {
        return None;
    }
    let value = token[at + 1..].trim_matches('"').to_string();
    let matcher = match value.split_once("..") {
        Some((lo, hi)) => Match::Range(Some(lo.to_string()).filter(|v| !v.is_empty()), Some(hi.to_string()).filter(|v| !v.is_empty())),
        None => Match::Equals(value),
    };
    Some(PropertyFilter { key: key.to_string(), negate: negate != not, matcher })
}

fn parse(raw: &str) -> Result<Spec, String> {
    let mut spec = Spec { filter: String::new(), show: Show::Notes, status: TaskFilter::Open, sort: Sort::Updated, folder: None, limit: DEFAULT_LIMIT, properties: Vec::new(), columns: None, tags: Vec::new() };
    let mut filter = Vec::new();
    for token in tokens(raw) {
        if let Some(has) = token.strip_prefix("has:").map(|k| (false, k)).or_else(|| token.strip_prefix("-has:").map(|k| (true, k))) {
            let key = has.1.trim_matches('"');
            if key.is_empty() {
                return Err("has: needs a property name, like has:status".into());
            }
            spec.properties.push(PropertyFilter { key: key.to_string(), negate: has.0, matcher: Match::Has });
            continue;
        }
        if !token.contains(':') || token.find('=') < token.find(':') {
            if let Some(property) = property_filter(&token) {
                spec.properties.push(property);
                continue;
            }
        }
        let Some((key, value)) = token.split_once(':') else {
            filter.push(token);
            continue;
        };
        let value = value.trim_matches('"');
        match key.to_lowercase().as_str() {
            "show" => spec.show = match value {
                "notes" => Show::Notes,
                "tasks" => Show::Tasks,
                "table" => Show::Table,
                _ => return Err(format!("show: must be notes, tasks or table, not \"{value}\"")),
            },
            "columns" => spec.columns = Some(value.split(',').map(str::trim).filter(|c| !c.is_empty()).map(String::from).collect()),
            "status" => spec.status = match value {
                "open" => TaskFilter::Open,
                "done" => TaskFilter::Done,
                "all" => TaskFilter::All,
                _ => return Err(format!("status: must be open, done or all, not \"{value}\"")),
            },
            "sort" => spec.sort = match value {
                "updated" | "edited" => Sort::Updated,
                "created" => Sort::Created,
                "title" => Sort::Title,
                "" | "-" => return Err("sort: must be updated, created, title or a property name".into()),
                key => match key.strip_prefix('-') {
                    Some(key) => Sort::Property { key: key.to_string(), desc: true },
                    None => Sort::Property { key: key.to_string(), desc: false },
                },
            },
            "limit" => spec.limit = value.parse::<usize>().map_err(|_| format!("limit: must be a number, not \"{value}\""))?.clamp(1, MAX_LIMIT),
            "folder" => spec.folder = Some(value.to_string()),
            "tag" => {
                spec.tags.push(value.trim_start_matches('#').to_string());
                filter.push(token);
            }
            // title:, -tag: and anything else belong to the search.
            _ => filter.push(token),
        }
    }
    spec.filter = filter.join(" ");
    Ok(spec)
}

/// Run `raw` over `notes`. The note holding the query (`exclude_id`) is left
/// out, so a dashboard doesn't list itself.
pub fn run(raw: &str, notes: Vec<(Note, String)>, index: Option<&SearchIndex>, folders: &[FolderRecord], exclude_id: Option<&str>) -> Result<QueryOutput, String> {
    run_at(raw, notes, index, folders, exclude_id, Local::now().date_naive())
}

/// `run`, with `today` for dates like `today+7`.
pub fn run_at(raw: &str, notes: Vec<(Note, String)>, index: Option<&SearchIndex>, folders: &[FolderRecord], exclude_id: Option<&str>, today: NaiveDate) -> Result<QueryOutput, String> {
    let spec = parse(raw)?;
    let mut columns: Vec<String> = Vec::new();
    let sort_key = match &spec.sort { Sort::Property { key, .. } => Some(key), _ => None };
    for key in spec.properties.iter().map(|p| &p.key).chain(sort_key) {
        if !columns.iter().any(|c| c.eq_ignore_ascii_case(key)) {
            columns.push(key.clone());
        }
    }
    if let Some(explicit) = &spec.columns {
        columns = explicit.clone();
    }
    let folder_id = match &spec.folder {
        Some(name) => Some(
            folders
                .iter()
                .find(|f| normalize_title(&f.name) == normalize_title(name) || f.id == *name)
                .map(|f| f.id.clone())
                .ok_or_else(|| format!("no folder named \"{name}\""))?,
        ),
        None => None,
    };
    let matching: Option<Vec<String>> = if spec.filter.trim().is_empty() {
        None
    } else {
        let index = index.ok_or("search is unavailable")?;
        Some(index.matching_ids(&spec.filter, notes.len().max(1))?)
    };

    let mut selected: Vec<(Note, String)> = notes
        .into_iter()
        .filter(|(n, _)| Some(n.id.as_str()) != exclude_id)
        .filter(|(n, _)| match &folder_id {
            Some(id) => n.folder_id.as_ref() == Some(id),
            None => n.folder_id.as_deref() != Some("archive"),
        })
        .filter(|(n, _)| matching.as_ref().is_none_or(|ids| ids.contains(&n.id)))
        .filter(|(n, _)| spec.properties.iter().all(|f| f.matches(property(n, &f.key), today)))
        .collect();
    match &spec.sort {
        Sort::Updated => selected.sort_by(|a, b| b.0.updated_at.cmp(&a.0.updated_at)),
        Sort::Created => selected.sort_by(|a, b| b.0.created_at.cmp(&a.0.created_at)),
        Sort::Title => selected.sort_by_key(|(n, _)| n.title.to_lowercase()),
        Sort::Property { key, desc } => {
            // Ties stay most recently edited first; notes without the property go last either way.
            selected.sort_by(|a, b| b.0.updated_at.cmp(&a.0.updated_at));
            selected.sort_by(|a, b| match (property(&a.0, key).filter(|v| !v.is_empty()), property(&b.0, key).filter(|v| !v.is_empty())) {
                (Some(x), Some(y)) => if *desc { compare(y, x) } else { compare(x, y) },
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (None, None) => Ordering::Equal,
            });
        }
    }

    let folder_name = |id: &Option<String>| id.as_ref().and_then(|id| folders.iter().find(|f| &f.id == id)).map(|f| f.name.clone());
    if spec.show == Show::Table && spec.columns.is_none() {
        // The properties the listed notes use most, after the ones the query names.
        let mut counts: Vec<(String, usize)> = Vec::new();
        for (note, _) in selected.iter().take(spec.limit) {
            for p in note.properties.iter().filter(|p| !matches!(p.value, PropertyValue::Raw(_))) {
                match counts.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case(&p.key)) {
                    Some((_, n)) => *n += 1,
                    None => counts.push((p.key.clone(), 1)),
                }
            }
        }
        counts.sort_by(|a, b| b.1.cmp(&a.1));
        for (key, _) in counts {
            if columns.len() >= TABLE_COLUMNS {
                break;
            }
            if !columns.iter().any(|c| c.eq_ignore_ascii_case(&key)) {
                columns.push(key);
            }
        }
    }
    let new_note = (spec.show == Show::Table).then(|| NewNote {
        folder_id: folder_id.clone(),
        tags: spec.tags.clone(),
        properties: spec.properties.iter().filter(|f| !f.negate).filter_map(|f| match &f.matcher {
            Match::Equals(want) => Some(Property {
                key: f.key.clone(),
                value: date_value(want, today).filter(|_| want.starts_with("today")).map_or_else(|| parse_scalar(want), PropertyValue::Date),
            }),
            _ => None,
        }).collect(),
    });
    Ok(match spec.show {
        Show::Notes | Show::Table => QueryOutput {
            show: spec.show,
            total: selected.len(),
            notes: selected
                .into_iter()
                .take(spec.limit)
                .map(|(n, _)| QueryNote { folder: folder_name(&n.folder_id), id: n.id, title: n.title, tags: n.tags, updated_at: n.updated_at, created_at: n.created_at, properties: n.properties })
                .collect(),
            tasks: Vec::new(),
            columns,
            new_note,
        },
        Show::Tasks => {
            let tasks: Vec<Task> = selected
                .iter()
                .flat_map(|(n, content)| parse_tasks(n, content))
                .filter(|t| spec.status.wants(t.done))
                .collect();
            QueryOutput { show: Show::Tasks, total: tasks.len(), tasks: tasks.into_iter().take(spec.limit).collect(), notes: Vec::new(), columns: Vec::new(), new_note: None }
        }
    })
}

/// The note's property `key`, compared case-insensitively.
fn property<'a>(note: &'a Note, key: &str) -> Option<&'a PropertyValue> {
    note.properties.iter().find(|p| p.key.eq_ignore_ascii_case(key)).map(|p| &p.value)
}

/// `[[Title|label]]` and `Title` both compare as `title`.
fn link_text(text: &str) -> String {
    let t = text.trim();
    let t = t.strip_prefix("[[").and_then(|t| t.strip_suffix("]]")).map_or(t, |inner| inner.split('|').next().unwrap_or(inner));
    normalize_title(t)
}

/// `today`, `today+7`, `today-1` or `2026-11-14`.
fn date_value(value: &str, today: NaiveDate) -> Option<NaiveDate> {
    let value = value.trim();
    if let Some(rest) = value.strip_prefix("today") {
        if rest.is_empty() {
            return Some(today);
        }
        let days: i64 = rest.strip_prefix('+').unwrap_or(rest).parse().ok()?;
        return today.checked_add_signed(TimeDelta::days(days));
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

impl PropertyFilter {
    fn matches(&self, value: Option<&PropertyValue>, today: NaiveDate) -> bool {
        let hit = match (&self.matcher, value) {
            (_, None) => false,
            (Match::Has, Some(v)) => !v.is_empty(),
            (Match::Equals(want), Some(v)) => equals(v, want, today),
            (Match::Range(lo, hi), Some(v)) => in_range(v, lo.as_deref(), hi.as_deref(), today),
        };
        hit != self.negate
    }
}

fn equals(value: &PropertyValue, want: &str, today: NaiveDate) -> bool {
    match value {
        PropertyValue::Number(n) => want.parse::<f64>().is_ok_and(|w| *n == w),
        PropertyValue::Checkbox(b) => matches!((b, want.to_lowercase().as_str()), (true, "true" | "yes") | (false, "false" | "no")),
        PropertyValue::Date(d) => date_value(want, today) == Some(*d),
        PropertyValue::Text(t) => link_text(t) == link_text(want),
        PropertyValue::List(items) => items.iter().any(|item| link_text(item) == link_text(want)),
        PropertyValue::Raw(_) => false,
    }
}

fn in_range(value: &PropertyValue, lo: Option<&str>, hi: Option<&str>, today: NaiveDate) -> bool {
    match value {
        PropertyValue::Number(n) => {
            let bound = |b: Option<&str>| b.map(|b| b.parse::<f64>().ok());
            match (bound(lo), bound(hi)) {
                (Some(None), _) | (_, Some(None)) => false,
                (lo, hi) => lo.flatten().is_none_or(|lo| *n >= lo) && hi.flatten().is_none_or(|hi| *n <= hi),
            }
        }
        PropertyValue::Date(d) => {
            let bound = |b: Option<&str>| b.map(|b| date_value(b, today));
            match (bound(lo), bound(hi)) {
                (Some(None), _) | (_, Some(None)) => false,
                (lo, hi) => lo.flatten().is_none_or(|lo| *d >= lo) && hi.flatten().is_none_or(|hi| *d <= hi),
            }
        }
        _ => false,
    }
}

/// Order two property values: numbers, dates and checkboxes by value, text
/// and lists (by their first item) alphabetically; different types by type.
fn compare(a: &PropertyValue, b: &PropertyValue) -> Ordering {
    fn rank(v: &PropertyValue) -> u8 {
        match v {
            PropertyValue::Number(_) => 0,
            PropertyValue::Date(_) => 1,
            PropertyValue::Checkbox(_) => 2,
            PropertyValue::Text(_) | PropertyValue::List(_) => 3,
            PropertyValue::Raw(_) => 4,
        }
    }
    let text = |v: &PropertyValue| v.texts().first().map(|t| link_text(t)).unwrap_or_default();
    match (a, b) {
        (PropertyValue::Number(x), PropertyValue::Number(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
        (PropertyValue::Date(x), PropertyValue::Date(y)) => x.cmp(y),
        (PropertyValue::Checkbox(x), PropertyValue::Checkbox(y)) => x.cmp(y),
        _ if rank(a) != rank(b) => rank(a).cmp(&rank(b)),
        _ => text(a).cmp(&text(b)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeDelta, Utc};

    fn note(id: &str, title: &str, tags: &[&str], folder: Option<&str>, age_minutes: i64) -> Note {
        let at = Utc::now() - TimeDelta::minutes(age_minutes);
        Note { id: id.into(), title: title.into(), preview: String::new(), tags: tags.iter().map(|t| t.to_string()).collect(), starred: false, folder_id: folder.map(Into::into), created_at: at, updated_at: at, word_count: 0, journal: None, properties: Vec::new() }
    }

    fn vault() -> (Vec<(Note, String)>, SearchIndex, Vec<FolderRecord>) {
        let notes = vec![
            (note("a", "Atlas", &["project/active"], Some("work"), 5), "# Atlas\n\n- [ ] Draft brief\n- [x] Kickoff\n#project/active".to_string()),
            (note("b", "Beacon", &["project/paused"], None, 1), "# Beacon\n\n- [ ] Revisit budget\n#project/paused".to_string()),
            (note("c", "Dashboard", &["project"], None, 0), "# Dashboard\n\n<query tag:project />\n- [ ] My own task\n#project".to_string()),
            (note("d", "Old", &["project"], Some("archive"), 9), "# Old\n\n- [ ] Archived task\n#project".to_string()),
        ];
        let index = SearchIndex::in_memory().unwrap();
        index.rebuild(notes.clone()).unwrap();
        let folders = vec![
            FolderRecord { id: "work".into(), name: "Work Stuff".into(), parent_id: None, sort_order: 0, icon: None },
            FolderRecord { id: "archive".into(), name: "Archive".into(), parent_id: None, sort_order: 1, icon: None },
        ];
        (notes, index, folders)
    }

    fn titles(out: &QueryOutput) -> Vec<&str> {
        out.notes.iter().map(|n| n.title.as_str()).collect()
    }

    #[test]
    fn lists_matching_notes_without_itself_or_archived_ones() {
        let (notes, index, folders) = vault();
        let out = run("tag:project", notes.clone(), Some(&index), &folders, Some("c")).unwrap();
        assert_eq!(titles(&out), vec!["Beacon", "Atlas"], "most recently edited first");
        let out = run("tag:project/active", notes.clone(), Some(&index), &folders, None).unwrap();
        assert_eq!(titles(&out), vec!["Atlas"]);
        let out = run("sort:title", notes.clone(), Some(&index), &folders, None).unwrap();
        assert_eq!(titles(&out), vec!["Atlas", "Beacon", "Dashboard"]);
        let out = run("folder:\"work stuff\"", notes.clone(), None, &folders, None).unwrap();
        assert_eq!(titles(&out), vec!["Atlas"], "folder names ignore case and may be quoted");
        let out = run("limit:1", notes, None, &folders, None).unwrap();
        assert_eq!((out.notes.len(), out.total), (1, 3));
    }

    #[test]
    fn lists_tasks_by_status() {
        let (notes, index, folders) = vault();
        let out = run("tag:project show:tasks", notes.clone(), Some(&index), &folders, Some("c")).unwrap();
        assert_eq!(out.tasks.iter().map(|t| t.text.as_str()).collect::<Vec<_>>(), vec!["Revisit budget", "Draft brief"]);
        let out = run("show:tasks status:done", notes, Some(&index), &folders, None).unwrap();
        assert_eq!(out.tasks.iter().map(|t| (t.note_title.as_str(), t.text.as_str(), t.line)).collect::<Vec<_>>(), vec![("Atlas", "Kickoff", 4)]);
    }

    fn with(mut n: Note, props: &[(&str, PropertyValue)]) -> Note {
        n.properties = props.iter().map(|(k, v)| Property { key: k.to_string(), value: v.clone() }).collect();
        n
    }

    #[test]
    fn filters_and_sorts_by_properties() {
        use PropertyValue::*;
        let day = |d: u32| Date(NaiveDate::from_ymd_opt(2026, 10, d).unwrap());
        let today = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let notes = vec![
            (with(note("a", "Atlas", &[], None, 3), &[("status", Text("active".into())), ("priority", Number(2.0)), ("due", day(20)), ("owner", Text("[[Sam Rivera]]".into()))]), String::new()),
            (with(note("b", "Beacon", &[], None, 2), &[("status", Text("Done".into())), ("priority", Number(1.0)), ("due", day(10)), ("team", List(vec!["Alex".into(), "[[Sam Rivera|Sam]]".into()]))]), String::new()),
            (with(note("c", "Comet", &[], None, 1), &[("status", Text("active".into())), ("priority", Number(3.0)), ("reviewed", Checkbox(true)), ("owner", Text(String::new()))]), String::new()),
            (note("d", "Dune", &[], None, 0), String::new()),
        ];
        let q = |raw: &str| run_at(raw, notes.clone(), None, &[], None, today).unwrap();
        let t = |raw: &str| titles(&q(raw)).into_iter().map(String::from).collect::<Vec<_>>();
        assert_eq!(t("status=active"), vec!["Comet", "Atlas"]);
        assert_eq!(t("status=done"), vec!["Beacon"], "text compares without case");
        assert_eq!(t("status!=done"), vec!["Dune", "Comet", "Atlas"], "notes without the property don't equal it");
        assert_eq!(t("-status=active"), vec!["Dune", "Beacon"]);
        assert_eq!(t("priority=2.."), vec!["Comet", "Atlas"]);
        assert_eq!(t("due=..today+7"), vec!["Beacon", "Atlas"]);
        assert_eq!(t("due=today.."), vec!["Atlas"]);
        assert_eq!(t("reviewed=true"), vec!["Comet"]);
        assert_eq!(t("owner=\"Sam Rivera\""), vec!["Atlas"], "links match by title");
        assert_eq!(t("team=[[sam rivera]]"), vec!["Beacon"], "lists match an item");
        assert_eq!(t("has:owner"), vec!["Atlas"], "an empty value isn't set");
        assert_eq!(t("-has:status"), vec!["Dune"]);
        assert_eq!(t("sort:priority"), vec!["Beacon", "Atlas", "Comet", "Dune"]);
        assert_eq!(t("sort:-due"), vec!["Atlas", "Beacon", "Dune", "Comet"], "notes without it last, most recent first");
        assert_eq!(q("status=active sort:due").columns, vec!["status", "due"]);
        assert_eq!(q("status=active").notes[0].properties.len(), 4);
    }

    #[test]
    fn tables_pick_columns_and_say_how_new_rows_start() {
        use PropertyValue::*;
        let today = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let folders = vec![FolderRecord { id: "work".into(), name: "Work".into(), parent_id: None, sort_order: 0, icon: None }];
        let notes = vec![
            (with(note("a", "Atlas", &[], Some("work"), 2), &[("status", Text("active".into())), ("owner", Text("Sam".into())), ("priority", Number(1.0))]), String::new()),
            (with(note("b", "Beacon", &[], Some("work"), 1), &[("status", Text("active".into())), ("priority", Number(2.0)), ("src", Raw("\n  a: b".into()))]), String::new()),
        ];
        let out = run_at("show:table status=active folder:Work", notes.clone(), None, &folders, None, today).unwrap();
        assert_eq!(out.show, Show::Table);
        assert_eq!(out.columns, vec!["status", "priority", "owner"], "named first, then the most used; raw YAML left out");
        assert_eq!(out.notes.len(), 2);
        assert_eq!(out.new_note, Some(NewNote { folder_id: Some("work".into()), tags: vec![], properties: vec![Property { key: "status".into(), value: Text("active".into()) }] }));

        let out = run_at("show:table columns:owner,updated priority=2 due=today -status=done", notes.clone(), None, &folders, None, today).unwrap();
        assert_eq!(out.columns, vec!["owner", "updated"]);
        let starts = out.new_note.unwrap().properties;
        assert_eq!(starts, vec![
            Property { key: "priority".into(), value: Number(2.0) },
            Property { key: "due".into(), value: Date(today) },
        ], "negated filters don't seed new notes");
        assert_eq!(run_at("columns:", notes, None, &folders, None, today).unwrap().columns, Vec::<String>::new());
    }

    #[test]
    fn explains_bad_options() {
        let (notes, index, folders) = vault();
        assert_eq!(run("show:grid", notes.clone(), Some(&index), &folders, None).unwrap_err(), "show: must be notes, tasks or table, not \"grid\"");
        assert!(run("has:", notes.clone(), Some(&index), &folders, None).unwrap_err().contains("property name"));
        assert!(run("folder:Nope", notes, Some(&index), &folders, None).unwrap_err().contains("no folder named"));
    }
}
