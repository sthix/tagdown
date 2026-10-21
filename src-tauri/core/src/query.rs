// Live query blocks: `<query tag:project show:tasks />` in a note lists the
// notes or tasks across the vault that match.
//
// A query is a search (the same syntax as everywhere else: words, "phrases",
// tag:, title:, -exclusions) plus display options:
//   show:notes | tasks | table     what to list (notes by default); a table has
//        | board | cards           a column per property, editable in the app; a
//                                  board has a lane per value of one property;
//                                  cards show a cover image and the opening lines
//   columns:status,due,updated     the table's columns (title always comes first),
//                                  or the properties cards show;
//                                  updated, created, folder and tags are the note's own
//   group:status                   the property a board's lanes are values of (status by default)
//   lanes:todo,doing,done          a board's lanes in this order, empty ones too
//   type:Book                      notes of a type, the same as type=Book (see types.rs)
//   date:today | overdue | upcoming tasks by their day (see tasks.rs): today and
//        | week | none | any          earlier, before today, after today, within
//        | 2026-10-20 | today+1      a week (and earlier), without one, with one, or that day
//   priority:high | medium | low    tasks with that priority
//   sort:date | sort:priority      tasks in order of their day (undated last) or priority
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
    types::TYPE_KEY,
};

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Show {
    Notes,
    Tasks,
    Table,
    Board,
    Cards,
}

impl Show {
    /// Views of notes that can add a note matching the query.
    fn adds_notes(self) -> bool {
        matches!(self, Show::Table | Show::Board | Show::Cards)
    }
}

/// Columns a table shows when the query doesn't name them, besides the ones it filters or sorts by.
const TABLE_COLUMNS: usize = 5;
/// The property a board groups by when the query doesn't say.
const DEFAULT_GROUP: &str = "status";
/// The property naming a card's cover image.
const COVER_KEY: &str = "cover";
const EXCERPT_CHARS: usize = 180;

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

/// Which tasks `date:` keeps.
#[derive(Debug, Clone, Copy, PartialEq)]
enum DateFilter {
    Upto(NaiveDate),
    Before(NaiveDate),
    After(NaiveDate),
    On(NaiveDate),
    Undated,
    Dated,
}

impl DateFilter {
    fn parse(value: &str, today: NaiveDate) -> Result<Self, String> {
        Ok(match value.to_lowercase().as_str() {
            "today" => DateFilter::Upto(today),
            "overdue" => DateFilter::Before(today),
            "upcoming" => DateFilter::After(today),
            "week" => DateFilter::Upto(today + TimeDelta::days(7)),
            "none" => DateFilter::Undated,
            "any" => DateFilter::Dated,
            other => DateFilter::On(date_value(other, today).ok_or_else(|| format!("date: must be today, overdue, upcoming, week, none, any or a day, not \"{value}\""))?),
        })
    }

    fn wants(self, date: Option<NaiveDate>) -> bool {
        match (self, date) {
            (DateFilter::Undated, d) => d.is_none(),
            (_, None) => false,
            (DateFilter::Dated, Some(_)) => true,
            (DateFilter::Upto(day), Some(d)) => d <= day,
            (DateFilter::Before(day), Some(d)) => d < day,
            (DateFilter::After(day), Some(d)) => d > day,
            (DateFilter::On(day), Some(d)) => d == day,
        }
    }
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
    /// `group:` as written, if given.
    group: Option<String>,
    /// `lanes:` as written.
    lanes: Vec<String>,
    /// `date:` for tasks, as written.
    task_date: Option<String>,
    /// `priority:` for tasks: 1 high, 2 medium, 3 low.
    task_priority: Option<u8>,
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
    /// For cards: the opening lines, as plain text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    /// For cards: the `cover:` property, else the note's first image.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
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
    /// For a table, board or cards: what a note added to it starts with.
    pub new_note: Option<NewNote>,
    /// For a board: the property its lanes are values of.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// For a board: the lanes the query names, in order (`lanes:`).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lanes: Vec<String>,
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
    let mut spec = Spec { filter: String::new(), show: Show::Notes, status: TaskFilter::Open, sort: Sort::Updated, folder: None, limit: DEFAULT_LIMIT, properties: Vec::new(), columns: None, tags: Vec::new(), group: None, lanes: Vec::new(), task_date: None, task_priority: None };
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
                "board" => Show::Board,
                "cards" => Show::Cards,
                _ => return Err(format!("show: must be notes, tasks, table, board or cards, not \"{value}\"")),
            },
            "columns" => spec.columns = Some(list_option(value)),
            "group" => spec.group = Some(value.to_string()).filter(|g| !g.is_empty()),
            "lanes" => spec.lanes = list_option(value),
            "date" => spec.task_date = Some(value.to_string()),
            "priority" => spec.task_priority = Some(match value.to_lowercase().as_str() {
                "high" => 1,
                "medium" => 2,
                "low" => 3,
                _ => return Err(format!("priority: must be high, medium or low, not \"{value}\"")),
            }),
            "type" | "-type" => {
                if value.is_empty() {
                    return Err("type: needs a type, like type:Book".into());
                }
                spec.properties.push(PropertyFilter { key: TYPE_KEY.into(), negate: key.starts_with('-'), matcher: Match::Equals(value.to_string()) });
            }
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

