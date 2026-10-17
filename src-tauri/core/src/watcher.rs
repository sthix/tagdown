// Watches the vault for notes changed outside the app (another editor, git,
// a sync service) and tells the frontend, keeping the search index current.
//
// The app's own writes also produce file events. `FileTracker` remembers a
// fingerprint of every recent write per note file, so those are recognised and
// skipped; only content the app didn't write is reported.

use std::{
    collections::{hash_map::DefaultHasher, HashMap, HashSet, VecDeque},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};

use crate::{search_index::SearchIndex, vault::{is_hidden, note_from_meta, Vault}};

/// Own writes remembered per file. Autosave can write several times before
/// the first event is handled, so one fingerprint is not enough.
const RECENT_WRITES: usize = 16;
/// Events closer together than this are handled as one batch.
const SETTLE: Duration = Duration::from_millis(200);

#[derive(Debug, Default)]
pub struct FileTracker {
    seen: Mutex<HashMap<String, VecDeque<u64>>>,
}

fn fingerprint(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

fn file_key(path: &Path) -> Option<String> {
    path.file_name().and_then(|n| n.to_str()).map(str::to_string)
}

impl FileTracker {
    /// Remember content the app is about to write to `path`.
    pub fn record(&self, path: &Path, text: &str) {
        let (Some(key), Ok(mut seen)) = (file_key(path), self.seen.lock()) else { return };
        let recent = seen.entry(key).or_default();
        recent.push_back(fingerprint(text));
        if recent.len() > RECENT_WRITES {
            recent.pop_front();
        }
    }

    /// True when `text` is new for `path`: neither written by the app nor
    /// already reported. It is remembered either way.
    pub fn is_new(&self, path: &Path, text: &str) -> bool {
        let print = fingerprint(text);
        let (Some(key), Ok(seen)) = (file_key(path), self.seen.lock()) else { return true };
        let known = seen.get(&key).is_some_and(|recent| recent.contains(&print));
        drop(seen);
        if !known {
            self.record(path, text);
        }
        !known
    }

    pub fn forget(&self, path: &Path) {
        if let (Some(key), Ok(mut seen)) = (file_key(path), self.seen.lock()) {
            seen.remove(&key);
        }
    }
}

/// Keeps the watcher alive for as long as the app runs.
pub struct VaultWatcher(#[allow(dead_code)] RecommendedWatcher);

/// Watch `vault`, calling `emit(event, payload)` for each note changed or
/// removed outside the app, and once per burst of folder changes.
pub fn start(
    vault: Vault,
    search: Option<Arc<SearchIndex>>,
    emit: impl Fn(&'static str, Value) + Send + 'static,
) -> Result<VaultWatcher, String> {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let root = vault.root.clone();
    // Events name the real path (`/private/var/…` for `/var/…`); map them back.
    let real_root = fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        for path in event.paths {
            let path = match path.strip_prefix(&real_root) {
                Ok(rel) => root.join(rel),
                Err(_) => path,
            };
            if is_visible(&root, &path) {
                let _ = tx.send(path);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&vault.root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;

    let mut vault = vault;
    thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            // Editors and git touch files in bursts; collect until it settles.
            let mut batch = HashSet::from([first]);
            while let Ok(path) = rx.recv_timeout(SETTLE) {
                batch.insert(path);
            }
            // Folders may have changed in the app since the last burst.
            vault.reload_meta();
            let mut folders_changed = false;
            for path in batch {
                if is_note_file(&path) {
                    folders_changed |= handle_change(&emit, &vault, search.as_deref(), &path);
                } else if path.is_dir() || (!path.exists() && path.extension().is_none()) {
                    folders_changed = true;
                }
            }
            if folders_changed {
                emit("folders-changed-externally", json!({}));
            }
        }
    });
    Ok(VaultWatcher(watcher))
}

/// Inside the vault, not in a hidden folder such as `.tagdown` or `.git`, and
/// not in another vault kept inside this one.
fn is_visible(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|rel| !rel.components().any(|c| is_hidden(c.as_os_str())))
        && !path.ancestors().skip(1).take_while(|dir| *dir != root).any(crate::vaults::is_vault)
}

fn is_note_file(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some("md")
}

/// Report one changed note file. Returns true when it was moved rather than
/// removed, so the note list needs a refresh.
fn handle_change(emit: &impl Fn(&'static str, Value), vault: &Vault, search: Option<&SearchIndex>, path: &Path) -> bool {
    match fs::read_to_string(path) {
        Ok(raw) => {
            if !vault.tracker.is_new(path, &raw) {
                return false;
            }
            let Ok((meta, content)) = vault.read_note(path) else { return false };
            let note = note_from_meta(meta, &content);
            if let Some(index) = search {
                let result = if note.folder_id.as_deref() == Some("archive") { index.remove(&note.id) } else { index.upsert(&note, &content) };
                if let Err(e) = result {
                    eprintln!("search index: failed to update {}: {e}", note.id);
                }
            }
            emit("note-changed-externally", json!({ "note": note, "content": content }));
            false
        }
        Err(_) if !path.exists() => {
            let Some(id) = vault.id_at(path) else { return false };
            // Gone from here but still in the vault: moved to another folder.
            if vault.note_file_path(&id).is_ok() {
                return true;
            }
            vault.tracker.forget(path);
            if let Some(index) = search {
                let _ = index.remove(&id);
            }
            emit("note-removed-externally", json!({ "id": id }));
            false
        }
        Err(e) => {
            eprintln!("watcher: could not read {}: {e}", path.display());
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_skips_own_writes_and_repeated_reports() {
        let tracker = FileTracker::default();
        let path = Path::new("/vault/note-a.md");
        tracker.record(path, "first save");
        tracker.record(path, "second save");
        assert!(!tracker.is_new(path, "first save"), "an older own write is still recognised");
        assert!(!tracker.is_new(path, "second save"));
        assert!(tracker.is_new(path, "edited elsewhere"));
        assert!(!tracker.is_new(path, "edited elsewhere"), "reported once");
        tracker.forget(path);
        assert!(tracker.is_new(path, "second save"));
    }

    #[test]
    fn reports_outside_edits_and_removals_but_not_own_saves() {
        let dir = std::env::temp_dir().join(format!("tagdown-watch-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        let note = vault.create_note(None).unwrap();
        let path = vault.note_file_path(&note.id).unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = start(vault.clone(), None, move |event, payload| { let _ = tx.send((event, payload)); }).unwrap();
        thread::sleep(Duration::from_millis(500)); // let the watcher settle
        while rx.try_recv().is_ok() {}

        vault.save_note(&note.id, "# Mine\n\nSaved by the app.".into()).unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(2)).is_err(), "own saves are not reported");

        let raw = fs::read_to_string(&path).unwrap().replace("Saved by the app.", "Edited elsewhere.");
        fs::write(&path, raw).unwrap();
        let (event, payload) = rx.recv_timeout(Duration::from_secs(5)).expect("outside edit reported");
        assert_eq!(event, "note-changed-externally");
        assert_eq!(payload["content"], "# Mine\n\nEdited elsewhere.");
        assert_eq!(payload["note"]["id"], note.id.as_str());

        fs::remove_file(&path).unwrap();
        let (event, payload) = rx.recv_timeout(Duration::from_secs(5)).expect("removal reported");
        assert_eq!(event, "note-removed-externally");
        assert_eq!(payload["id"], note.id.as_str());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn folder_changes_and_moves_are_not_removals() {
        let dir = std::env::temp_dir().join(format!("tagdown-watch-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        let note = vault.create_note(None).unwrap();
        let path = vault.note_file_path(&note.id).unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = start(vault.clone(), None, move |event, _| { let _ = tx.send(event); }).unwrap();
        thread::sleep(Duration::from_millis(500));
        while rx.try_recv().is_ok() {}

        fs::create_dir(dir.join("Inbox")).unwrap();
        fs::rename(&path, dir.join("Inbox").join(path.file_name().unwrap())).unwrap();
        let mut events = Vec::new();
        while let Ok(event) = rx.recv_timeout(Duration::from_secs(2)) {
            events.push(event);
        }
        assert!(events.contains(&"folders-changed-externally"), "{events:?}");
        assert!(!events.contains(&"note-removed-externally"), "{events:?}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recognises_note_files() {
        let root = Path::new("/home/.me/v");
        assert!(is_note_file(Path::new("/home/.me/v/Work/notes.md")));
        assert!(is_visible(root, Path::new("/home/.me/v/Work/notes.md")), "hidden folders above the vault don't count");
        assert!(!is_visible(root, Path::new("/home/.me/v/.tagdown/x.md")));
        assert!(!is_visible(root, Path::new("/home/.me/v/.git/HEAD")));
    }
}
