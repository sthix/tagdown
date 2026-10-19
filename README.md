# Tagdown Editor

**A fast, local-first desktop editor for Tagdown notes: Markdown plus rich semantic blocks, tags, links, live queries, math, and diagrams.**

Tagdown Editor is a macOS-focused Tauri app for writing structured notes without giving up plain-text ownership. Notes are ordinary Markdown files on disk. They render instantly in a polished preview, link to each other, and can be exported, presented as slides, published as a website, or handed to an AI assistant.

<p align="center">
  <strong>Plain text in. Beautiful documents out.</strong><br />
  Local vaults · Wikilinks · Note types · Live queries · Full-text search · Slides · Publishing · MCP
</p>

<p align="center">
  <a href="https://sthix.github.io/tagdown/"><strong>Read the documentation →</strong></a>
</p>

---

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/tagdown-editor-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/images/tagdown-editor-light.png" />
  <img width="1440" alt="Tagdown Editor in split view: the sidebar with All Notes, the Journal, library folders and a tag tree, a note list grouped by date, and three notes open as tabs, with the launch plan's properties folded to one line of chips above its Tagdown source and rendered preview with a callout, task list, table, and math" src="docs/images/tagdown-editor-light.png" />
</picture>

<details>
<summary>Light and dark side by side</summary>

| Light | Dark |
| --- | --- |
| <img alt="Tagdown Editor, light theme" src="docs/images/tagdown-editor-light.png" /> | <img alt="Tagdown Editor, dark theme" src="docs/images/tagdown-editor-dark.png" /> |

</details>

## What is Tagdown?

Tagdown is a note format built on Markdown with extra structure for knowledge work:

- familiar Markdown for headings, lists, links, quotes, tables, and code
- `#tags` (nested with `/`) and `[[wikilinks]]` between notes
- document components such as callouts, tabs, grids, collapsible details, asides, figures with captions and sizes, quotes, and keyboard hints
- technical writing with KaTeX math and Mermaid diagrams
- live `<query />` blocks that list notes or tasks from across the vault

```tagdown
# Atlas launch plan

The plan for shipping **Atlas** this quarter. #project/atlas

::: tip Goal
Public beta by **November 14**.
:::

<query tag:project show:tasks />
```

See the [syntax guide](docs/syntax.md) for everything Tagdown adds.

## Features

### Writing

- **Tabs and side-by-side panes**: ⌘-click any note or link for a new tab, ⌥⌘-click (or drag it to the edge) to see two notes side by side. Tabs and panes are remembered per vault.
- **Properties that stay out of the way**: frontmatter fields as typed inputs that fold to one line of chips (⌘⇧I), and fields like `id` can be hidden in every note.
- **Source, split, and preview modes** (⌘1 / ⌘2 / ⌘3), and **edit in place** by clicking any block in the preview.
- **Slash commands**: type `/` to turn a line into a heading, list, or task, or to insert any component, a note link, or a date.
- **Linked notes from templates**: `/template` creates a note in a new tab with its title selected. Name it, and the link left in the original note updates with the title. Works in source, split, and preview modes, including an empty final block.
- **Outliner lists**: ↩ continues bullets, numbers, and tasks; Tab and ⇧Tab nest and un-nest items with their children.
- **Drag to reorder** blocks in the preview by their grip, or move the block you're editing with ⌘⇧↑ / ⌘⇧↓. Headings bring their whole section along (a setting you can turn off).
- **Images**: paste or drop them into a note and they're copied into the vault. Point at one in the preview to make it small, medium, large or full width, or to add a caption. Markdown `![alt](path)` and Obsidian `![[photo.png|300]]` images work too.
- **Formatting toolbar** with one-click templates for every Tagdown component.
- **Command palette** (⌘K) to jump to any note, search, or run any action.
- **Focus mode** (⌘\\) hides everything but the note.
- **Light and dark themes** (⌘⇧D), or follow the system, with sixteen **accent colours** to tint the app and an optional paper grain.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/panes-dark.png" />
  <img width="1440" alt="Focus mode with two panes side by side: the Atlas launch plan with its properties folded to a line of chips, and Weekly planning with its linked mentions, each pane with its own tabs" src="docs/images/panes-light.png" />
</picture>

### Organizing

