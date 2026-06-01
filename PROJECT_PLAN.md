# Tagdown Editor Implementation Plan

This plan tracks the current Tauri v2 implementation and remaining product work.

## Phase 0 — Decisions and setup

- Use Tauri v2 + Vanilla TypeScript + Vite.
- Use Rust for local vault/file commands and TypeScript for UI and Tagdown rendering.
- Use `@tauri-apps/plugin-dialog` for folder/save dialogs.
- Use `@tauri-apps/plugin-opener` for Finder reveal/open actions.
- Use Tantivy for full search once the command/UI slice is stable; the scaffold currently includes a lightweight search fallback.
- Defer PDF export until a reliable macOS/Tauri print-to-PDF path is selected.

## Phase 1 — MVP vertical slice

- Bootstrap a default vault at `~/Documents/Tagdown`.
- Create `.tagdown/vault.json` and starter notes on first launch.
- Implement note list, note open, source/split/preview modes, and debounced autosave.
- Extract and reuse the Tagdown parser from `../tagdown-live.html`.
- Provide a basic three-pane layout matching the spec.

## Phase 2 — Full note and folder management

- Complete note move/star/delete/destroy flows in the UI.
- Add folder CRUD UI and context menus.
- Finalize the folder rule: `vault.json` is canonical; directories are synchronized as a backend side effect.
- Add better conflict handling for external edits.

## Phase 3 — Search and indexing

- Replace the fallback search with a real Tantivy index in `.tagdown/search.idx/`.
- Rebuild the index on first launch and incrementally update it on save/delete.
- Support query syntax: words, phrases, `tag:`, `title:`, and exclusions.

## Phase 4 — Import, export, settings

- Add drag-and-drop `.td` import.
- Implement standalone HTML export using the parser output and bundled CSS/fonts.
- Add settings persistence and panels.
- Spike PDF export separately.

## Phase 5 — Native polish

- Add full macOS menu structure and keyboard shortcuts.
- Add context menus and Finder reveal actions.
- Add app icons, bundled fonts, light theme, and accessibility pass.

## Validation checklist

- `npm install` succeeds.
- `npm run build` succeeds.
- `cargo test --manifest-path src-tauri/Cargo.toml` passes.
- `cargo check --manifest-path src-tauri/Cargo.toml` passes.
- `npm run tauri:dev` opens the app.
- First launch creates a vault and starter notes.
- Editing a note autosaves and reloads correctly.
- Preview renders Tagdown from the extracted parser.
