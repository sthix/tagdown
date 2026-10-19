//! Authenticated local delivery for the browser clipper and the desktop capture shortcut.
use std::{fs, io::{Read, Write}, net::{TcpListener, TcpStream}, path::{Path, PathBuf}, sync::Mutex, time::Duration};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use crate::{AppState, commands::search::SearchState, models::Note, vault::Vault};

const ADDRESS: &str = "127.0.0.1:43827";
const MAX_BODY: usize = 300_000;
const MAX_HEADER: usize = 8_192;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureConnection {
    endpoint: String,
    token: String,
    available: bool,
    error: Option<String>,
    shortcut_error: Option<String>,
}

pub struct CaptureState(CaptureConnection);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Clip {
    id: String,
    url: String,
    title: String,
    captured_at: String,
    #[serde(default)]
    selection: String,
    #[serde(default)]
    text: String,
}

impl Clip {
    fn validate(&self) -> Result<(), String> {
        let uuid = uuid::Uuid::parse_str(&self.id).map_err(|_| "Capture ID must be a UUID.")?;
        if uuid.to_string() != self.id { return Err("Use a canonical capture UUID.".into()); }
        if self.url.chars().any(|c| c.is_whitespace() || c.is_control()) { return Err("Invalid source URL.".into()); }
        let url = reqwest::Url::parse(&self.url).map_err(|_| "Invalid source URL.")?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
            return Err("Capture requires an http or https page URL without credentials.".into());
        }
        DateTime::parse_from_rfc3339(&self.captured_at).map_err(|_| "Invalid capture time.")?;
        if self.title.len() > 4_000 || self.url.len() > 8_000 || self.selection.len() > 80_000 || self.text.len() > 200_000 { return Err("Capture is too large.".into()); }
        if self.title.contains('\0') || self.selection.contains('\0') || self.text.contains('\0') { return Err("Capture contains a null character.".into()); }
        Ok(())
    }

    fn markdown(&self) -> String {
        let title = self.title.split_whitespace().collect::<Vec<_>>().join(" ");
        let title = if title.is_empty() { "Clipped page" } else { &title };
        let url = self.url.replace('<', "%3C").replace('>', "%3E");
        let mut body = format!("# {}\n\nSource: <{}>\n\nCaptured: {}\n", plain_text(title), url, self.captured_at);
        if !self.selection.trim().is_empty() {
            body.push_str("\n## Selected text\n\n");
            for line in self.selection.trim().lines() { body.push_str(&format!("> {}\n", plain_text(line))); }
        }
        if !self.text.trim().is_empty() { body.push_str(&format!("\n## Page text\n\n{}\n", plain_text(self.text.trim()))); }
        body
    }
}

/// Treat the page as quoted source text, so page syntax cannot introduce embeds or queries.
fn plain_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"), '<' => out.push_str("&lt;"), '>' => out.push_str("&gt;"),
            '\\' | '`' | '*' | '_' | '{' | '}' | '[' | ']' | '(' | ')' | '#' | '+' | '-' | '!' | '|' | '~' | '$' | ':' => { out.push('\\'); out.push(c); }
            _ => out.push(c),
        }
    }
    out
}

/// Publish complete files exclusively. Readers see the old file or the complete new file.
fn publish(directory: &Path, destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = directory.join(format!(".capture-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new(); options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        match fs::hard_link(&temporary, destination) {
            Ok(()) => {},
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {},
            Err(e) => return Err(e.to_string()),
        }
        #[cfg(unix)] fs::File::open(directory).and_then(|f| f.sync_all()).map_err(|e| e.to_string())?;
        Ok(())
    })();
    let _ = fs::remove_file(temporary);
    result
}

