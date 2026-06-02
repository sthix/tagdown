# Tagdown Editor

**A fast, local-first desktop editor for Tagdown notes — Markdown plus rich semantic blocks, tags, math, diagrams, and export-ready previews.**

Tagdown Editor is a macOS-focused Tauri app for writing structured notes without giving up plain-text ownership. Notes live on disk, render instantly in a polished preview, and can use Tagdown components such as callouts, tabs, cards, details, math, Mermaid diagrams, and tag-aware metadata.

<p align="center">
  <strong>Plain text in. Beautiful documents out.</strong><br />
  Local vaults · Split editor/preview · Tag navigation · KaTeX · Mermaid · Tauri
</p>

---

<img width="1412" height="912" alt="image" src="https://github.com/user-attachments/assets/1959c312-06eb-466e-8e4b-dcf3b3153714" />


## What is Tagdown?

Tagdown is a note format built on Markdown with extra structure for knowledge work:

- familiar Markdown for headings, lists, links, quotes, and code
- inline and frontmatter tags for organization
- reusable document components such as callouts, cards, tabs, columns, accordions, and keyboard hints
- rich technical writing support through KaTeX math and Mermaid diagrams
- preview output that feels closer to a finished document than a raw note

This repository contains the desktop editor for that format.

## Highlights

- **Local-first vaults** — notes are stored as regular files in a local vault, with a default vault created at `~/Documents/Tagdown`.
- **Three-pane writing workspace** — folder navigation, note list, and editor/preview area.
- **Source, split, and preview modes** — move from raw text to rendered document without leaving the app.
- **Autosave workflow** — debounced saving keeps writing fluid.
- **Tag-aware navigation** — parse tags from frontmatter and note bodies, then browse/filter by tag.
- **Rich Tagdown renderer** — supports extended components, syntax highlighting-friendly code blocks, KaTeX math, and Mermaid diagrams.
- **Formatting toolbar** — quick insert actions for common Markdown and Tagdown structures.
- **Native shell** — built with Tauri v2 for a lightweight desktop app backed by Rust file commands.

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri v2 |
| UI | Vanilla TypeScript + Vite |
| Local commands | Rust |
| Math rendering | KaTeX |
| Diagrams | Mermaid |
| Storage model | Local filesystem vault |

## Getting started

### Prerequisites

- Node.js 20+
- Rust stable
- Tauri system prerequisites for macOS

### Install

```sh
npm install
```

### Run the web dev server

```sh
npm run dev
```

### Run the desktop app

```sh
npm run tauri:dev
```

### Build

```sh
npm run build
npm run tauri:build
```

## Validation

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
node --test tests/*.mjs
```

## Project structure

```text
.
├── src/                  # TypeScript UI, editor behavior, parser, renderer, styles
├── src-tauri/            # Tauri/Rust backend commands and app configuration
├── tests/                # Node-based rendering tests
├── package.json          # Frontend scripts and dependencies
└── README.md
```

## Current status

Tagdown Editor is an active early-stage desktop app. The core writing workspace, local vault bootstrap, note operations, Tagdown parsing/rendering, settings/reference UI, and build pipeline are in place. Remaining polish includes deeper search indexing, import/export expansion, file watching/conflict prompts, and native menu refinements.

See [`PROJECT_PLAN.md`](PROJECT_PLAN.md) for the implementation roadmap.

## Why this exists

Most note apps force a tradeoff: beautiful rendered documents, or durable plain-text files. Tagdown aims for both. You write in a format that stays readable and portable, while the editor turns it into structured, presentation-quality notes.
