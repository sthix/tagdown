// Local version history: snapshots of note bodies in `.tagdown/history/<note>/`.
//
// Saving keeps the version being replaced when the last snapshot is a few
// minutes old, or whenever a save removes most of a note. Older snapshots
// are thinned out: everything from the last hour, then one per hour for a
// day, one per day for a month, and one per week for a year.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, NaiveDateTime, TimeDelta, Utc};
use serde::Serialize;

use crate::frontmatter::{derive_preview, derive_title, word_count};

const SNAPSHOT_EVERY: TimeDelta = TimeDelta::minutes(2);
const ID_FORMAT: &str = "%Y%m%dT%H%M%S%.3fZ";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub title: String,
    pub preview: String,
    pub word_count: u32,
}

#[derive(Debug, Clone)]
pub struct History {
    dir: PathBuf,
}

/// Note and snapshot ids become path segments: allow only their own alphabets.
fn safe_segment(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.')) && !id.contains("..");
    if ok { Ok(id) } else { Err(format!("invalid id: {id}")) }
}

fn parse_id(id: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(id, ID_FORMAT).ok().map(|t| t.and_utc())
}

impl History {
    pub fn new(vault_root: &Path) -> Self {
        Self { dir: vault_root.join(".tagdown").join("history") }
    }

    fn note_dir(&self, note_id: &str) -> Result<PathBuf, String> {
        Ok(self.dir.join(safe_segment(note_id)?))
    }

    /// Called before `next` replaces `previous`: keep `previous` if enough time
    /// has passed since the last snapshot, or if most of the note is going away.
    pub fn before_save(&self, note_id: &str, previous: &str, next: &str, now: DateTime<Utc>) -> Result<(), String> {
        if previous == next || previous.trim().is_empty() {
            return Ok(());
        }
        let big_loss = previous.len() >= 200 && next.len() * 2 < previous.len();
        let due = self.ids(note_id)?.first().and_then(|id| parse_id(id)).is_none_or(|last| now - last >= SNAPSHOT_EVERY);
        if big_loss || due {
            self.snapshot(note_id, previous, now)?;
        }
        Ok(())
    }

    /// Keep `content` as a version now, unless it matches the latest one.
    pub fn snapshot(&self, note_id: &str, content: &str, now: DateTime<Utc>) -> Result<(), String> {
        let ids = self.ids(note_id)?;
        if let Some(latest) = ids.first() {
            if self.read(note_id, latest).is_ok_and(|text| text == content) {
                return Ok(());
            }
        }
        let dir = self.note_dir(note_id)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let id = now.format(ID_FORMAT).to_string();
        fs::write(dir.join(format!("{id}.md")), content).map_err(|e| e.to_string())?;
        self.prune(note_id, now)
    }

    /// Snapshot ids for a note, newest first.
    fn ids(&self, note_id: &str) -> Result<Vec<String>, String> {
        let Ok(entries) = fs::read_dir(self.note_dir(note_id)?) else { return Ok(Vec::new()) };
        let mut ids: Vec<String> = entries
            .filter_map(Result::ok)
            .filter_map(|e| e.file_name().to_str()?.strip_suffix(".md").map(str::to_string))
            .filter(|id| parse_id(id).is_some())
            .collect();
        ids.sort_unstable_by(|a, b| b.cmp(a));
        Ok(ids)
    }

    pub fn list(&self, note_id: &str) -> Result<Vec<Snapshot>, String> {
        let mut snapshots = Vec::new();
        for id in self.ids(note_id)? {
            let Ok(content) = self.read(note_id, &id) else { continue };
            let Some(created_at) = parse_id(&id) else { continue };
            snapshots.push(Snapshot {
                title: derive_title(&content),
                preview: derive_preview(&content),
                word_count: word_count(&content),
                created_at,
                id,
            });
        }
        Ok(snapshots)
    }

    pub fn read(&self, note_id: &str, snapshot_id: &str) -> Result<String, String> {
        let path = self.note_dir(note_id)?.join(format!("{}.md", safe_segment(snapshot_id)?));
        fs::read_to_string(path).map_err(|e| e.to_string())
    }