/// Reserve the destination before saving. An interrupted delivery stays in that vault after a switch.
fn delivery_vault(receipts: &Path, active: &Vault, clip: &Clip) -> Result<Vault, String> {
    clip.validate()?;
    fs::create_dir_all(receipts).map_err(|e| e.to_string())?;
    let receipt = receipts.join(format!("{}.json", clip.id));
    if fs::symlink_metadata(&receipt).is_ok_and(|m| m.file_type().is_symlink()) { return Err("Capture receipt is a symbolic link.".into()); }
    let active_root = fs::canonicalize(&active.root).map_err(|e| e.to_string())?;
    if !receipt.exists() {
        let bytes = serde_json::to_vec(&active_root).map_err(|e| e.to_string())?;
        publish(receipts, &receipt, &bytes)?;
    }
    let root: PathBuf = serde_json::from_slice(&fs::read(&receipt).map_err(|e| e.to_string())?).map_err(|e| format!("Unreadable capture receipt: {e}"))?;
    if root == active_root { Ok(active.clone()) }
    else { Vault::open_existing(root).map_err(|e| format!("Original capture vault is unavailable. Restore it and retry: {e}")) }
}

/// Fixed capture IDs plus exclusive atomic publication make a retry safe even after an app crash.
fn save_clip(vault: &Vault, clip: &Clip) -> Result<Note, String> {
    clip.validate()?;
    if let Ok(existing) = find_clip(vault, &clip.id) { return Ok(existing); }
    let destination = vault.root.join(format!("clip-{}.md", clip.id));
    if fs::symlink_metadata(&destination).is_ok_and(|m| m.file_type().is_symlink()) { return Err("Capture destination is a symbolic link.".into()); }
    if destination.exists() { return find_clip(vault, &clip.id); }
    let now = Utc::now().to_rfc3339();
    let quoted = |s: &str| serde_json::to_string(s).unwrap();
    let content = format!("---\nid: {}\ntags: []\nstarred: false\ncreated: {}\nupdated: {}\ntype: Link\nurl: {}\ncapture_id: {}\n---\n{}", clip.id, now, now, quoted(&clip.url), quoted(&clip.id), clip.markdown());
    publish(&vault.root, &destination, content.as_bytes())?;
    find_clip(vault, &clip.id)
}

fn find_clip(vault: &Vault, id: &str) -> Result<Note, String> {
    vault.notes_with_content()?.into_iter().find(|(note, _)| note.id == id).map(|(note, _)| note).ok_or_else(|| "Saved capture could not be read. The queue will retry.".into())
}

#[tauri::command]
pub fn capture_connection(state: State<'_, CaptureState>) -> CaptureConnection { state.0.clone() }

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let token = load_token(&path)?;
    let mut connection = CaptureConnection { endpoint: format!("http://{ADDRESS}/capture"), token: token.clone(), available: false, error: None, shortcut_error: None };
    if let Err(e) = app.plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| {
        if event.state() == ShortcutState::Pressed {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
                let _ = window.emit("quick-capture", ());
            }
        }
    }).build()).map_err(|e| e.to_string()).and_then(|_| app.global_shortcut().register("CommandOrControl+Alt+J").map_err(|e| e.to_string())) { connection.shortcut_error = Some(e); }
    match TcpListener::bind(ADDRESS) {
        Ok(listener) => {
            connection.available = true;
            let app = app.clone();
            let receipts = path.join("capture-receipts");
            std::thread::spawn(move || {
                for mut stream in listener.incoming().flatten() {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                    let (status, body, origin) = handle_request(&mut stream, &token, |clip| {
                        let state = app.state::<Mutex<AppState>>();
                        let state = state.lock().map_err(|e| e.to_string())?;
                        let vault = delivery_vault(&receipts, &state.vault, &clip)?;
                        let note = save_clip(&vault, &clip)?;
                        if vault.root == state.vault.root {
                            let content = vault.get_note_content(&note.id)?.content;
                            app.state::<SearchState>().index(&note, &content);
                            let _ = app.emit("note-saved", &note);
                        }
                        Ok(serde_json::json!({"id": clip.id, "saved": true, "noteId": note.id}))
                    });
                    respond(&mut stream, status, &body, origin.as_deref());
                }
            });
        }
        Err(e) => connection.error = Some(format!("Browser clipper unavailable: {e}")),
    }
    app.manage(CaptureState(connection));
    Ok(())
}

fn load_token(directory: &Path) -> Result<String, String> {
    let path = directory.join("capture-token");
    if path.exists() {
        let token = fs::read_to_string(path).map_err(|e| e.to_string())?;
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("Invalid clipper pairing token. Remove capture-token from app configuration and restart.".into()); }
        return Ok(token);
    }
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let mut options = fs::OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    options.open(path).and_then(|mut f| f.write_all(token.as_bytes())).map_err(|e| e.to_string())?;
    Ok(token)
}

