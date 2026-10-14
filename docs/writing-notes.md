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

In **Preview**, you can still edit: click a block to edit its source in place. The open block gets a thin outline with a slowly moving highlight. Press **Esc** or **⌘↩** to finish. Ticking a checkbox in the preview updates the task in the source.

### Reordering blocks

To reorder blocks, hover one and drag the **⋮⋮** grip that appears in the left margin; a line shows where it will land, and **Esc** cancels. While editing a block, **⌘⇧↑** and **⌘⇧↓** move it past its neighbour. The note's title (and any frontmatter) always stays at the top.

A heading carries its whole section: everything under it, up to the next heading of the same or a higher level. With the keyboard, a heading steps past a whole sibling section at a time. To move headings on their own instead, turn off **Settings → Editor → Headings move their section**.

## Saving

Notes autosave shortly after you stop typing. **⌘S** saves immediately. The status next to the view switcher shows **Saved to vault** once the note is on disk.

If a note changes on disk while it is open (another editor, a `git pull`, a sync service, or the `tagdown` CLI), Tagdown reloads it. If you also have unsaved edits, it asks which version to keep. Either way, the version that gets replaced is kept in [version history](version-history.md).

## The command menu

Type **/** at the start of a line, or after a space, to open the command menu. Keep typing to filter it (`/h2`, `/todo`, `/callout`, `/table`), then press **↩** or **Tab** to apply the highlighted command, or **Esc** to close the menu and keep the text.

- **Basic blocks** turn the current line into a heading, bullet, numbered item, or task, and keep what you already wrote on it. Toggles, quotes, dividers, and tables are inserted too.
- **Components** (callouts, columns, tabs, images, code, math, diagrams, queries) replace an empty line, or go below the current one. The placeholder text is selected, so you can type straight over it.
- **Links and dates** insert a `[[` link (with the note autocomplete), a link to today's, tomorrow's, or yesterday's journal page, the current time, or a tag.

## Lists and outlines

Lists continue as you type. Press **↩** at the end of a bullet, a numbered item, or a task to start the next one; numbers count up, and new tasks start unticked. Press **↩** again on the empty item to end the list and go back to ordinary text.

Lists nest like an outliner. **Tab** makes the current item a child of the item above it, and takes its own children along. **⇧Tab** moves it back out. Nested items show a thin guide line in the preview, and numbered lists renumber themselves as items move. **⇧↩** adds a line inside an item without starting a new one.

## The formatting toolbar

The floating toolbar at the bottom of the editor inserts headings, bold, italic, and code. Its **Components** menu inserts any Tagdown component (callouts, tabs, grids, figures, queries, math, diagrams, and more) as a ready-to-edit template.

## The command palette

**⌘K** opens the command palette. Type to jump to a note by title or search inside notes (the [search syntax](organizing.md#search) works here), or run any app action: switch views, export, present, show tasks or history, change theme, and open settings. Use the arrow keys and **↩** to choose.

## Themes

Tagdown has a light and a dark theme. **⌘⇧D** switches between them. In **Settings → Appearance** (⌘,) you can also choose **System** to follow macOS, and set the preview's text size and line length.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/tagdown-editor-dark.png" />
  <img width="1440" alt="Tagdown Editor in split view" src="images/tagdown-editor-light.png" />
</picture>

## Settings

**⌘,** opens Settings. Everything there is saved on this Mac and applies right away.

- **General.** What opens on launch (the last note, today's journal page, or the most recent note), which view a note starts in or whether to remember the last one, whether archiving a note asks first, and where your vault lives, with **Reveal in Finder**. Deleting a note for good always asks.
- **Editor.** Spellcheck, the size of the source text, and **Headings move their section**, on by default, which decides whether dragging a heading takes the content under it along.
- **Appearance.** Theme, preview text size, and line length.
- **Shortcuts.** Every keyboard shortcut, also listed in [Keyboard shortcuts](keyboard-shortcuts.md).

## The built-in reference

**Settings → Tagdown Reference** lists every Tagdown component with an example you can see rendered. It is the same reference as [Tagdown syntax](syntax.md).
