# Tagdown documentation

Everything about using Tagdown Editor, from your first note to publishing a website and letting an AI assistant work with your vault.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/tagdown-editor-dark.png" />
  <img width="1440" alt="Tagdown Editor in split view, with three notes open as tabs and the launch plan's properties folded to one line" src="images/tagdown-editor-light.png" />
</picture>

## Guides

| Guide | What's in it |
| --- | --- |
| [Getting started](getting-started.md) | Download or build the app; what happens on first launch |
| [Writing notes](writing-notes.md) | The workspace, tabs and panes, properties, view modes, editing and reordering blocks in the preview, the `/` command menu, lists and outlines, the toolbar, themes and accents |
| [Tagdown syntax](syntax.md) | Markdown plus callouts, tabs, grids, math, diagrams, and more |
| [Organizing your vault](organizing.md) | Where notes live, several vaults, folders, tags, pinning, the archive, search, and wikilinks |
| [Journal](journal.md) | A page for every day, date links, and a template for new days |
| [Queries and tasks](queries-and-tasks.md) | Live `<query />` blocks and the open-tasks view |
| [Version history](version-history.md) | How snapshots are kept and how to restore one |
| [Sharing your notes](sharing.md) | HTML and PDF export, slides, and publishing a static website |
| [Command line and AI assistants](cli-and-mcp.md) | The `tagdown` CLI and its MCP server for Claude and other assistants |
| [Keyboard shortcuts](keyboard-shortcuts.md) | Every shortcut on one page |
| [Development](development.md) | Architecture, project layout, tests, releasing, and contributing |

## At a glance

- Notes are plain `.md` files in `~/Documents/Tagdown`. You own them; any editor, sync service, or git can read them.
- Tagdown is Markdown with a small tag layer on top. Plain Markdown is always valid Tagdown.
- The app is built with Tauri v2, TypeScript, and Rust, and is designed for macOS.
