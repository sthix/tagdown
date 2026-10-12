# Organizing your vault

## Where notes live

Your vault is `~/Documents/Tagdown`. Each note is a Markdown file named `note-<id>.md`, with a small frontmatter block Tagdown maintains for you:

```markdown
---
id: 4f2c…
title: Atlas launch plan
tags: [project/atlas, planning]
starred: true
folder_id: projects
created: 2026-10-03T09:12:00Z
updated: 2026-10-12T09:42:00Z
---
# Atlas launch plan
…
```

Folders and tag colours are recorded in `.tagdown/vault.json`. Because notes are ordinary files, you can back the vault up, sync it, or keep it in git. Changes made outside the app are picked up while it runs.

## Folders

- Create a folder from the sidebar's **Library** section. Folders can be nested.
- Drag a folder onto another to nest it, or between two folders to reorder.
- New notes are created in the selected folder.
- **All Notes** shows every note that isn't archived.

## Tags

Write `#tag` anywhere in a note, or `#parent/child` for a nested tag. Tags written in the text are collected into the note's frontmatter when it saves, and are lowercased.

The sidebar shows tags as a tree. Click a tag to list its notes; a parent tag includes the notes of its children. You can also create a tag from the sidebar and pick one of seven colours for it. Tags without a chosen colour get one automatically.

## Pinning and filters

Pin a note with the pin button in the editor's top-right corner. The pills above the note list filter the current view:

| Filter | Shows |
| --- | --- |
| All | Everything in the current folder or tag |
| Pinned | Pinned notes only |
| Untagged | Notes without any tags |
| Recent | The ten most recently edited notes |

## Archive and delete

Deleting a note moves it to the **Archive** after a confirmation. Archived notes stay on disk but are left out of All Notes, search, and queries. Deleting a note from inside the Archive removes it for good.

## Search

Open search with **⌘K** or the magnifier in the sidebar. Search is full text, backed by a [Tantivy](https://github.com/quickwit-oss/tantivy) index in `.tagdown/search.idx/`, and ignores accents.

| Query | Matches |
| --- | --- |
| `budget review` | Notes containing both words (the last word also matches as a prefix while you type) |
| `"launch plan"` | The exact phrase |
| `title:atlas` | Notes with *atlas* in the title |
| `tag:project` | Notes tagged `project` or any tag below it, such as `project/atlas` |
| `-draft` | Excludes notes containing *draft* (works with `-tag:` and `-title:` too) |

Results show highlighted excerpts. The same syntax works in [queries](queries-and-tasks.md) and the [`tagdown search`](cli-and-mcp.md) command.

## Wikilinks and backlinks

- `[[Note title]]` links to another note by title (case-insensitive). Typing `[[` opens autocomplete.
- Clicking a link opens the note. If no note has that title yet, Tagdown creates it.
- `[[Note title#Heading]]` jumps to a heading; `[[Note title|label]]` shows a different label.
- When you rename a note, links to it in other notes are updated automatically.
- Below each note, **Linked mentions** lists the notes that link to it, with the lines that mention it.