    pub fn remove_all(&self, note_id: &str) -> Result<(), String> {
        match fs::remove_dir_all(self.note_dir(note_id)?) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }

    /// Thin out old snapshots, keeping the newest in each time bucket.
    fn prune(&self, note_id: &str, now: DateTime<Utc>) -> Result<(), String> {
        let dir = self.note_dir(note_id)?;
        let mut buckets = HashSet::new();
        for id in self.ids(note_id)? {
            let Some(at) = parse_id(&id) else { continue };
            let age = now - at;
            let secs = at.timestamp();
            let bucket = if age < TimeDelta::hours(1) {
                Some(format!("s{secs}"))
            } else if age < TimeDelta::days(1) {
                Some(format!("h{}", secs / 3600))
            } else if age < TimeDelta::days(30) {
                Some(format!("d{}", secs / 86_400))
            } else if age < TimeDelta::days(365) {
                Some(format!("w{}", secs / 604_800))
            } else {
                None
            };
            if !bucket.is_some_and(|b| buckets.insert(b)) {
                let _ = fs::remove_file(dir.join(format!("{id}.md")));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn history() -> (History, PathBuf) {
        let root = std::env::temp_dir().join(format!("tagdown-history-{}", uuid::Uuid::new_v4()));
        (History::new(&root), root)
    }

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-12T12:00:00Z").unwrap().with_timezone(&Utc) + TimeDelta::minutes(minutes)
    }

    #[test]
    fn saves_snapshot_the_replaced_version_at_most_every_few_minutes() {
        let (h, root) = history();
        h.before_save("n", "# A\n\nv1", "# A\n\nv2", at(0)).unwrap();
        h.before_save("n", "# A\n\nv2", "# A\n\nv3", at(1)).unwrap();
        h.before_save("n", "# A\n\nv3", "# A\n\nv4", at(3)).unwrap();
        let list = h.list("n").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(h.read("n", &list[0].id).unwrap(), "# A\n\nv3");
        assert_eq!(h.read("n", &list[1].id).unwrap(), "# A\n\nv1");
        assert_eq!(list[0].title, "A");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_save_that_removes_most_of_a_note_is_always_snapshotted() {
        let (h, root) = history();
        let long = format!("# Long\n\n{}", "words ".repeat(60));
        h.before_save("n", "# Long\n\nshort", &long, at(0)).unwrap();
        h.before_save("n", &long, "# Long", at(1)).unwrap();
        assert_eq!(h.read("n", &h.list("n").unwrap()[0].id).unwrap(), long);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn identical_content_is_not_snapshotted_twice() {
        let (h, root) = history();
        h.snapshot("n", "same", at(0)).unwrap();
        h.snapshot("n", "same", at(10)).unwrap();
        assert_eq!(h.list("n").unwrap().len(), 1);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn old_snapshots_are_thinned_out() {
        let (h, root) = history();
        // Every 10 minutes for three days.
        for i in 0..(3 * 24 * 6) {
            h.snapshot("n", &format!("v{i}"), at(i * 10)).unwrap();
        }
        let now = at(3 * 24 * 60);
        let list = h.list("n").unwrap();
        let ages: Vec<TimeDelta> = list.iter().map(|s| now - s.created_at).collect();
        let last_hour = ages.iter().filter(|a| **a <= TimeDelta::hours(1)).count();
        let last_day = ages.iter().filter(|a| **a > TimeDelta::hours(1) && **a < TimeDelta::days(1)).count();
        assert_eq!(last_hour, 6, "everything from the last hour");
        assert!((22..=24).contains(&last_day), "about one per hour for a day, got {last_day}");
        assert!(list.len() < 40, "older days collapse to one each, got {}", list.len());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_path_tricks() {
        let (h, _) = history();
        assert!(h.read("../x", "20261012T120000.000Z").is_err());
        assert!(h.read("n", "../../vault").is_err());
    }
}
