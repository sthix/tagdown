# Development

## Architecture

Tagdown Editor is a [Tauri v2](https://v2.tauri.app) app:

| Layer | Technology | Where |
| --- | --- | --- |
| UI | Vanilla TypeScript + Vite | `src/` |
| Tagdown parser and renderer | TypeScript, KaTeX, Mermaid | `src/tagdown/` |
| App commands | Rust (Tauri commands) | `src-tauri/src/commands/` |
| Vault, search, links, history, queries | Rust (`tagdown-core` crate) | `src-tauri/core/src/` |
| CLI and MCP server | Rust (`tagdown` binary) | `src-tauri/core/src/bin/tagdown.rs`, `src-tauri/core/src/mcp.rs` |

The UI never touches the filesystem directly; it calls Tauri commands, which go through `tagdown-core`. The CLI and MCP server use the same crate, so the app, the command line, and AI assistants all read and write notes the same way, with the same version history.

## Project layout

```text
.
├── src/
│   ├── main.ts             # app shell: sidebar, note list, editor, shortcuts
│   ├── commandPalette.ts   # ⌘K palette
│   ├── wikilinks.ts        # [[link]] resolution and autocomplete
│   ├── slashCommands.ts    # the / command menu
│   ├── listEditing.ts      # ↩, Tab and ⇧Tab in lists (continue, nest, renumber)
│   ├── blockDrag.ts        # drag-and-drop reordering of preview blocks
│   ├── queries.ts          # <query /> blocks and the open-tasks view
│   ├── history.ts          # version history dialog
│   ├── presentation.ts     # slides
│   ├── export.ts           # HTML export and print
│   ├── publish.ts          # static website publishing
│   ├── settings/           # settings dialog and theme
│   ├── styles/             # CSS (tokens.css holds the light and dark palettes)
│   └── tagdown/            # parser, renderer, blocks, slides, syntax reference data
├── src-tauri/
│   ├── src/commands/       # Tauri commands called from the UI
│   └── core/src/           # vault, frontmatter, search_index, links, history,
│                           # tasks, query, watcher, site, library, mcp
├── scripts/gen-syntax.mjs  # generates core/src/syntax.md from the reference data
├── tests/                  # Node tests for rendering, blocks, lists, slash commands, slides, syntax
└── docs/                   # this documentation
```

## Running checks

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --workspace
cargo check --manifest-path src-tauri/Cargo.toml --workspace
node --test tests/*.mjs
```

## The syntax reference

The Tagdown reference has one source: `src/tagdown/documentation.ts`. It feeds the in-app **Settings → Tagdown Reference** and, through `npm run gen:syntax`, the generated `src-tauri/core/src/syntax.md` that the CLI and MCP server hand out. Run `npm run gen:syntax` after changing the reference; a test fails when the generated file is out of date.

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org): `feat(scope): …`, `fix: …`, `docs: …`, `style(ui): …`.
- Notes stay plain Markdown files. New features should keep the vault readable without the app.
- See [`PROJECT_PLAN.md`](https://github.com/sthix/tagdown/blob/main/PROJECT_PLAN.md) for the roadmap.