/// `a,b,c` as a list, blanks left out.
fn list_option(value: &str) -> Vec<String> {
    value.split(',').map(str::trim).filter(|c| !c.is_empty()).map(String::from).collect()
}

/// Run `raw` over `notes`. The note holding the query (`exclude_id`) is left
/// out, so a dashboard doesn't list itself.
pub fn run(raw: &str, notes: Vec<(Note, String)>, index: Option<&SearchIndex>, folders: &[FolderRecord], exclude_id: Option<&str>) -> Result<QueryOutput, String> {
    run_at(raw, notes, index, folders, exclude_id, Local::now().date_naive())
}

/// `run`, with `today` for dates like `today+7`.
pub fn run_at(raw: &str, notes: Vec<(Note, String)>, index: Option<&SearchIndex>, folders: &[FolderRecord], exclude_id: Option<&str>, today: NaiveDate) -> Result<QueryOutput, String> {
    let spec = parse(raw)?;
    let task_date = spec.task_date.as_deref().map(|d| DateFilter::parse(d, today)).transpose()?;
    let group = (spec.show == Show::Board).then(|| spec.group.clone().unwrap_or_else(|| DEFAULT_GROUP.into()));
    let mut columns: Vec<String> = Vec::new();
    let sort_key = match &spec.sort { Sort::Property { key, .. } => Some(key), _ => None };
    for key in spec.properties.iter().map(|p| &p.key).chain(sort_key) {
        // A board's lanes already say its group; a type filter needn't be repeated on every card.
        let implied = group.as_ref().is_some_and(|g| g.eq_ignore_ascii_case(key)) || (spec.show != Show::Table && key.eq_ignore_ascii_case(TYPE_KEY));
        if !implied && !columns.iter().any(|c| c.eq_ignore_ascii_case(key)) {
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

    let types = if spec.properties.iter().any(|f| f.key.eq_ignore_ascii_case(TYPE_KEY)) {
        crate::types::list_types(&notes.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>())
    } else { Vec::new() };
    let mut selected: Vec<(Note, String)> = notes
        .into_iter()
        .filter(|(n, _)| Some(n.id.as_str()) != exclude_id)
        .filter(|(n, _)| match &folder_id {
            Some(id) => n.folder_id.as_ref() == Some(id),
            None => n.folder_id.as_deref() != Some("archive"),
        })
        .filter(|(n, _)| matching.as_ref().is_none_or(|ids| ids.contains(&n.id)))
        .filter(|(n, _)| spec.properties.iter().all(|f| {
            if f.key.eq_ignore_ascii_case(TYPE_KEY) && crate::types::template_type(&n.title).is_none() {
                if let Match::Equals(wanted) = &f.matcher {
                    let name = n.journal.map(|_| "Journal".to_string()).or_else(|| crate::types::type_of(n));
                    let hit = name.is_some_and(|name| {
                        link_text(&name) == link_text(wanted) || types.iter().find(|t| normalize_title(&t.name) == normalize_title(&name))
                            .is_some_and(|t| t.ancestors.iter().any(|a| link_text(a) == link_text(wanted)))
                    });
                    return hit != f.negate;
                }
            }
            f.matches(property(n, &f.key), today)
        }))
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
    let new_note = spec.show.adds_notes().then(|| NewNote {
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
        Show::Notes | Show::Table | Show::Board | Show::Cards => QueryOutput {
            show: spec.show,
            total: selected.len(),
            notes: selected
                .into_iter()
                .take(spec.limit)
                .map(|(n, content)| {
                    let (excerpt, cover) = if spec.show == Show::Cards { (Some(excerpt(&content)), cover(&n, &content)) } else { (None, None) };
                    QueryNote { folder: folder_name(&n.folder_id), id: n.id, title: n.title, tags: n.tags, updated_at: n.updated_at, created_at: n.created_at, properties: n.properties, excerpt, cover }
                })
                .collect(),
            tasks: Vec::new(),
            columns,
            new_note,
            group,
            lanes: if spec.show == Show::Board { spec.lanes } else { Vec::new() },
        },
        Show::Tasks => {
            let mut tasks: Vec<Task> = selected
                .iter()
                .flat_map(|(n, content)| parse_tasks(n, content))
                .filter(|t| spec.status.wants(t.done))
                .filter(|t| task_date.is_none_or(|f| f.wants(t.date)))
                .filter(|t| spec.task_priority.is_none_or(|p| t.priority == Some(p)))
                .collect();
            // Ordered by day or priority, the other breaking ties; tasks without either go last.
            let last = |v: Option<u8>| v.unwrap_or(u8::MAX);
            match &spec.sort {
                Sort::Property { key, desc } if key.eq_ignore_ascii_case("date") => tasks.sort_by(|a, b| {
                    let by_day = match (a.date, b.date) {
                        (Some(x), Some(y)) => if *desc { y.cmp(&x) } else { x.cmp(&y) },
                        (Some(_), None) => Ordering::Less,
                        (None, Some(_)) => Ordering::Greater,
                        (None, None) => Ordering::Equal,
                    };
                    by_day.then(last(a.priority).cmp(&last(b.priority)))
                }),
                Sort::Property { key, desc } if key.eq_ignore_ascii_case("priority") => tasks.sort_by(|a, b| {
                    let by_priority = if *desc { last(b.priority).cmp(&last(a.priority)) } else { last(a.priority).cmp(&last(b.priority)) };
                    by_priority.then(a.date.map_or(NaiveDate::MAX, |d| d).cmp(&b.date.map_or(NaiveDate::MAX, |d| d)))
                }),
                _ => {}
            }
            QueryOutput { show: Show::Tasks, total: tasks.len(), tasks: tasks.into_iter().take(spec.limit).collect(), notes: Vec::new(), columns: Vec::new(), new_note: None, group: None, lanes: Vec::new() }
        }
    })
}

/// A card's cover: the `cover:` property (a path or URL), else the first image in the note.
fn cover(note: &Note, content: &str) -> Option<String> {
    if let Some(value) = property(note, COVER_KEY).and_then(|v| v.texts().first().map(|t| t.trim().to_string())).filter(|t| !t.is_empty()) {
        return Some(value);
    }
    first_image(content)
}

/// The source of the first `![alt](src)`, `<figure src=…>` or `<img src=…>` outside code.
fn first_image(content: &str) -> Option<String> {
    let mut fenced = false;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let markdown_at = line.find("![");
        let tag_at = ["<figure", "<img"].iter().filter_map(|tag| line.find(tag)).min();
        let src = match (markdown_at, tag_at) {
            (Some(m), t) if t.is_none_or(|t| m < t) => markdown_src(&line[m..]),
            (_, Some(t)) => tag_src(&line[t..]),
            _ => None,
        };
        if let Some(src) = src.filter(|s| !s.is_empty()) {
            return Some(src);
        }
    }
    None
}

/// `src` of `![alt](src "title")`.
fn markdown_src(text: &str) -> Option<String> {
    let target = &text[text.find("](")? + 2..];
    let target = &target[..target.find(')')?];
    Some(target.split_whitespace().next().unwrap_or_default().trim_matches(['<', '>']).to_string())
}

/// `src` of `<figure src=a.png …>` or `<img src="a.png">`.
fn tag_src(text: &str) -> Option<String> {
    let src = &text[text.find("src=")? + 4..];
    let value = match src.chars().next()? {
        q @ ('"' | '\'') => src[1..].split(q).next()?,
        _ => src.split(|c: char| c.is_whitespace() || c == '>').next()?.trim_end_matches('/'),
    };
    Some(value.to_string())
}

/// A note's opening prose as plain text: no headings, components, code or
/// tables, links shown as their labels, formatting marks dropped.
fn excerpt(content: &str) -> String {
    let mut out = String::new();
    let mut fenced = false;
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with("```") || t.starts_with("~~~") || t.starts_with("$$") {
            fenced = !fenced;
            continue;
        }
        if fenced || t.is_empty() || t.starts_with(['#', '<', '|', '!']) || t.starts_with(":::") || t.starts_with("---") || t.starts_with("^") {
            continue;
        }
        let t = t.trim_start_matches(['>', ' ']);
        let t = t.strip_prefix("- [ ] ").or_else(|| t.strip_prefix("- [x] ")).or_else(|| t.strip_prefix("- ")).or_else(|| t.strip_prefix("* ")).unwrap_or(t);
        let text = plain_inline(t);
        if text.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&text);
        if out.chars().count() >= EXCERPT_CHARS {
            break;
        }
    }
    if out.chars().count() > EXCERPT_CHARS {
        let cut: String = out.chars().take(EXCERPT_CHARS).collect();
        out = format!("{}…", cut.trim_end_matches(|c: char| !c.is_whitespace()).trim_end());
    }
    out
}