fn allowed_origin(origin: &str) -> bool {
    origin.strip_prefix("chrome-extension://").is_some_and(|id| id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)))
}

fn handle_request(stream: &mut impl Read, token: &str, save: impl FnOnce(Clip) -> Result<serde_json::Value, String>) -> (u16, serde_json::Value, Option<String>) {
    let fail = |status, error: &str, origin| (status, serde_json::json!({"error": error}), origin);
    let mut header = Vec::new(); let mut byte = [0];
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= MAX_HEADER { return fail(431, "Header too large", None); }
        if stream.read_exact(&mut byte).is_err() { return fail(400, "Incomplete request", None); }
        header.push(byte[0]);
    }
    let Ok(header) = String::from_utf8(header) else { return fail(400, "Invalid header", None); };
    let mut lines = header.split("\r\n");
    let request = lines.next().unwrap_or_default();
    let headers: Vec<_> = lines.filter_map(|l| l.split_once(':').map(|(k, v)| (k.to_ascii_lowercase(), v.trim()))).collect();
    let get = |key: &str| headers.iter().find(|(k, _)| k == key).map(|(_, v)| *v).unwrap_or_default();
    let origin = get("origin");
    if !allowed_origin(origin) { return fail(403, "Browser extension origin required", None); }
    let origin = Some(origin.to_string());
    if get("host") != ADDRESS { return fail(403, "Invalid local host", origin); }
    if request == "OPTIONS /capture HTTP/1.1" { return (204, serde_json::Value::Null, origin); }
    if request != "POST /capture HTTP/1.1" { return fail(404, "Not found", origin); }
    if get("authorization") != format!("Bearer {token}") { return fail(401, "Pair Tagdown with this extension first", origin); }
    if get("content-type") != "application/json" || !get("transfer-encoding").is_empty() { return fail(415, "JSON with Content-Length required", origin); }
    let Ok(length) = get("content-length").parse::<usize>() else { return fail(411, "Content-Length required", origin); };
    if length > MAX_BODY { return fail(413, "Capture too large", origin); }
    let mut body = vec![0; length];
    if stream.read_exact(&mut body).is_err() { return fail(400, "Incomplete body", origin); }
    let clip: Clip = match serde_json::from_slice(&body) { Ok(clip) => clip, Err(_) => return fail(400, "Invalid capture", origin) };
    if let Err(e) = clip.validate() { return fail(400, &e, origin); }
    match save(clip) { Ok(body) => (200, body, origin), Err(e) => fail(503, &e, origin) }
}

