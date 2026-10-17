# Queries and tasks

## Live queries

A `<query />` block lists notes or tasks from across the vault that match a search. The list is computed when the note renders and refreshes as notes change.

```tagdown
## Open project tasks

<query tag:project show:tasks />

## Recently edited in Work

<query folder:Work sort:updated limit:5 />
```

The query uses the [search syntax](organizing.md#search) (words, `"phrases"`, `tag:`, `title:`, `-exclusions`) plus these options:

| Option | Values | Default |
| --- | --- | --- |
| `show:` | `notes`, `tasks`, `table`, `board`, `cards` | `notes` |
| `status:` | `open`, `done`, `all` (for tasks) | `open` |
| `sort:` | `updated`, `created`, `title`, or a property (`sort:due`, `sort:-priority` for descending) | `updated` |
| `folder:` | A folder name; quote names with spaces | All folders |
| `type:` | A [note type](organizing.md#note-types), like `type:Book` | All types |
| `columns:` | Properties to show in a table, on board cards or on cards | The ones the query uses |
| `group:` | The property a board's lanes are values of | `status` |
| `lanes:` | A board's lanes, in order, like `lanes:todo,doing,done` | The values notes use |
| `limit:` | A number up to 500 | 50 |

A note never lists itself. When a query shows tasks, ticking one in the list ticks it in the note it lives in.

## Filtering by property

Queries filter on a note's [properties](writing-notes.md#properties):

| Filter | Matches |
| --- | --- |
| `status=active` | The value, without case; a list holding it; a link by its title |
| `status!=done` | Notes whose value isn't that, including notes without it |
| `priority=2..`, `due=..today+7` | Ranges of numbers or dates, either end open; `today`, `today+N`, `today-N` |
| `has:owner`, `-has:owner` | Notes with (or without) a value |

```tagdown
## Due this week

<query status=active due=..today+7 sort:due />
```

## Tables, boards and cards

Three views show the matching notes with their properties, and each can add a note that already matches the query: in its folder, with its tags and the values its `key=value` filters ask for. For a `type:`, the new note starts from the type's [template](organizing.md#templates).

**`show:table`** lists the notes with a column per property. Edit a cell to change that note's property, click a header to sort, × hides a column and + adds one. These rewrite the query in the note, so the view stays plain text.

```tagdown
<query tag:project show:table columns:status,owner,due sort:due />
```

**`show:board`** puts the notes in a lane per value of one property, `status` unless `group:` names another. Drag a card to another lane to change that note's property; for a list property, the card swaps the one item. Notes without a value go in a last lane, and dragging a card there clears the property. `lanes:` fixes the lanes' order and shows lanes no note uses yet; **+ Lane** adds one by writing `lanes:` into the query. **+ New** in a lane adds a note with that lane's value.

```tagdown
<query type:Project show:board lanes:planned,active,done columns:owner,due />
```

**`show:cards`** shows a grid of cards with each note's cover image, opening lines, and the properties `columns:` names. The cover is the note's `cover:` property (a path in the vault or a URL), or else the first image in the note.

```tagdown
<query type:Book show:cards columns:author,rating sort:-rating />
```

Queries are also evaluated when you [export, publish, or present](sharing.md) a note, so the output contains the list as it was at that moment.

## Tasks

A task is any list item written as `- [ ]` (open) or `- [x]` (done):

```tagdown
- [x] Private alpha with 40 testers
- [ ] Publish the docs site
```

Click a checkbox in the preview to tick it; the source is updated for you.

## The open-tasks view

Press **⌘⇧T** (or choose **Show open tasks** in the command palette) to see every unticked task in the vault, grouped by note. Tick tasks off right there, or click a note to open it.

From the command line, `tagdown tasks` prints the same list; see [Command line and AI assistants](cli-and-mcp.md).