- **Local-first vaults** of plain `.md` files (`~/Documents/Tagdown` by default, or any folder, Obsidian vaults included), whose folders on disk are Tagdown's folders. Keep several and switch between them.
- **Tags** from the note body or frontmatter, shown as a colour-coded tree.
- **Wikilinks** with autocomplete by title, file path, or a unique frontmatter alias. Suggestions prioritize matching names, then recently edited and frequently linked notes. Links follow title renames automatically and show up as *Linked mentions* under the target note. A local graph (⌘⇧G) shows a note's links both ways, colored by note type.
- **Journal** (⌘⇧J): a page for every day with a calendar, `[[2026-10-13]]` date links, and a template for new days. Each day lists its open tasks and the notes created, edited or dated that day. Quick capture (⌥⌘J while Tagdown is active, or `tagdown today "…"` in a terminal) adds a line to today's page.
- **Full-text search** backed by Tantivy, with `tag:`, `title:`, `"phrases"`, and `-exclusions`.
- **Editable starter templates** for Journal, Book, Person, Project, Meeting, and Recipe, ready when you open a vault. **Settings → Templates** lets you edit, turn off, or reset each one without changing existing notes.
- **Note types and child types**: use the **+** on a type row to create a child, such as Author under Person. Children inherit properties and icons; switch inherited fields off, override their defaults, or add your own. Parent views and link fields include children. A template property such as `author: "[[Person]]"` suggests and creates notes of that type.
- **Saved web links**: paste a link on an empty line (or use *Save web link…*) to keep the page as a Link note with its title, description and opening text.
- **Live queries** such as `<query tag:project show:tasks />`, shown as lists, editable tables (tick rows to set a property on all of them at once), kanban **boards** (drag a card to change its status) or **cards** with cover images.
- **Tasks** with a day (`[[2026-10-20]]`), a priority (`!high`) and repeats (`every:week`), ticked right in any list. ⌘⇧T shows them as **Today**, **Upcoming** and **Inbox**.
- **Outside edits** from other editors, git, or sync services are picked up while the app runs.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/child-types-dark.jpg" />
  <img width="1280" height="720" alt="Author Template nested under Person in Types, with Person selected as its parent, email inherited, company switched off, and genre added as an Author-specific property" src="docs/images/child-types-light.jpg" />
</picture>

