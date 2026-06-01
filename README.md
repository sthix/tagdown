# Tagdown

**A local-first desktop writing app for Tagdown — Markdown with structure, tags, math, diagrams, and polished previews.**

Tagdown is for people who want notes to stay as durable plain-text files, but still want the reading experience of a beautiful, structured document. The editor is built with **Tauri + Rust + TypeScript** and gives you a fast desktop workspace for writing, organizing, previewing, and eventually exporting Tagdown notes.

<img width="1533" height="1035" alt="Tagdown editor screenshot" src="https://github.com/user-attachments/assets/1902befb-3b0d-4d1a-b27c-058b71fd77f7" />

## What makes it different?

Most Markdown editors stop at basic formatting. Tagdown keeps Markdown's simplicity and adds document-native building blocks:

- **Tags everywhere** — organize notes with frontmatter tags and inline hashtags.
- **Rich components** — callouts, cards, tabs, columns, details blocks, keyboard hints, and more.
- **Technical writing support** — KaTeX math and Mermaid diagrams built into the preview pipeline.
- **Local ownership** — notes live in a filesystem vault, not a cloud silo.
- **Instant preview** — write in source, split, or rendered preview mode.
- **Desktop-native foundation** — Tauri keeps the app lightweight while Rust handles local vault operations.

## Repository layout

```text
.
├── tagdown-editor/       # Tauri desktop editor app
├── docs/                 # Design notes and Tagdown documentation
├── LICENSE
└── README.md
```

The main application lives in [`tagdown-editor/`](tagdown-editor/).

## Quick start

```sh
cd tagdown-editor
npm install
npm run tauri:dev
```

For a web-only development preview:

```sh
cd tagdown-editor
npm run dev
```

## Build and validate

```sh
cd tagdown-editor
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
node --test tests/*.mjs
```

## Tech stack

| Area | Stack |
| --- | --- |
| Desktop shell | Tauri v2 |
| Backend/local commands | Rust |
| UI | Vanilla TypeScript + Vite |
| Math | KaTeX |
| Diagrams | Mermaid |
| Storage | Local filesystem vault |

## Status

Tagdown is in active early development. The editor currently includes the core three-pane workspace, vault bootstrap, note management foundations, autosave, Tagdown parsing/rendering, tag navigation, settings/reference UI, and production build pipeline.

Next up: deeper search indexing, import/export polish, file watching/conflict handling, and native menu/context-menu refinement.

## Philosophy

**Plain text should not mean plain documents.**

Tagdown aims to make structured, presentation-quality notes while preserving the portability, inspectability, and longevity of files you can open anywhere.