fn respond(stream: &mut TcpStream, status: u16, body: &serde_json::Value, origin: Option<&str>) {
    let body = if status == 204 { String::new() } else { body.to_string() };
    let cors = origin.map(|o| format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n")).unwrap_or_default();
    let _ = write!(stream, "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n{cors}\r\n{body}", if status < 300 { "OK" } else { "Error" }, body.len());
}

#[cfg(test)]
mod tests {
    use super::*;
    fn clip() -> Clip { Clip { id: uuid::Uuid::new_v4().to_string(), url: "https://example.com/article".into(), title: "Page".into(), captured_at: Utc::now().to_rfc3339(), selection: "[[Secret]] <script>".into(), text: "Article".into() } }
    #[test] fn rejects_untrusted_sources_and_oversized_payloads() {
        let mut c = clip(); c.url = "javascript:alert(1)".into(); assert!(c.validate().is_err());
        c.url = "https://example.com".into(); c.text = "x".repeat(200_001); assert!(c.validate().is_err());
        assert!(!allowed_origin("https://example.com")); assert!(!allowed_origin("chrome-extension://../"));
    }
    #[test] fn source_syntax_is_literal() { let body = clip().markdown(); assert!(body.contains("\\[\\[Secret\\]\\] &lt;script&gt;")); }
    #[test] fn repeated_delivery_publishes_one_note() {
        let root = std::env::temp_dir().join(format!("tagdown-clip-test-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open_or_create(root.clone()).unwrap(); let c = clip();
        let first = save_clip(&vault, &c).unwrap(); let second = save_clip(&vault, &c).unwrap();
        assert_eq!(first.id, second.id); assert_eq!(vault.notes_with_content().unwrap().iter().filter(|(n, _)| n.id == c.id).count(), 1);
        assert!(vault.get_note_content(&first.id).unwrap().content.contains("Source: <https://example.com/article>"));
        let folder = root.join("Moved"); fs::create_dir_all(&folder).unwrap();
        fs::rename(root.join(format!("clip-{}.md", c.id)), folder.join("moved.md")).unwrap();
        assert_eq!(save_clip(&vault, &c).unwrap().id, first.id);
        assert!(!root.join(format!("clip-{}.md", c.id)).exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn interrupted_delivery_keeps_original_vault_after_switch() {
        let root = std::env::temp_dir().join(format!("tagdown-capture-routing-{}", uuid::Uuid::new_v4()));
        let first = Vault::open_or_create(root.join("first")).unwrap();
        let second = Vault::open_or_create(root.join("second")).unwrap();
        let receipts = root.join("receipts"); let c = clip();
        // A crash after reservation, before publication, still has a durable destination.
        assert_eq!(delivery_vault(&receipts, &first, &c).unwrap().root, first.root);
        let routed = delivery_vault(&receipts, &second, &c).unwrap();
        assert_eq!(routed.root, fs::canonicalize(&first.root).unwrap());
        save_clip(&routed, &c).unwrap();
        // A lost acknowledgement after publication also stays in the original vault.
        let retry = delivery_vault(&receipts, &second, &c).unwrap();
        save_clip(&retry, &c).unwrap();
        assert!(find_clip(&first, &c.id).is_ok()); assert!(find_clip(&second, &c.id).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn unavailable_original_vault_does_not_redirect_capture() {
        let root = std::env::temp_dir().join(format!("tagdown-capture-unavailable-{}", uuid::Uuid::new_v4()));
        let first = Vault::open_or_create(root.join("first")).unwrap();
        let second = Vault::open_or_create(root.join("second")).unwrap();
        let receipts = root.join("receipts"); let c = clip();
        delivery_vault(&receipts, &first, &c).unwrap();
        fs::remove_dir_all(&first.root).unwrap();
        assert!(delivery_vault(&receipts, &second, &c).is_err());
        assert!(find_clip(&second, &c.id).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn unauthorized_request_never_writes() {
        let request = b"POST /capture HTTP/1.1\r\nHost: 127.0.0.1:43827\r\nOrigin: chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\nAuthorization: Bearer wrong\r\nContent-Length: 0\r\nContent-Type: application/json\r\n\r\n";
        let result = handle_request(&mut request.as_slice(), "secret", |_| panic!("unauthorized write")); assert_eq!(result.0, 401);
    }
    #[test] fn authenticated_request_is_acknowledged_only_after_save() {
        let c = clip();
        let body = serde_json::json!({"id": c.id, "url": c.url, "title": c.title, "capturedAt": c.captured_at, "selection": c.selection, "text": c.text}).to_string();
        let request = format!("POST /capture HTTP/1.1\r\nHost: {ADDRESS}\r\nOrigin: chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\nAuthorization: Bearer secret\r\nContent-Length: {}\r\nContent-Type: application/json\r\n\r\n{body}", body.len());
        let result = handle_request(&mut request.as_bytes(), "secret", |clip| Ok(serde_json::json!({"id": clip.id, "saved": true})));
        assert_eq!(result.0, 200); assert_eq!(result.1["saved"], true);
        let failure = handle_request(&mut request.as_bytes(), "secret", |_| Err("Disk full".into()));
        assert_eq!(failure.0, 503); assert!(failure.1.get("saved").is_none());
    }
    #[test] fn web_origin_and_oversized_body_never_reach_save() {
        for (origin, length, expected) in [("https://example.com", 0, 403), ("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", MAX_BODY + 1, 413)] {
            let request = format!("POST /capture HTTP/1.1\r\nHost: {ADDRESS}\r\nOrigin: {origin}\r\nAuthorization: Bearer secret\r\nContent-Length: {length}\r\nContent-Type: application/json\r\n\r\n");
            assert_eq!(handle_request(&mut request.as_bytes(), "secret", |_| panic!("untrusted write")).0, expected);
        }
    }
}
