# Inline Hashtags & Nested Tag Tree — Design

**Date:** 2026-05-27
**Component:** `tagdown-editor` (Tauri v2 + Vanilla TS + Rust)

## Problem

There is no way to attach tags to notes from within the note text. Today tags
exist only as manually-created colored records in the sidebar (`vault.json`
`TagRecord`s) and as a frontmatter `tags:` array that nothing populates. The
sidebar renders tags as a **flat** list.

We want users to create tags by typing a hashtag directly in the note body
(e.g. `#chemistry`), support **nested** tags (`#notes/chemistry`), and display
all tags in the left sidebar as a **nested tree** mirroring the Documents
folder tree.

## Decisions (confirmed with user)

1. **Coexist / merge** with the existing manual colored-tag system — manual
   creation (`+`) and color picker stay; inline hashtags auto-register
   alongside them.
2. **Keep `#tag` inline** in the note body (Obsidian/Bear style); the tag list
   is derived live from body content. Pills render in preview.
3. **All descendants**: clicking a parent tag (`#notes`) shows every note
   tagged `#notes` or any descendant (`#notes/chemistry`, …).

## Architecture

Body text is what the user edits; **frontmatter `tags` remains the persisted
source of truth** so `list_notes` and search keep working unchanged. On save,
tags are re-derived from the body and written to frontmatter — exactly the
pattern `save_note` already uses to re-derive the note title.

### 1. Hashtag syntax & extraction (Rust — `frontmatter.rs`)

- New `derive_tags(content: &str) -> Vec<String>`, sibling to `derive_title`.
- Regex: `(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)`
  - A whitespace/line-start boundary must precede `#`.
  - First tag char must be alphanumeric or `_`, so markdown headings
    (`# Heading`, `## H2`) are **not** tags.
  - Allowed tag chars: letters, digits, `_`, `-`, `/`.
- Normalization: strip leading/trailing `/`, collapse repeated `//`, drop empty
  segments, de-duplicate while preserving first-seen order.
- `cargo` dependency: `regex` (or hand-rolled scan to avoid a new dependency —
  implementer's call; a hand-rolled char scan is acceptable and keeps the
  dependency surface small).

### 2. Persistence (Rust — `vault.rs`)

- `save_note`: after `derive_title`, set `meta.tags = derive_tags(&content)`.
  Derived tags **replace** existing frontmatter tags (body is authoritative for
  inline tags). Legacy frontmatter-only tags with no matching `#hashtag` are
  dropped on next save — acceptable; seed notes carry none.
- `create_note`: derive tags from the initial content (currently none, so
  empty) for consistency.
- No change to `write_frontmatter`/`parse_tags`: nested names like
  `notes/chemistry` contain no comma and round-trip fine through the existing
  `[a, b]` serializer.

### 3. Manual tag records (Rust — `commands/tags.rs`)

- `slugify` updated to permit `/` (currently maps it to `-`), so manually
  created tags can also be nested and slot into the same tree. All other
  behavior unchanged.

### 4. Sidebar tag tree (TS — `renderTags` in `main.ts`)

- **Node set** = union of:
  - body-derived tag names across loaded notes (`note.tags`), and
  - manual `TagRecord` names.
- Split each full path on `/` to build a `childrenByParent` map, **synthesizing
  parent nodes** even when only a child exists (only `notes/chemistry` present
  ⇒ `notes` appears as a collapsible parent).
- Reuse the folder-tree mechanics from `renderFolders`: chevron disclosure,
  per-node expand/collapse (`expandedTags: Record<string, boolean>`), depth
  insets, count badges.
- **Count** per node = number of non-archive notes tagged with that exact path
  **or any descendant**.
- **Colors**: if a node's full path matches a `TagRecord`, render its color
  dot; otherwise a neutral dot.
- **Delete (`×`)** shown only for **orphan** tags (count 0 — manual records not
  present in any body). Body-derived tags are removed by editing notes.
- Manual "+" create card and color swatch picker unchanged.

### 5. Filtering (TS — `main.ts`)

- New `selectedTag: string | null`, **mutually exclusive** with
  `selectedFolder`.
- Selecting a tag: clear `selectedFolder`, load all notes (`folderId: null`),
  filter client-side to notes whose `tags` include the selected path or a
  descendant (`tag === sel || tag.startsWith(sel + '/')`), excluding archive.
- Selecting a folder or "All Notes": clear `selectedTag`.
- Note-list header shows `#<tag>` and the matching count when a tag is active.

### 6. Inline pills (TS — `renderer.ts` + `preview.css`)

- `renderPreview` parses to HTML, then walks text nodes of a detached element,
  skipping `code`, `pre`, and `a` ancestors, replacing `#tag` matches with
  `<span class="td-tag" data-tag="…">#tag</span>`.
- Clicking a pill selects that tag in the sidebar (same path as a sidebar
  click). Wired via event delegation on the preview container in `main.ts`.
- New `.td-tag` style in `preview.css`; `.tag-tree-item` + disclosure styles in
  `sidebar.css` (mirroring `.folder-tree-item`).

### 7. Note-list chips (no change)

`renderNotes` already renders `note.tags.slice(0, 3)` as chips — these now
populate automatically once `save_note` derives tags.

## Components & boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `derive_tags` (Rust) | Body string → ordered unique tag paths | — |
| `save_note`/`create_note` (Rust) | Persist derived tags to frontmatter | `derive_tags` |
| `slugify` (Rust) | Manual tag id allowing `/` | — |
| `renderTags` (TS) | Build + render nested tag tree, counts, colors | `notes`, `tags`, `expandedTags` |
| tag filter (TS) | Scope note list to a tag subtree | `selectedTag` |
| `renderPreview` (TS) | HTML + hashtag pills | parser, DOM walk |

## Testing

- **Rust unit tests** (`frontmatter.rs`): `derive_tags` covers
  - plain `#tag`, nested `#a/b/c`
  - headings excluded (`# Heading`, `## H2`)
  - mid-word `#` excluded (boundary rule), e.g. `foo#bar`
  - trailing punctuation stops the tag (`#tag.` ⇒ `tag`)
  - de-duplication and order preservation
  - trailing/duplicate slash normalization (`#a//b/` ⇒ `a/b`)
- **Rust**: extend the existing frontmatter round-trip test to assert a nested
  tag survives write→read.
- **Manual / QA**: type `#notes/chemistry` in a note, confirm it persists,
  appears as a sidebar tree node under `notes`, the chip shows on the card, the
  pill renders in preview, and clicking either the pill or the sidebar node
  filters the list (including descendants).

## Out of scope (YAGNI)

- Tag rename/refactor across notes.
- Drag-and-drop reordering of tags.
- Autocomplete while typing `#`.
- Tag colors for body-derived (non-record) tags beyond the neutral dot.
- Search-syntax changes (`tag:` already exists in the search spec).