/// One line of Markdown as plain text.
fn plain_inline(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    while !rest.is_empty() {
        if let Some(inner) = rest.strip_prefix("[[") {
            if let Some(end) = inner.find("]]") {
                let target = &inner[..end];
                let label = target.split_once('|').map_or_else(|| target.split('#').next().unwrap_or(target), |(_, l)| l);
                out.push_str(label);
                rest = &inner[end + 2..];
                continue;
            }
        }
        if let Some(inner) = rest.strip_prefix('[') {
            if let Some((label, after)) = inner.split_once("](") {
                if let Some(end) = after.find(')') {
                    out.push_str(label);
                    rest = &after[end + 1..];
                    continue;
                }
            }
        }
        let c = rest.chars().next().unwrap();
        if !matches!(c, '*' | '`' | '~' | '=') {
            out.push(c);
        }
        rest = &rest[c.len_utf8()..];
    }
    // A trailing ^block-id is a marker, not text.
    let out = out.trim();
    match out.rsplit_once(" ^") {
        Some((before, id)) if !id.is_empty() && id.chars().all(|c| c.is_alphanumeric() || c == '-') => before.trim().to_string(),
        _ => out.to_string(),
    }
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
        v if v.number().is_some() => want.parse::<f64>().is_ok_and(|w| v.number() == Some(w)),
        PropertyValue::Checkbox(b) => matches!((b, want.to_lowercase().as_str()), (true, "true" | "yes") | (false, "false" | "no")),
        PropertyValue::Date(d) => date_value(want, today) == Some(*d),
        PropertyValue::Datetime(t) => date_value(want, today).map_or_else(|| t == want || t.strip_suffix(":00") == Some(want), |d| t.starts_with(&d.to_string())),
        PropertyValue::Raw(_) => false,
        v => v.texts().iter().any(|t| link_text(t) == link_text(want)),
    }
}

