# Tagdown Editor

Tauri v2 scaffold for the local-first macOS Tagdown note editor described in `../tagdown-editor-spec.md`.

## Current status

Implemented scaffold:

- Tauri v2 + Vanilla TypeScript + Vite project structure
- Rust models and command modules
- Default vault bootstrap at `~/Documents/Tagdown`
- Frontmatter parser/writer with unit test
- Note CRUD command skeleton
- Folder CRUD command skeleton
- Basic three-pane UI
- Source/split/preview modes
- Debounced autosave
- Tagdown parser extracted from `../tagdown-live.html`
- Basic HTML export placeholder
- Finder reveal commands via `tauri-plugin-opener`
- In-app Settings modal with bundled Tagdown Reference documentation

Known deferred items:

- Full Tantivy index implementation
- PDF export
- Drag-and-drop import
- Settings UI
- File watching/conflict prompts
- Full macOS menu/context menu polish

## Development

```sh
npm install
npm run tauri:dev
```

## Validation

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```