See [creating a linked note from a template](docs/writing-notes.md#create-a-linked-note-from-a-template) for the slash-menu workflow, and [templates and child types](docs/organizing.md#child-types) for the **+** workflow, inheritance, and per-vault template settings.

### Safety

- **Autosave** with **version history** (⌘⇧H). Earlier versions are kept locally, thinned out over time, and can be restored with one click.

### Sharing

- **Export** a note as a self-contained HTML file (⌘⇧E) or **print / save as PDF** (⌘P).
- **Present as slides** (⌥⌘P): each `---` starts a new slide, scaled to fit any screen.
- **Publish as a website**: all notes, a folder, or a tag become static pages with working links, backlinks, tag filters, and search. Links to unpublished notes become plain text.

### CLI and MCP

- The **`tagdown` CLI** searches, reads, creates (typed notes too), and appends to notes from the terminal; `tagdown today "…"` is a quick capture to today's journal page.
- **`tagdown mcp`** is an MCP server, so assistants like Claude can search, read, and write rich Tagdown notes in your vault.

## How it compares

Tagdown sits between Obsidian and Notion: plain Markdown files you own, with rich document components, note types, live queries with table and board views, slides, and publishing built in rather than added through plugins or paid tiers.

| | Tagdown | Obsidian | Logseq | Notion |
| --- | :---: | :---: | :---: | :---: |
| Notes are plain Markdown files on disk | ✅ | ✅ | ⚠️ original app only; new DB version uses SQLite | ❌ cloud database |
| Works fully offline, no account | ✅ | ✅ | ✅ | ⚠️ account required; pages offline one by one |
| Open source | ✅ MIT | ❌ | ✅ AGPL | ❌ |
| Wikilinks and backlinks | ✅ | ✅ | ✅ | ⚠️ @-mentions |
| Nested tags | ✅ | ✅ | ✅ | ⚠️ properties |
| Daily journal | ✅ | ✅ | ✅ | ⚠️ templates |
| Graph of linked notes | ⚠️ local graph per note | ✅ global and local | ✅ global and per page | ❌ |
| Save web pages as notes | ⚠️ paste a link in the app | ✅ Web Clipper extension | ⚠️ via plugins | ✅ Web Clipper |
| Tabs and side-by-side notes | ✅ | ✅ | ⚠️ right sidebar only | ⚠️ side peek |
| Callouts, tabs, grids, cards | ✅ built in | ⚠️ callouts; rest via plugins | ⚠️ admonitions | ✅ blocks |
| Math and Mermaid diagrams | ✅ | ✅ | ⚠️ Mermaid via plugin | ✅ |
| Live queries over notes and tasks | ✅ built in | ⚠️ Bases / Dataview | ✅ | ✅ databases |
| Table, board, and card views | ✅ built in | ⚠️ Bases tables and cards; boards via plugins | ⚠️ tables; boards via plugins | ✅ |
| Note types with templates | ✅ built in | ⚠️ Templates; no types | ⚠️ tag classes in DB version | ✅ database templates |
| Version history | ✅ local, free | ⚠️ File recovery; full history with paid Sync | ⚠️ via git | ⚠️ limited on free plan |
| Present as slides | ✅ | ✅ | ✅ | ❌ |
| Publish as a website | ✅ free static site | ⚠️ paid Publish | ✅ static export | ✅ Notion Sites |
| CLI and MCP server for AI assistants | ✅ built in | ⚠️ official CLI; MCP via community | ⚠️ CLI in DB version; MCP via community | ✅ hosted MCP |
| Mobile apps | ❌ | ✅ | ✅ | ✅ |
| Sync and real-time collaboration | ❌ bring your own sync | ⚠️ paid Sync, no live co-editing | ⚠️ sync in beta for sponsors | ✅ |
| Plugin ecosystem | ❌ | ✅ | ✅ | ⚠️ integrations |
| Platforms | macOS | macOS, Windows, Linux, mobile | macOS, Windows, Linux, mobile | Web, desktop, mobile |

✅ built in · ⚠️ partial, paid, or via plugins · ❌ not available. Based on each product's public features as of October 2026; corrections are welcome as issues or PRs.

## Download

Grab the latest **`.dmg`** from [Releases](https://github.com/sthix/tagdown/releases/latest). It's a universal build for Apple silicon and Intel Macs. Open it and drag **Tagdown Editor** into Applications.

### Opening the app the first time

The app isn't signed with an Apple Developer ID yet, so macOS blocks the first launch with a message like *"Apple could not verify 'Tagdown Editor' is free of malware"*. To open it anyway:

1. Try to open **Tagdown Editor** once and dismiss the warning.
2. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the Tagdown Editor message.
3. Confirm with **Open**. macOS remembers the choice, so later launches just work.

If macOS instead says the app *"is damaged and can't be opened"*, remove the download quarantine flag in Terminal:

```sh
xattr -dr com.apple.quarantine "/Applications/Tagdown Editor.app"
```

Prefer to check the code first? Build it yourself as described below.

## Building from source

You need Node.js 20+, Rust stable, and the [Tauri prerequisites for macOS](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri:dev
```

Build a release with:

```sh
npm run build
npm run tauri:build
```

On first launch the app creates a vault at `~/Documents/Tagdown` with a few starter notes. To use another folder, or an existing Obsidian vault, choose **Open folder as vault…** in Settings. More in [Getting started](docs/getting-started.md).

## Command line and AI assistants

```sh
cargo install --path src-tauri/core

tagdown search "tag:project budget"
tagdown new "Meeting notes" "Agenda for [[Project Atlas]]"
tagdown new "Dune" --type Book
tagdown append "Meeting notes" "- [ ] Send recap"
tagdown tasks
```

Connect Claude Code to your vault:

```sh
claude mcp add tagdown -- tagdown mcp
```

Claude Desktop setup, every command, and the full list of MCP tools are in [Command line and AI assistants](docs/cli-and-mcp.md).

## Documentation

The guides below are also published at **[sthix.github.io/tagdown](https://sthix.github.io/tagdown/)**.

| | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Download, build from source, first launch |
| [Writing notes](docs/writing-notes.md) | Workspace, view modes, images, toolbar, themes and accents |
| [Tagdown syntax](docs/syntax.md) | Everything Tagdown adds to Markdown |
| [Organizing your vault](docs/organizing.md) | Vaults, folders, tags, note types, web links, pinning, archive, search, wikilinks, graph |
| [Journal](docs/journal.md) | Daily pages, date links, quick capture, what happened on a day, journal template |
| [Queries and tasks](docs/queries-and-tasks.md) | Live queries, tables, boards, cards, task days, priorities and repeats, and the open-tasks view |
| [Version history](docs/version-history.md) | Snapshots and restoring |
| [Sharing your notes](docs/sharing.md) | HTML, PDF, slides, and website publishing |
| [Command line and AI assistants](docs/cli-and-mcp.md) | The `tagdown` CLI and MCP server |
| [Keyboard shortcuts](docs/keyboard-shortcuts.md) | Every shortcut on one page |
| [Development](docs/development.md) | Architecture, layout, tests, releasing |

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri v2 |
| UI | Vanilla TypeScript + Vite |
| Vault, search, CLI, MCP | Rust (`tagdown-core`) |
| Search | Tantivy |
| Math rendering | KaTeX |
| Diagrams | Mermaid |
| Storage model | Local filesystem vault of Markdown files |

## Validation

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --workspace
cargo check --manifest-path src-tauri/Cargo.toml --workspace
node --test tests/*.mjs
```

## Current status

Tagdown Editor is an active early-stage desktop app (v0.1.0). The writing workspace (with slash commands, outliner lists, and drag-to-reorder blocks), multiple vaults with folders on disk, full-text search, wikilinks and backlinks with a local graph, the daily journal with quick capture, note types, live queries with tables, boards and cards, tasks with days and repeats, saved web links, version history, file watching, HTML/PDF export, slides, website publishing, and the CLI/MCP server are in place. Still to come: drag-and-drop Markdown import, more settings, and a full native menu bar.

See [`PROJECT_PLAN.md`](PROJECT_PLAN.md) for the roadmap.

Experimental integrations are preserved separately on [`codex/reflect-integrations`](https://github.com/sthix/tagdown/tree/codex/reflect-integrations). See [Development](docs/development.md#preserved-integrations) for the checkpoint and how to resume that work.

## Why this exists

Most note apps force a tradeoff: beautiful rendered documents, or durable plain-text files. Tagdown aims for both. You write in a format that stays readable and portable, while the editor turns it into structured, presentation-quality notes.
