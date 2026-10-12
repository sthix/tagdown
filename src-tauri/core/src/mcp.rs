// MCP server: lets AI assistants (Claude Desktop, Claude Code, …) search,
// read, and write notes in a Tagdown vault. Speaks JSON-RPC 2.0 over
// stdin/stdout, one message per line.

use std::io::{BufRead, Write};

use serde_json::{json, Value};

use crate::{
    library::{Library, TaskFilter, SYNTAX},
    models::Note,
};

const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SYNTAX_URI: &str = "tagdown://syntax";

const INSTRUCTIONS: &str = "Tagdown is a local notes vault. Notes are Tagdown: Markdown plus callouts, tabs, columns, cards, math, Mermaid diagrams, #tags and [[wikilinks]] to other notes by title. A note's title is its first `# ` heading. Before writing notes with anything beyond plain Markdown, call get_tagdown_syntax once. Refer to notes by title (case-insensitive) or id. Search supports tag:name, title:word, \"exact phrases\" and -exclusions.";

pub struct Server {
    library: Library,
}

/// Run the server until stdin closes.
pub fn serve(library: Library, input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    let mut server = Server::new(library);
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(message) => server.handle(message),
            Err(e) => Some(error(Value::Null, -32700, &format!("parse error: {e}"))),
        };
        if let Some(reply) = reply {
            writeln!(output, "{reply}")?;
            output.flush()?;
        }
    }
    Ok(())
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

impl Server {
    pub fn new(library: Library) -> Self {
        Self { library }
    }

    /// Answer one JSON-RPC message; notifications get no answer.
    pub fn handle(&mut self, message: Value) -> Option<Value> {
        let id = message.get("id").cloned();
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let id = id?; // notifications (no id) need no reply
        let result = match method {
            "initialize" => Ok(self.initialize(&params)),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools() })),
            "tools/call" => Ok(self.call_tool(&params)),
            "resources/list" => Ok(json!({ "resources": [{
                "uri": SYNTAX_URI,
                "name": "Tagdown syntax",
                "description": "How to write Tagdown: Markdown plus callouts, tabs, layout, math and diagrams.",
                "mimeType": "text/markdown",
            }] })),
            "resources/read" => match params.get("uri").and_then(Value::as_str) {
                Some(SYNTAX_URI) => Ok(json!({ "contents": [{ "uri": SYNTAX_URI, "mimeType": "text/markdown", "text": SYNTAX }] })),
                other => Err((-32002, format!("unknown resource: {}", other.unwrap_or("")))),
            },
            _ => Err((-32601, format!("method not found: {method}"))),
        };
        Some(match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, message)) => error(id, code, &message),
        })
    }

    fn initialize(&self, params: &Value) -> Value {
        let requested = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
        let version = PROTOCOL_VERSIONS.iter().find(|v| **v == requested).unwrap_or(&PROTOCOL_VERSIONS[0]);
        json!({
            "protocolVersion": version,
            "capabilities": { "tools": {}, "resources": {} },
            "serverInfo": { "name": "tagdown", "title": "Tagdown", "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS,
        })
    }

    fn call_tool(&mut self, params: &Value) -> Value {
        let name = params.get("name").and_then(Value::as_str).unwrap_or("");
        let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
        match self.run_tool(name, &args) {
            Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
            // Tool failures are results the model can read and act on, not protocol errors.
            Err(message) => json!({ "content": [{ "type": "text", "text": message }], "isError": true }),
        }
    }

    fn run_tool(&mut self, name: &str, args: &Value) -> Result<String, String> {
        let str_arg = |key: &str| args.get(key).and_then(Value::as_str).map(str::to_string);
        let required = |key: &str| str_arg(key).filter(|v| !v.trim().is_empty()).ok_or_else(|| format!("missing argument: {key}"));
        let limit = |default: u64| args.get("limit").and_then(Value::as_u64).unwrap_or(default).clamp(1, 200) as usize;
        let lib = &mut self.library;
        match name {
            "search_notes" => {
                let query = required("query")?;
                let results = lib.search(&query, limit(10))?;
                if results.is_empty() {
                    return Ok(format!("No notes match {query:?}."));
                }
                let mut out = format!("{} matching notes:\n", results.len());
                for (i, r) in results.iter().enumerate() {
                    out.push_str(&format!("\n{}. {}\n", i + 1, describe(&r.note, lib.folder_name(r.note.folder_id.as_deref()))));
                    if !r.excerpt.is_empty() {
                        out.push_str(&format!("   {}\n", r.excerpt));
                    }
                }
                Ok(out)
            }
            "read_note" => {
                let view = lib.read(&required("note")?)?;
                let mut out = format!("{}\nEdited: {}\n", describe(&view.note, view.folder), view.note.updated_at.format("%Y-%m-%d %H:%M UTC"));
                if !view.linked_from.is_empty() {
                    out.push_str(&format!("Linked from: {}\n", view.linked_from.join(", ")));
                }
                out.push_str(&format!("\n---\n\n{}", view.content));
                Ok(out)
            }
            "list_notes" => {
                let notes = lib.list(str_arg("folder").as_deref(), str_arg("tag").as_deref(), limit(50))?;
                if notes.is_empty() {
                    return Ok("No notes.".into());
                }
                Ok(notes.iter().map(|n| format!("- {}", describe(n, lib.folder_name(n.folder_id.as_deref())))).collect::<Vec<_>>().join("\n"))
            }
            "create_note" => {
                let tags: Vec<String> = args.get("tags").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
                let note = lib.create(&required("title")?, &str_arg("content").unwrap_or_default(), str_arg("folder").as_deref(), &tags)?;
                Ok(format!("Created \"{}\" (id: {}).", note.title, note.id))
            }
            "append_to_note" => {
                let note = lib.append(&required("note")?, &required("content")?)?;
                Ok(format!("Appended to \"{}\" (id: {}).", note.title, note.id))
            }
            "replace_note_content" => {
                let note = lib.replace(&required("note")?, &required("content")?)?;
                Ok(format!("Replaced the content of \"{}\" (id: {}). The previous version is in the note's version history.", note.title, note.id))
            }
            "list_tasks" => {
                let filter = match str_arg("status").as_deref() {
                    None | Some("open") => TaskFilter::Open,
                    Some("done") => TaskFilter::Done,
                    Some("all") => TaskFilter::All,
                    Some(other) => return Err(format!("status must be open, done or all, not {other:?}")),
                };
                let tasks = lib.tasks(filter, str_arg("tag").as_deref())?;
                if tasks.is_empty() {
                    return Ok("No matching tasks.".into());
                }
                let mut out = String::new();
                let mut current = "";
                for task in &tasks {
                    if task.note_id != current {
                        out.push_str(&format!("{}## {} (id: {})\n", if current.is_empty() { "" } else { "\n" }, task.note_title, task.note_id));
                        current = &task.note_id;
                    }
                    out.push_str(&format!("- [{}] {} (line {})\n", if task.done { "x" } else { " " }, task.text, task.line));
                }
                Ok(out)
            }
            "get_backlinks" => {
                let note = required("note")?;
                let backlinks = lib.backlinks(&note)?;
                if backlinks.is_empty() {
                    return Ok(format!("No notes link to {note:?}."));
                }
                let mut out = String::new();
                for b in backlinks {
                    out.push_str(&format!("- {} (id: {})\n", b.note.title, b.note.id));
                    for line in b.mentions {
                        out.push_str(&format!("  > {line}\n"));
                    }
                }
                Ok(out)
            }
            "get_tagdown_syntax" => Ok(SYNTAX.to_string()),
            _ => Err(format!("unknown tool: {name}")),
        }
    }
}

