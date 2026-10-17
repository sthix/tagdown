# Command line and AI assistants

The `tagdown` command works on the same vault as the app. It can search, read, and write notes from a terminal or a script, and it runs an [MCP](https://modelcontextprotocol.io) server so AI assistants such as Claude can work with your notes.

Changes it makes show up in the running app right away, and anything it replaces is kept in the note's [version history](version-history.md).

## Install

From the repository root (Rust 1.86 or newer):

```sh
cargo install --path src-tauri/core
```

This puts `tagdown` in `~/.cargo/bin`.

## Choosing the vault

The vault is the one the app has open (`~/Documents/Tagdown` until you pick another) unless you say otherwise:

```sh
tagdown --vault ~/Notes/Work list
TAGDOWN_VAULT=~/Notes/Work tagdown list
```

## Commands

Notes are addressed by title (case-insensitive) or id.

| Command | What it does |
| --- | --- |
| `tagdown search <query>` | Full-text search (`tag:name`, `title:word`, `"phrase"`, `-word`) |
| `tagdown list [--folder NAME] [--tag TAG] [--limit N]` | Notes, most recently edited first |
| `tagdown show <note>` | Print a note |
| `tagdown new <title> [text \| -]` | Create a note; `-` reads the body from stdin |
| `tagdown append <note> <text \| ->` | Add text to the end of a note |
| `tagdown journal [day] [text \| -]` | Print a day's [journal](journal.md) page, or add text to it; `day` is `YYYY-MM-DD`, `today` (the default), `yesterday` or `tomorrow` |
| `tagdown tasks [--done \| --all] [--tag TAG]` | Checklist items across notes (open ones by default) |
| `tagdown backlinks <note>` | Notes that link to a note |
| `tagdown query <query>` | What a `<query />` block would list, e.g. `tag:project show:tasks` |
| `tagdown syntax` | Print the Tagdown syntax reference |
| `tagdown mcp` | Run the MCP server on stdin/stdout |

Examples:

```sh
tagdown search "tag:project budget"
tagdown new "Meeting notes" "Agenda for [[Project Atlas]]"
tagdown append "Meeting notes" "- [ ] Send recap"
git log --oneline -5 | tagdown append "Release log" -
tagdown journal "- Shipped the beta 🎉"
tagdown journal yesterday
tagdown tasks --tag project
```

## MCP server

`tagdown mcp` speaks the Model Context Protocol over stdin/stdout.

### Connect Claude Code

```sh
claude mcp add tagdown -- tagdown mcp
```

### Connect Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (use the full path to the binary), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "tagdown": { "command": "/Users/you/.cargo/bin/tagdown", "args": ["mcp"] }
  }
}
```

To point an assistant at a different vault, add `"--vault", "/path/to/vault"` before `"mcp"` in `args`.

### Tools

| Tool | What it does |
| --- | --- |
| `search_notes` | Full-text search with the usual query syntax; returns titles, ids, and excerpts |
| `read_note` | A note's full text, with its tags, folder, edit time, and backlinks |
| `list_notes` | Notes, most recent first, optionally in one folder or under one tag |
| `create_note` | Create a note with a title, body, optional folder and tags |
| `append_to_note` | Add text to the end of a note |
| `replace_note_content` | Replace a note's whole text (the old text stays in version history) |
| `list_tasks` | Checklist items across notes, grouped by note |
| `get_backlinks` | Notes that link to a note, with the linking lines |
| `run_query` | What a `<query />` block would list |
| `read_journal` | A day's journal page (today by default) |
| `append_to_journal` | Add text to a day's journal page, creating the page if needed |
| `get_tagdown_syntax` | The Tagdown syntax reference |

The syntax reference is also offered as an MCP resource, so assistants write callouts, tabs, and wikilinks rather than plain Markdown.

### Things to ask

- "What's still open for Project Atlas?"
- "Summarize this week's meeting notes into a new note called Weekly recap, and link each meeting."
- "Log in my journal that I finished the quarterly report."
- "Add a task to my Reading list to finish *The Pragmatic Programmer*."
