# Getting started

The quickest way in is the prebuilt `.dmg` from [Releases](https://github.com/sthix/tagdown/releases/latest), a universal build for Apple silicon and Intel Macs. It isn't signed with an Apple Developer ID yet, so the first launch needs one extra step: see [Opening the app the first time](https://github.com/sthix/tagdown#opening-the-app-the-first-time).

To build from source instead, you need a Mac set up for Tauri development.

## Prerequisites

- Node.js 20 or newer
- Rust (stable toolchain)
- The [Tauri system prerequisites for macOS](https://v2.tauri.app/start/prerequisites/) (Xcode Command Line Tools)

## Install and run

```sh
git clone https://github.com/sthix/tagdown.git
cd tagdown
npm install
npm run tauri:dev
```

`npm run tauri:dev` starts the Vite dev server on port 1420 and opens the desktop app with hot reload.

> `npm run dev` on its own serves only the web UI. It can't read or write notes, because those calls go to the Rust backend that only exists inside the desktop app.

## Build a release

```sh
npm run build
npm run tauri:build
```

The app bundle lands in `src-tauri/target/release/bundle/`.

## First launch

On first launch Tagdown creates a vault at `~/Documents/Tagdown` (you can switch to another folder, or keep several vaults, in Settings; see [Organizing](organizing.md#more-than-one-vault)):

```text
~/Documents/Tagdown/
├── note-<id>.md          # one file per note
├── Archive/
└── .tagdown/
    ├── vault.json        # folders, tag colours, vault settings
    ├── search.idx/       # the full-text search index (rebuilt on launch)
    └── history/          # version history snapshots
```

Three starter notes are created: **Welcome to Tagdown**, **Tagdown Cheat Sheet**, and **Your First Note**. Open one, switch to **Split** view (⌘2), and start typing. Notes save automatically.

## Next steps

- [Writing notes](writing-notes.md): find your way around the workspace.
- [Tagdown syntax](syntax.md): see what Tagdown adds to Markdown.
- [Command line and AI assistants](cli-and-mcp.md): install the `tagdown` CLI and connect Claude.