fn describe(note: &Note, folder: Option<String>) -> String {
    let mut parts = vec![format!("id: {}", note.id)];
    if let Some(folder) = folder {
        parts.push(format!("folder: {folder}"));
    }
    if !note.tags.is_empty() {
        parts.push(format!("tags: {}", note.tags.join(", ")));
    }
    format!("\"{}\" ({})", note.title, parts.join(", "))
}

fn tools() -> Value {
    let note = json!({ "type": "string", "description": "The note's title (case-insensitive) or id." });
    let content = json!({ "type": "string", "description": "Tagdown text. Use get_tagdown_syntax for callouts, tabs, layout, math and diagrams." });
    let read_only = json!({ "readOnlyHint": true, "openWorldHint": false });
    json!([
        {
            "name": "search_notes",
            "title": "Search notes",
            "description": "Full-text search across the vault. All words must match; supports tag:name, title:word, \"exact phrases\" and -word to exclude. Returns titles, ids and a matching excerpt.",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200, "default": 10 },
            }, "required": ["query"] },
            "annotations": read_only,
        },
        {
            "name": "read_note",
            "title": "Read note",
            "description": "The full Tagdown text of a note, with its tags, folder, edit time and the notes that link to it.",
            "inputSchema": { "type": "object", "properties": { "note": note }, "required": ["note"] },
            "annotations": read_only,
        },
        {
            "name": "list_notes",
            "title": "List notes",
            "description": "Notes, most recently edited first, optionally in one folder or under one tag (nested tags included).",
            "inputSchema": { "type": "object", "properties": {
                "folder": { "type": "string", "description": "Folder name." },
                "tag": { "type": "string" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200, "default": 50 },
            } },
            "annotations": read_only,
        },
        {
            "name": "create_note",
            "title": "Create note",
            "description": "Create a note. The title becomes its first heading; content is the body after it.",
            "inputSchema": { "type": "object", "properties": {
                "title": { "type": "string" },
                "content": content,
                "folder": { "type": "string", "description": "Folder name; omitted for the top level." },
                "tags": { "type": "array", "items": { "type": "string" }, "description": "Tags to add, e.g. [\"project/atlas\"]." },
            }, "required": ["title"] },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false },
        },
        {
            "name": "append_to_note",
            "title": "Append to note",
            "description": "Add Tagdown text to the end of a note, e.g. a log entry or new tasks.",
            "inputSchema": { "type": "object", "properties": { "note": note, "content": content }, "required": ["note", "content"] },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false },
        },
        {
            "name": "replace_note_content",
            "title": "Replace note content",
            "description": "Replace a note's entire text, including its `# Title` heading. Read the note first. The previous text is kept in the note's version history.",
            "inputSchema": { "type": "object", "properties": { "note": note, "content": content }, "required": ["note", "content"] },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false },
        },
        {
            "name": "list_tasks",
            "title": "List tasks",
            "description": "Checklist items (- [ ] / - [x]) across notes, grouped by note.",
            "inputSchema": { "type": "object", "properties": {
                "status": { "type": "string", "enum": ["open", "done", "all"], "default": "open" },
                "tag": { "type": "string", "description": "Only notes with this tag." },
            } },
            "annotations": read_only,
        },
        {
            "name": "get_backlinks",
            "title": "Get backlinks",
            "description": "Notes that link to a note with [[wikilinks]], with the linking lines.",
            "inputSchema": { "type": "object", "properties": { "note": note }, "required": ["note"] },
            "annotations": read_only,
        },
        {
            "name": "get_tagdown_syntax",
            "title": "Tagdown syntax",
            "description": "The Tagdown syntax reference. Read it before writing notes that use more than plain Markdown.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": read_only,
        },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::Vault;

    fn server() -> (Server, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("tagdown-mcp-{}", uuid::Uuid::new_v4()));
        Vault::open_or_create(root.clone()).unwrap();
        (Server::new(Library::open(root.clone()).unwrap()), root)
    }

    fn call(server: &mut Server, name: &str, arguments: Value) -> (String, bool) {
        let reply = server.handle(json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": name, "arguments": arguments } })).unwrap();
        let result = &reply["result"];
        (result["content"][0]["text"].as_str().unwrap().to_string(), result["isError"].as_bool().unwrap_or(false))
    }

    #[test]
    fn handshake_and_listing() {
        let (mut s, root) = server();
        let init = s.handle(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "t", "version": "1" } } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], "tagdown");
        assert!(s.handle(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let tools = s.handle(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 9);
        let syntax = s.handle(json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/read", "params": { "uri": SYNTAX_URI } })).unwrap();
        assert!(syntax["result"]["contents"][0]["text"].as_str().unwrap().starts_with("# Tagdown syntax"));
        let unknown = s.handle(json!({ "jsonrpc": "2.0", "id": 4, "method": "nope" })).unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn tools_write_and_read_notes() {
        let (mut s, root) = server();
        let (text, err) = call(&mut s, "create_note", json!({ "title": "Atlas", "content": "::: info\nKickoff [[Your First Note]].\n:::\n\n- [ ] Draft brief", "tags": ["project/atlas"] }));
        assert!(!err && text.starts_with("Created \"Atlas\""), "{text}");
        call(&mut s, "append_to_note", json!({ "note": "atlas", "content": "- [x] Pick name" }));

        let (text, _) = call(&mut s, "search_notes", json!({ "query": "kickoff tag:project" }));
        assert!(text.contains("\"Atlas\""), "{text}");
        let (text, _) = call(&mut s, "read_note", json!({ "note": "Atlas" }));
        assert!(text.contains("tags: project/atlas") && text.ends_with("- [x] Pick name\n"), "{text}");
        let (text, _) = call(&mut s, "list_tasks", json!({}));
        assert!(text.contains("## Atlas") && text.contains("- [ ] Draft brief") && !text.contains("Pick name"), "{text}");
        let (text, _) = call(&mut s, "get_backlinks", json!({ "note": "Your First Note" }));
        assert!(text.contains("- Atlas") && text.contains("> Kickoff [[Your First Note]]."), "{text}");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn tool_failures_are_readable_results() {
        let (mut s, root) = server();
        let (text, err) = call(&mut s, "read_note", json!({ "note": "Nope" }));
        assert!(err && text.contains("no note titled"), "{text}");
        let (text, err) = call(&mut s, "create_note", json!({}));
        assert!(err && text == "missing argument: title");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn serves_line_delimited_json() {
        let (s, root) = server();
        drop(s);
        let input = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\nnot json\n";
        let mut out = Vec::new();
        serve(Library::open(root.clone()).unwrap(), input.as_bytes(), &mut out).unwrap();
        let lines: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines[0]["result"], json!({}));
        assert_eq!(lines[1]["error"]["code"], -32700);
        std::fs::remove_dir_all(root).ok();
    }
}
