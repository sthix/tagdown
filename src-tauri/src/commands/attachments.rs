// Images added to notes (pasted, dropped or picked) are copied into the vault's
// `attachments/` folder, so notes refer to them with a path relative to the
// vault and the vault stays self-contained.

use std::{fs, path::{Path, PathBuf}, sync::Mutex};

use tauri::{ipc::{InvokeBody, Request}, State};

use crate::{vault::find_file_by_name, AppState};

const ATTACHMENTS: &str = "attachments";
const IMAGE_EXTENSIONS: [&str; 11] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "heic", "heif", "bmp", "tiff"];

/// Store image bytes sent as the raw request body; the file name comes in the
/// URI-encoded `x-file-name` header. Returns the path to use in the note.
#[tauri::command]
pub async fn save_attachment(request: Request<'_>, state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected the image's bytes".into()) };
    let name = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_default();
    let root = state.lock().map_err(|e| e.to_string())?.vault.root.clone();
    store(&root, &name, bytes)
}

/// Copy an image file from disk into the vault. Returns the path to use in the note.
#[tauri::command]
pub async fn import_attachment(path: String, state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    let source = PathBuf::from(&path);
    let bytes = fs::read(&source).map_err(|e| format!("could not read {path}: {e}"))?;
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    let root = state.lock().map_err(|e| e.to_string())?.vault.root.clone();
    store(&root, &name, &bytes)
}

/// Where in the vault the image called `name` is, for `![[photo.png]]`.
#[tauri::command]
pub async fn find_attachment(name: String, state: State<'_, Mutex<AppState>>) -> Result<Option<String>, String> {
    let root = state.lock().map_err(|e| e.to_string())?.vault.root.clone();
    Ok(find_file_by_name(&root, &name))
}

fn store(root: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    let (stem, ext) = clean_name(name);
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("“{name}” is not an image Tagdown can show"));
    }
    let dir = root.join(ATTACHMENTS);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = (1..)
        .map(|n| if n == 1 { format!("{stem}.{ext}") } else { format!("{stem}-{n}.{ext}") })
        .find(|file| !dir.join(file).exists())
        .expect("some name is free");
    fs::write(dir.join(&file), bytes).map_err(|e| e.to_string())?;
    Ok(format!("{ATTACHMENTS}/{file}"))
}

/// A file name safe to write into a note: no directories, quotes or spaces.
fn clean_name(name: &str) -> (String, String) {
    let base = Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let (stem, ext) = base.rsplit_once('.').unwrap_or((base, ""));
    let stem: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let stem = if stem.is_empty() { "image".to_string() } else { stem };
    (stem, ext.to_ascii_lowercase())
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%').then(|| value.get(i + 1..i + 3)).flatten().and_then(|h| u8::from_str_radix(h, 16).ok());
        match hex {
            Some(byte) => { out.push(byte); i += 3; }
            None => { out.push(bytes[i]); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_cleaned_and_kept_unique() {
        assert_eq!(clean_name("../My Photo (1).JPG"), ("My-Photo-1".into(), "jpg".into()));
        assert_eq!(clean_name("Übersicht.png"), ("Übersicht".into(), "png".into()));
        assert_eq!(clean_name(".png"), ("image".into(), "png".into()));
        assert_eq!(percent_decode("%C3%9Cbersicht%20a.png"), "Übersicht a.png");

        let root = std::env::temp_dir().join(format!("tagdown-attachments-{}", std::process::id()));
        assert_eq!(store(&root, "a b.png", b"1").unwrap(), "attachments/a-b.png");
        assert_eq!(store(&root, "a b.png", b"2").unwrap(), "attachments/a-b-2.png");
        assert!(store(&root, "notes.txt", b"3").is_err());
        let _ = fs::remove_dir_all(root);
    }
}
