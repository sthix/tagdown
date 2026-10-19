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
├── Projects/             # a folder: notes filed in it live here
├── Archive/              # archived notes
├── attachments/          # images added to notes
└── .tagdown/
    ├── vault.json        # folders, tag colours, vault settings
    ├── templates.json    # built-in template availability for this vault
    ├── search.idx/       # the full-text search index (rebuilt on launch)
    └── history/          # version history snapshots
```

Three starter notes are created: **Welcome to Tagdown**, **Tagdown Cheat Sheet**, and **Your First Note**. Open one, switch to **Split** view (⌘2), and start typing. Notes save automatically.

The **Types** sidebar also starts with editable **Journal**, **Book**, **Person**, **Project**, **Meeting**, and **Recipe** templates. Use **Settings → Templates** to edit, turn off, or reset them for this vault. To make a more specific kind, such as Author under Person, click the **+** on the parent's type row. See [templates and child types](organizing.md#child-types).

<figure class="doc-visual">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/tagdown-editor-dark.png" />
    <img src="images/tagdown-editor-light.png" width="1440" height="900" loading="lazy" decoding="async" alt="Tagdown in Split view: the library and tags on the left, the note list in the middle, and Atlas launch plan with editable source beside its rendered preview on the right." />
  </picture>
  <figcaption>An example workspace with a few notes added. In Split view, the text you write on the left becomes the preview on the right.</figcaption>
</figure>

## Next steps

- [Writing notes](writing-notes.md): find your way around the workspace.
- [Tagdown syntax](syntax.md): see what Tagdown adds to Markdown.
- [Command line and AI assistants](cli-and-mcp.md): install the `tagdown` CLI and connect Claude.
