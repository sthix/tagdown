// Writing a published website to disk. The pages are rendered by the app;
// this places the files, and on republishing removes pages it wrote last time
// that are gone now. It only ever deletes files listed in its own manifest.

use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};

const MANIFEST: &str = ".tagdown-site.json";

#[derive(Debug, Clone, Deserialize)]
pub struct SiteFile {
    /// Path inside the site, e.g. `notes/meeting-notes.html`.
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteDir {
    pub exists: bool,
    pub empty: bool,
    /// Tagdown published here before, so its files can be replaced.
    pub tagdown_site: bool,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct Manifest {
    files: Vec<String>,
}

pub fn inspect(dir: &Path) -> SiteDir {
    let Ok(mut entries) = fs::read_dir(dir) else { return SiteDir { exists: false, empty: true, tagdown_site: false } };
    let empty = entries.all(|e| e.is_ok_and(|e| e.file_name() == ".DS_Store"));
    SiteDir { exists: true, empty, tagdown_site: dir.join(MANIFEST).is_file() }
}

/// A relative path that stays inside the site folder.
fn safe_relative(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    let ok = !path.is_empty() && p.components().all(|c| matches!(c, Component::Normal(_)));
    if ok { Ok(p.to_path_buf()) } else { Err(format!("invalid site path: {path}")) }
}

/// Write `files` into `dir`, replacing the previous publish. Returns how many
/// stale files from the previous publish were removed.
pub fn write(dir: &Path, files: &[SiteFile]) -> Result<usize, String> {
    let paths: Vec<PathBuf> = files.iter().map(|f| safe_relative(&f.path)).collect::<Result<_, _>>()?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let previous: Manifest = fs::read_to_string(dir.join(MANIFEST))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    for (file, rel) in files.iter().zip(&paths) {
        let target = dir.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, &file.content).map_err(|e| e.to_string())?;
    }

    let current: HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let mut removed = 0;
    for old in previous.files.iter().filter(|p| !current.contains(p.as_str())) {
        let Ok(rel) = safe_relative(old) else { continue };
        if fs::remove_file(dir.join(&rel)).is_ok() {
            removed += 1;
            // Tidy directories the old pages leave empty.
            let mut parent = rel.parent();
            while let Some(p) = parent.filter(|p| !p.as_os_str().is_empty()) {
                if fs::remove_dir(dir.join(p)).is_err() {
                    break;
                }
                parent = p.parent();
            }
        }
    }
    let manifest = Manifest { files: files.iter().map(|f| f.path.clone()).collect() };
    fs::write(dir.join(MANIFEST), serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, content: &str) -> SiteFile {
        SiteFile { path: path.into(), content: content.into() }
    }

    #[test]
    fn republishing_removes_only_its_own_stale_files() {
        let dir = std::env::temp_dir().join(format!("tagdown-site-{}", uuid::Uuid::new_v4()));
        assert!(!inspect(&dir).exists);
        write(&dir, &[file("index.html", "v1"), file("notes/a.html", "A"), file("notes/old/b.html", "B")]).unwrap();
        fs::write(dir.join("CNAME"), "notes.example.com").unwrap(); // the user's own file
        let state = inspect(&dir);
        assert!(state.exists && !state.empty && state.tagdown_site);

        let removed = write(&dir, &[file("index.html", "v2"), file("notes/a.html", "A2")]).unwrap();
        assert_eq!(removed, 1);
        assert_eq!(fs::read_to_string(dir.join("index.html")).unwrap(), "v2");
        assert!(!dir.join("notes/old").exists(), "emptied folders are tidied");
        assert!(dir.join("CNAME").exists(), "files Tagdown didn't write are kept");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn rejects_paths_outside_the_site() {
        let dir = std::env::temp_dir().join(format!("tagdown-site-{}", uuid::Uuid::new_v4()));
        for bad in ["../escape.html", "/etc/passwd", "notes/../../x", ""] {
            assert!(write(&dir, &[file(bad, "x")]).is_err(), "{bad}");
        }
        fs::remove_dir_all(dir).ok();
    }
}
