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
| `show:` | `notes`, `tasks` | `notes` |
| `status:` | `open`, `done`, `all` (for tasks) | `open` |
| `sort:` | `updated`, `created`, `title` | `updated` |
| `folder:` | A folder name; quote names with spaces | All folders |
| `limit:` | A number up to 500 | 50 |

A note never lists itself. When a query shows tasks, ticking one in the list ticks it in the note it lives in.

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