fn in_range(value: &PropertyValue, lo: Option<&str>, hi: Option<&str>, today: NaiveDate) -> bool {
    match value {
        v if v.number().is_some() => {
            let n = v.number().unwrap();
            let bound = |b: Option<&str>| b.map(|b| b.parse::<f64>().ok());
            match (bound(lo), bound(hi)) {
                (Some(None), _) | (_, Some(None)) => false,
                (lo, hi) => lo.flatten().is_none_or(|lo| n >= lo) && hi.flatten().is_none_or(|hi| n <= hi),
            }
        }
        PropertyValue::Date(d) => {
            let bound = |b: Option<&str>| b.map(|b| date_value(b, today));
            match (bound(lo), bound(hi)) {
                (Some(None), _) | (_, Some(None)) => false,
                (lo, hi) => lo.flatten().is_none_or(|lo| *d >= lo) && hi.flatten().is_none_or(|hi| *d <= hi),
            }
        }
        PropertyValue::Datetime(t) => {
            let bound = |b: &str, end: bool| date_value(b, today).map(|d| format!("{d}T{}", if end { "23:59:59" } else { "00:00:00" }))
                .or_else(|| chrono::NaiveDateTime::parse_from_str(b, "%Y-%m-%dT%H:%M:%S").or_else(|_| chrono::NaiveDateTime::parse_from_str(b, "%Y-%m-%dT%H:%M")).ok().map(|d| d.format("%Y-%m-%dT%H:%M:%S").to_string()));
            lo.is_none_or(|lo| bound(lo, false).is_some_and(|lo| *t >= lo)) && hi.is_none_or(|hi| bound(hi, true).is_some_and(|hi| *t <= hi))
        }
        _ => false,
    }
}

