// Live query blocks: `<query tag:project show:tasks />` in a note lists the
// notes or tasks across the vault that match.
//
// A query is a search (the same syntax as everywhere else: words, "phrases",
// tag:, title:, -exclusions) plus display options:
//   show:notes | show:tasks        what to list (notes by default)
//   status:open | done | all       which tasks (open by default)
//   sort:updated | created | title order (most recently edited first by default)
//   folder:Name                    only notes in this folder ("quote" names with spaces)
//   limit:N                        at most N items (50 by default)

use serde::Serialize;

use crate::{
    links::normalize_title,
    models::{FolderRecord, Note},
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sort {
    Updated,
    Created,
    Title,
}

#[derive(Debug, PartialEq)]
struct Spec {
    filter: String,
    show: Show,
    status: TaskFilter,
    sort: Sort,
    folder: Option<String>,
    limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryNote {
    pub id: String,
    pub title: String,
    pub folder: Option<String>,
    pub tags: Vec<String>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOutput {
    pub show: Show,
    pub notes: Vec<QueryNote>,
    pub tasks: Vec<Task>,
    /// Matches before `limit` was applied.
    pub total: usize,
}

/// Split a query into tokens, keeping "quoted phrases" (and `key:"quoted value"`) together.
fn tokens(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for c in raw.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                current.push(c);
            }
            c if c.is_whitespace() && !quoted => {
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

fn parse(raw: &str) -> Result<Spec, String> {
    let mut spec = Spec { filter: String::new(), show: Show::Notes, status: TaskFilter::Open, sort: Sort::Updated, folder: None, limit: DEFAULT_LIMIT };
    let mut filter = Vec::new();
    for token in tokens(raw) {
        let Some((key, value)) = token.split_once(':') else {
            filter.push(token);
            continue;
        };
        let value = value.trim_matches('"');
        match key.to_lowercase().as_str() {
            "show" => spec.show = match value {
                "notes" => Show::Notes,
                "tasks" => Show::Tasks,
                _ => return Err(format!("show: must be notes or tasks, not \"{value}\"")),
            },
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
                _ => return Err(format!("sort: must be updated, created or title, not \"{value}\"")),
            },
            "limit" => spec.limit = value.parse::<usize>().map_err(|_| format!("limit: must be a number, not \"{value}\""))?.clamp(1, MAX_LIMIT),
            "folder" => spec.folder = Some(value.to_string()),
            // tag:, title:, and anything else belong to the search.
            _ => filter.push(token),
        }
    }
    spec.filter = filter.join(" ");
    Ok(spec)
}

/// Run `raw` over `notes`. The note holding the query (`exclude_id`) is left
/// out, so a dashboard doesn't list itself.
pub fn run(raw: &str, notes: Vec<(Note, String)>, index: Option<&SearchIndex>, folders: &[FolderRecord], exclude_id: Option<&str>) -> Result<QueryOutput, String> {
    let spec = parse(raw)?;
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
        .collect();
    match spec.sort {
        Sort::Updated => selected.sort_by(|a, b| b.0.updated_at.cmp(&a.0.updated_at)),
        Sort::Created => selected.sort_by(|a, b| b.0.created_at.cmp(&a.0.created_at)),
        Sort::Title => selected.sort_by_key(|(n, _)| n.title.to_lowercase()),
    }

    let folder_name = |id: &Option<String>| id.as_ref().and_then(|id| folders.iter().find(|f| &f.id == id)).map(|f| f.name.clone());
    Ok(match spec.show {
        Show::Notes => QueryOutput {
            show: Show::Notes,
            total: selected.len(),
            notes: selected
                .into_iter()
                .take(spec.limit)
                .map(|(n, _)| QueryNote { folder: folder_name(&n.folder_id), id: n.id, title: n.title, tags: n.tags, updated_at: n.updated_at })
                .collect(),
            tasks: Vec::new(),
        },
        Show::Tasks => {
            let tasks: Vec<Task> = selected
                .iter()
                .flat_map(|(n, content)| parse_tasks(n, content))
                .filter(|t| spec.status.wants(t.done))
                .collect();
            QueryOutput { show: Show::Tasks, total: tasks.len(), tasks: tasks.into_iter().take(spec.limit).collect(), notes: Vec::new() }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeDelta, Utc};

    fn note(id: &str, title: &str, tags: &[&str], folder: Option<&str>, age_minutes: i64) -> Note {
        let at = Utc::now() - TimeDelta::minutes(age_minutes);
        Note { id: id.into(), title: title.into(), preview: String::new(), tags: tags.iter().map(|t| t.to_string()).collect(), starred: false, folder_id: folder.map(Into::into), created_at: at, updated_at: at, word_count: 0, journal: None }
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

    #[test]
    fn explains_bad_options() {
        let (notes, index, folders) = vault();
        assert_eq!(run("show:table", notes.clone(), Some(&index), &folders, None).unwrap_err(), "show: must be notes or tasks, not \"table\"");
        assert!(run("folder:Nope", notes, Some(&index), &folders, None).unwrap_err().contains("no folder named"));
    }
}
