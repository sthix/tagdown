# Writing notes

## The workspace

The window has three areas:

1. **Sidebar.** The library (All Notes, Archive, and your folders) and the tag tree. Search, the theme switch, and focus mode sit at the top; **New note** and **Settings** at the bottom.
2. **Note list.** Notes in the current folder or tag, grouped by date (Today, Yesterday, Previous 7 days, and so on). The pills at the top filter it: **All**, **Pinned**, **Untagged**, **Recent**.
3. **Editor.** The open note, with its breadcrumb, save status, view switcher, and note actions.

Press **⌘\\** for focus mode, which hides the sidebar and note list so only the note is left.

## Titles

A note's title is its first `# ` heading. Rename a note by editing that heading. If other notes link to it with `[[wikilinks]]`, Tagdown updates those links automatically once the new title settles (see [Organizing your vault](organizing.md#wikilinks-and-backlinks)).

## View modes

| Mode | Shortcut | What you see |
| --- | --- | --- |
| Source | ⌘1 | The raw Tagdown text |
| Split | ⌘2 | Source and rendered preview side by side |
| Preview | ⌘3 | Only the rendered document |

In **Preview**, you can still edit: click a block to edit its source in place. Press **Esc** or **⌘↩** to finish. Ticking a checkbox in the preview updates the task in the source.

## Saving

Notes autosave shortly after you stop typing. **⌘S** saves immediately. The status next to the view switcher shows **Saved to vault** once the note is on disk.

If a note changes on disk while it is open (another editor, a `git pull`, a sync service, or the `tagdown` CLI), Tagdown reloads it. If you also have unsaved edits, it asks which version to keep. Either way, the version that gets replaced is kept in [version history](version-history.md).

## The formatting toolbar

The floating toolbar at the bottom of the editor inserts headings, bold, italic, and code. Its **Components** menu inserts any Tagdown component (callouts, tabs, grids, figures, queries, math, diagrams, and more) as a ready-to-edit template.

## The command palette

**⌘K** opens the command palette. Type to jump to a note by title or search inside notes (the [search syntax](organizing.md#search) works here), or run any app action: switch views, export, present, show tasks or history, change theme, and open settings. Use the arrow keys and **↩** to choose.

## Themes

Tagdown has a light and a dark theme. **⌘⇧D** switches between them. In **Settings → Appearance** (⌘,) you can also choose **System** to follow macOS.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/tagdown-editor-dark.png" />
  <img width="1440" alt="Tagdown Editor in split view" src="images/tagdown-editor-light.png" />
</picture>

## The built-in reference

**Settings → Tagdown Reference** lists every Tagdown component with an example you can see rendered. It is the same reference as [Tagdown syntax](syntax.md).