/// Order two property values: numbers, dates and checkboxes by value, text
/// and lists (by their first item) alphabetically; different types by type.
fn compare(a: &PropertyValue, b: &PropertyValue) -> Ordering {
    fn rank(v: &PropertyValue) -> u8 {
        match v {
            v if v.number().is_some() => 0,
            PropertyValue::Date(_) | PropertyValue::Datetime(_) => 1,
            PropertyValue::Checkbox(_) => 2,
            PropertyValue::Raw(_) => 4,
            _ => 3,
        }
    }
    let text = |v: &PropertyValue| v.texts().first().map(|t| link_text(t)).unwrap_or_default();
    match (a, b) {
        (x, y) if x.number().is_some() && y.number().is_some() => x.number().partial_cmp(&y.number()).unwrap_or(Ordering::Equal),
        (PropertyValue::Date(x), PropertyValue::Date(y)) => x.cmp(y),
        (PropertyValue::Datetime(x), PropertyValue::Datetime(y)) => x.cmp(y),
        (PropertyValue::Date(_), PropertyValue::Datetime(_)) | (PropertyValue::Datetime(_), PropertyValue::Date(_)) => a.display().cmp(&b.display()),
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
        Note { id: id.into(), title: title.into(), preview: String::new(), tags: tags.iter().map(|t| t.to_string()).collect(), starred: false, folder_id: folder.map(Into::into), created_at: at, updated_at: at, word_count: 0, journal: None, properties: Vec::new(), path: String::new() }
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
    fn specialized_properties_filter_and_sort_by_their_underlying_values() {
        use PropertyValue::*;
        let today = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
        for value in [Currency(12.5), Percent(12.5), Duration(12.5), Rating(4.0)] {
            let n = value.number().unwrap();
            assert!(equals(&value, &n.to_string(), today));
            assert!(in_range(&value, Some("0"), Some("20"), today));
            assert_eq!(compare(&value, &Number(n + 1.0)), Ordering::Less);
        }
        assert!(equals(&Select("Doing".into()), "doing", today));
        assert!(equals(&Multiselect(vec!["Doing".into(), "Important".into()]), "important", today));
        let dt = Datetime("2026-10-19T14:30:00".into());
        assert!(equals(&dt, "today", today));
        assert!(in_range(&dt, Some("today"), Some("today"), today));
        assert!(!in_range(&dt, Some("2026-10-19T15:00"), None, today));
        assert_eq!(compare(&dt, &Datetime("2026-10-20T09:00:00".into())), Ordering::Less);
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
    fn boards_group_by_a_property_and_cards_show_covers() {
        use PropertyValue::*;
        let today = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let notes = vec![
            (with(note("a", "Atlas", &[], None, 2), &[("type", Text("Project".into())), ("status", Text("doing".into())), ("owner", Text("Sam".into()))]), "# Atlas\n\n::: tip Goal\nShip.\n:::\n\nThe **launch** plan for [[Beacon|the beacon]]. ^intro\n\n![Map](attachments/map.png \"Map\")".to_string()),
            (with(note("b", "Beacon", &[], None, 1), &[("type", Text("project".into())), ("cover", Text("https://example.com/b.jpg".into()))]), "# Beacon\n\n<figure src=\"x.png\" />".to_string()),
            (with(note("c", "Comet", &[], None, 0), &[("type", Text("Book".into()))]), "# Comet\n\n```\n![no](code.png)\n```\n- [ ] Read it".to_string()),
        ];
        let q = |raw: &str| run_at(raw, notes.clone(), None, &[], None, today).unwrap();

        let board = q("show:board type:project lanes:todo,doing");
        assert_eq!((board.show, board.group.as_deref(), board.lanes.clone()), (Show::Board, Some("status"), vec!["todo".to_string(), "doing".into()]));
        assert_eq!(titles(&board), vec!["Beacon", "Atlas"], "type: matches without case");
        assert!(board.columns.is_empty(), "neither the group nor the type repeats on cards");
        assert_eq!(board.new_note.unwrap().properties, vec![Property { key: "type".into(), value: Text("project".into()) }]);
        assert_eq!(q("show:board group:owner sort:owner").group.as_deref(), Some("owner"));
        assert_eq!(titles(&q("-type:project")), vec!["Comet"]);

        let cards = q("show:cards sort:title");
        let shown: Vec<(&str, Option<&str>, Option<&str>)> = cards.notes.iter().map(|n| (n.title.as_str(), n.cover.as_deref(), n.excerpt.as_deref())).collect();
        assert_eq!(shown, vec![
            ("Atlas", Some("attachments/map.png"), Some("Ship. The launch plan for the beacon.")),
            ("Beacon", Some("https://example.com/b.jpg"), Some("")),
            ("Comet", None, Some("Read it")),
        ], "the cover property first, then the first image outside code");
        assert!(q("show:table").notes[0].excerpt.is_none(), "only cards carry excerpts");
    }

    #[test]
    fn filters_and_orders_tasks_by_day_and_priority() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let notes = vec![
            (note("a", "Atlas", &[], None, 1), "# Atlas\n\n- [ ] Late [[2026-10-14]]\n- [ ] Now !low [[2026-10-15]]\n- [ ] Urgent now [[2026-10-15]] !high\n- [ ] Someday\n- [ ] Next week [[2026-10-22]] !medium\n- [ ] Far [[2026-12-01]]".to_string()),
        ];
        let t = |raw: &str| run_at(raw, notes.clone(), None, &[], None, today).unwrap().tasks.iter().map(|t| t.label.clone()).collect::<Vec<_>>();
        assert_eq!(t("show:tasks date:today sort:date"), vec!["Late [[2026-10-14]]", "Urgent now [[2026-10-15]]", "Now [[2026-10-15]]"], "overdue first; then by priority");
        assert_eq!(t("show:tasks date:overdue"), vec!["Late [[2026-10-14]]"]);
        assert_eq!(t("show:tasks date:upcoming sort:date"), vec!["Next week [[2026-10-22]]", "Far [[2026-12-01]]"]);
        assert_eq!(t("show:tasks date:week"), vec!["Late [[2026-10-14]]", "Now [[2026-10-15]]", "Urgent now [[2026-10-15]]", "Next week [[2026-10-22]]"]);
        assert_eq!(t("show:tasks date:none"), vec!["Someday"]);
        assert_eq!(t("show:tasks date:today+7"), vec!["Next week [[2026-10-22]]"]);
        assert_eq!(t("show:tasks priority:high"), vec!["Urgent now [[2026-10-15]]"]);
        assert_eq!(t("show:tasks sort:priority")[..3], ["Urgent now [[2026-10-15]]", "Next week [[2026-10-22]]", "Now [[2026-10-15]]"]);
        assert!(run_at("show:tasks date:soon", notes.clone(), None, &[], None, today).unwrap_err().contains("date: must be"));
        assert!(run_at("show:tasks priority:urgent", notes, None, &[], None, today).unwrap_err().contains("priority: must be"));
    }

    #[test]
    fn explains_bad_options() {
        let (notes, index, folders) = vault();
        assert_eq!(run("show:grid", notes.clone(), Some(&index), &folders, None).unwrap_err(), "show: must be notes, tasks, table, board or cards, not \"grid\"");
        assert!(run("has:", notes.clone(), Some(&index), &folders, None).unwrap_err().contains("property name"));
        assert!(run("folder:Nope", notes.clone(), Some(&index), &folders, None).unwrap_err().contains("no folder named"));
        assert!(run("type:", notes, Some(&index), &folders, None).unwrap_err().contains("needs a type"));
    }
}
