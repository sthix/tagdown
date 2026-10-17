# Organizing your vault

## Where notes live

Your vault is `~/Documents/Tagdown` unless you choose another folder (see [More than one vault](#more-than-one-vault)). Every Markdown file in it is a note, and every folder in it is a folder in Tagdown. Notes Tagdown creates are named `note-<id>.md` and carry a small frontmatter block Tagdown maintains for you:

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

Markdown files from elsewhere (an Obsidian vault, say) show up as they are, titled by their first `# ` heading or else their file name. Their own frontmatter is kept; Tagdown adds its fields the first time it saves one, and never touches a file you only read. Hidden folders such as `.git` or `.obsidian` are skipped, and so is a folder that's a vault of its own.

Folder icons, sidebar order and tag colours are recorded in `.tagdown/vault.json`. Because notes are ordinary files, you can back the vault up, sync it, or keep it in git. Changes made outside the app, notes and folders alike, are picked up while it runs.


## More than one vault

A vault is any folder Tagdown keeps notes in, and you can have several: one for work, one for home, one on an external drive. In **Settings → General → Vault**, click **Open folder as vault…** and pick a folder; an empty or existing folder becomes a vault the first time you open it. Every vault you've opened stays in the list, and **Open** next to one switches to it. ⌘K finds the same commands: *Switch to vault …* and *Open folder as vault…*.

Switching restarts Tagdown in the other vault, after saving whatever you were writing. Removing a vault from the list (the × on hover) only forgets it; its files stay where they are. The `tagdown` CLI and MCP server use whichever vault the app opened last.

## Folders

- Folders are directories in the vault. Creating, renaming, nesting or deleting one in Tagdown does the same on disk, and a folder you make in Finder appears in the sidebar.
- Create a folder from the sidebar's **Library** section. Folders can be nested.
- Drag a folder onto another to nest it, or between two folders to reorder.
- New notes are created in the selected folder, and moving a note to another folder moves its file. Archived notes live in `Archive/`.
- Deleting a folder moves its notes to the top of the vault. A folder that also holds other files (images, PDFs) isn't deleted; move those out in Finder first.
- **All Notes** shows every note that isn't archived, [journal](journal.md) pages included.

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
