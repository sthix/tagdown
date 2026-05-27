# Inline Hashtags & Nested Tag Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create tags by typing `#hashtag` (including nested `#notes/chemistry`) directly in a note body, and display all tags as a nested tree in the left sidebar that filters the note list.

**Architecture:** Tags are derived from the note body on save (mirroring how the title is already derived) and written to frontmatter, which stays the persisted source of truth. The frontend builds a nested tree from tag paths (split on `/`) reusing the existing folder-tree mechanics, and renders inline hashtag pills in the preview via a text-node walk over the parser's HTML output.

**Tech Stack:** Tauri v2, Rust (vault/frontmatter), Vanilla TypeScript + Vite (UI), the existing `tagdown` HTML parser.

**Working directory for all paths:** `tagdown-editor/`

**Validation commands (run from `tagdown-editor/`):**
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`
- Rust check: `cargo check --manifest-path src-tauri/Cargo.toml`
- Frontend build: `npm run build`

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src-tauri/src/frontmatter.rs` | Modify | Add `derive_tags`; unit tests |
| `src-tauri/src/vault.rs` | Modify | Call `derive_tags` in `save_note` / `create_note` |
| `src-tauri/src/commands/tags.rs` | Modify | Allow `/` in `slugify` for nested manual tags |
| `src/main.ts` | Modify | `selectedTag` state, tag tree render, tag filtering, pill click wiring |
| `src/tagdown/renderer.ts` | Modify | Convert `#hashtag` text nodes to pills |
| `src/styles/sidebar.css` | Modify | `.tag-tree-item` + disclosure styling |
| `src/styles/preview.css` | Modify | `.td-tag` pill styling |

---

## Task 1: `derive_tags` in Rust

**Files:**
- Modify: `src-tauri/src/frontmatter.rs`

A hand-rolled scan (no `regex` dependency). A tag is a `#` that is at the start
of the string or preceded by whitespace, immediately followed by an
alphanumeric/`_` char, then a run of `[A-Za-z0-9_/-]`. Normalize each match by
trimming `/`, collapsing repeated `/`, dropping empty segments; de-duplicate
preserving first-seen order.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module at the bottom of `src-tauri/src/frontmatter.rs`:

```rust
    #[test]
    fn derive_tags_basic_and_nested() {
        let body = "Notes about #chemistry and #notes/organic stuff.";
        assert_eq!(derive_tags(body), vec!["chemistry", "notes/organic"]);
    }

    #[test]
    fn derive_tags_excludes_headings_and_midword() {
        // '# ' is a heading (space after #), 'foo#bar' has no boundary before #
        let body = "# Heading\n## Sub\nfoo#bar baz";
        assert_eq!(derive_tags(body), Vec::<String>::new());
    }

    #[test]
    fn derive_tags_stops_at_punctuation() {
        let body = "End of sentence #tag. Next #other!";
        assert_eq!(derive_tags(body), vec!["tag", "other"]);
    }

    #[test]
    fn derive_tags_dedup_and_normalizes_slashes() {
        let body = "#a//b/ then #a/b again and #a/b/";
        assert_eq!(derive_tags(body), vec!["a/b"]);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml derive_tags`
Expected: FAIL — `cannot find functionderive_tags in this scope`.

- [ ] **Step 3: Implement `derive_tags`**

Add this function to `src-tauri/src/frontmatter.rs` (e.g. just after
`derive_title`):

```rust
pub fn derive_tags(content: &str) -> Vec<String> {
    fn is_tag_char(c: char) -> bool {
        c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '/'
    }

    let chars: Vec<char> = content.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '#' {
            let boundary_ok = i == 0 || chars[i - 1].is_whitespace();
            let next_ok = chars
                .get(i + 1)
                .is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_');
            if boundary_ok && next_ok {
                let mut j = i + 1;
                while j < chars.len() && is_tag_char(chars[j]) {
                    j += 1;
                }
                let raw: String = chars[i + 1..j].iter().collect();
                let normalized = raw
                    .split('/')
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("/");
                if !normalized.is_empty() && !out.contains(&normalized) {
                    out.push(normalized);
                }
                i = j;
                continue;
            }
        }
        i += 1;
    }
    out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml derive_tags`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/frontmatter.rs
git commit -m "feat: derive hashtags from note body"
```

---

## Task 2: Persist derived tags on save

**Files:**
- Modify: `src-tauri/src/vault.rs`

`save_note` currently re-derives the title but leaves `meta.tags` untouched.
Derive tags from the body and replace `meta.tags`. Also derive in `create_note`
for consistency.

- [ ] **Step 1: Write the failing test**

Add to a `tests` module at the bottom of `src-tauri/src/vault.rs`. If no
`tests` module exists yet, create one:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn save_note_derives_tags_from_body() {
        let dir = env::temp_dir().join(format!("tagdown-test-{}", Uuid::new_v4()));
        let vault = Vault::open_or_create(dir.clone()).unwrap();
        let note = vault.create_note(None).unwrap();
        let saved = vault
            .save_note(&note.id, "# Title\n\nText with #notes/chemistry and #physics".into())
            .unwrap();
        assert_eq!(saved.tags, vec!["notes/chemistry", "physics"]);
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml save_note_derives_tags`
Expected: FAIL — assertion fails, `saved.tags` is empty.

- [ ] **Step 3: Implement**

In `src-tauri/src/vault.rs`, import `derive_tags`. Change the existing
`frontmatter` use line:

```rust
use crate::{
    frontmatter::{derive_preview, derive_tags, derive_title, split_frontmatter, word_count, write_frontmatter},
    models::{FolderRecord, Note, NoteContent, NoteFrontmatter, SortOrder, VaultMeta},
};
```

In `save_note`, after the `meta.title = derive_title(&content);` line add:

```rust
        meta.tags = derive_tags(&content);
```

In `create_note`, replace the `tags: Vec::new(),` field with:

```rust
            tags: derive_tags(content),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all tests, including the new one and the existing frontmatter test).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/vault.rs
git commit -m "feat: persist body-derived tags to frontmatter on save"
```

---

## Task 3: Allow nested manual tags

**Files:**
- Modify: `src-tauri/src/commands/tags.rs`

`slugify` maps `/` to `-`, preventing nested manual tags. Allow `/` so manual
tags slot into the same tree as inline ones.

- [ ] **Step 1: Write the failing test**

Add a `tests` module at the bottom of `src-tauri/src/commands/tags.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_keeps_nested_paths() {
        assert_eq!(slugify("Notes/Chemistry"), "notes/chemistry");
        assert_eq!(slugify("Hello World"), "hello-world");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slugify_keeps_nested`
Expected: FAIL — got `notes-chemistry`, expected `notes/chemistry`.

- [ ] **Step 3: Implement**

In `slugify`, update the char-mapping closure to preserve `/`:

```rust
        .map(|c| if c.is_ascii_alphanumeric() || c == '/' { c } else { '-' })
```

The existing dash-collapsing loop already handles runs of `-`; `/` passes
through untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slugify_keeps_nested`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/tags.rs
git commit -m "feat: allow nested slugs for manual tags"
```

---

## Task 4: Inline hashtag pills in preview

**Files:**
- Modify: `src/tagdown/renderer.ts`
- Modify: `src/styles/preview.css`

`renderPreview` currently returns `tagdown(source)` directly. Parse to HTML,
then walk text nodes (skipping `code`, `pre`, `a` ancestors) replacing
`#hashtag` with a pill span. This task has no automated test (DOM string
transform); verify via `npm run build` and manual QA in Task 6.

- [ ] **Step 1: Implement the renderer transform**

Replace the entire contents of `src/tagdown/renderer.ts` with:

```ts
import { tagdown } from './parser.js';

const TAG_RE = /(^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;
const SKIP_ANCESTORS = new Set(['CODE', 'PRE', 'A']);

function hasSkippedAncestor(node: Node): boolean {
  let el = node.parentElement;
  while (el) {
    if (SKIP_ANCESTORS.has(el.tagName)) return true;
    el = el.parentElement;
  }
  return false;
}

function normalizeTag(raw: string): string {
  return raw.split('/').filter(Boolean).join('/');
}

export function renderPreview(source: string): string {
  const host = document.createElement('div');
  host.innerHTML = tagdown(source);

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    if (!hasSkippedAncestor(text) && /(^|\s)#[A-Za-z0-9_]/.test(text.data)) {
      targets.push(text);
    }
    current = walker.nextNode();
  }

  for (const text of targets) {
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    const data = text.data;
    TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_RE.exec(data)) !== null) {
      const [whole, lead, body] = match;
      const start = match.index + lead.length;
      if (start > lastIndex) frag.append(data.slice(lastIndex, start));
      const tag = normalizeTag(body);
      const span = document.createElement('span');
      span.className = 'td-tag';
      span.dataset.tag = tag;
      span.textContent = `#${tag}`;
      frag.append(span);
      lastIndex = match.index + whole.length;
    }
    if (lastIndex < data.length) frag.append(data.slice(lastIndex));
    text.replaceWith(frag);
  }

  return host.innerHTML;
}
```

- [ ] **Step 2: Add pill styling**

Append to `src/styles/preview.css`:

```css
.td-tag {
  display: inline-block;
  padding: 0 6px;
  border-radius: 6px;
  font-family: var(--font-sans, inherit);
  font-size: 0.85em;
  font-weight: 600;
  color: var(--accent);
  background: var(--hover-overlay);
  cursor: pointer;
  white-space: nowrap;
}
.td-tag:hover { background: var(--line-strong); }
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: PASS (`tsc` + `vite build` succeed, no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/tagdown/renderer.ts src/styles/preview.css
git commit -m "feat: render inline hashtag pills in preview"
```

---

## Task 5: Nested tag tree + filtering in sidebar

**Files:**
- Modify: `src/main.ts`
- Modify: `src/styles/sidebar.css`

Replace the flat `renderTags` with a nested tree, add `selectedTag` filtering
(mutually exclusive with `selectedFolder`), and wire pill clicks. No automated
test (UI wiring); verify via `npm run build` and manual QA in Task 6.

- [ ] **Step 1: Add state and tag-tree helpers**

In `src/main.ts`, add to the state block (near `let selectedFolder` ~line 74):

```ts
let selectedTag: string | null = null;
let expandedTags: Record<string, boolean> = {};
```

Add these helper functions (place them just above `function renderTags()`):

```ts
type TagNode = { path: string; name: string; children: TagNode[]; hasRecord: boolean };

function noteTagPaths(): string[] {
  const set = new Set<string>();
  for (const note of notes) {
    if (note.folderId === 'archive') continue;
    for (const t of note.tags) set.add(t);
  }
  return [...set];
}

function buildTagTree(): TagNode[] {
  const recordNames = new Set(tags.map((t) => t.name));
  const paths = new Set<string>([...noteTagPaths(), ...recordNames]);
  // ensure every ancestor path exists as a node
  for (const p of [...paths]) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  }
  const nodes = new Map<string, TagNode>();
  for (const p of paths) {
    const name = p.split('/').pop()!;
    nodes.set(p, { path: p, name, children: [], hasRecord: recordNames.has(p) });
  }
  const roots: TagNode[] = [];
  for (const node of nodes.values()) {
    const idx = node.path.lastIndexOf('/');
    if (idx < 0) roots.push(node);
    else nodes.get(node.path.slice(0, idx))!.children.push(node);
  }
  const sortRec = (list: TagNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function tagCount(path: string): number {
  return notes.filter(
    (note) =>
      note.folderId !== 'archive' &&
      note.tags.some((t) => t === path || t.startsWith(`${path}/`)),
  ).length;
}

function colorForTag(path: string) {
  const record = tags.find((t) => t.name === path);
  return record ? (TAG_COLORS[record.color] ?? TAG_COLORS.slate) : TAG_COLORS.slate;
}

async function selectTag(path: string) {
  selectedTag = path;
  selectedFolder = null;
  const all = await invoke<Note[]>('list_notes', { folderId: null, sort: 'updatedDesc' satisfies SortOrder });
  notes = all.filter(
    (note) =>
      note.folderId !== 'archive' &&
      note.tags.some((t) => t === path || t.startsWith(`${path}/`)),
  );
  if (selectedNote && !notes.some((n) => n.id === selectedNote!.id)) {
    selectedNote = null;
    content = '';
    documentTitleEl.textContent = 'Tagdown Editor';
    renderEditor();
  }
  noteListTitleEl.textContent = `#${path}`;
  scopeIconEl.textContent = '#';
  renderFolders();
  renderNotes();
}
```

- [ ] **Step 2: Replace `renderTags` body**

Replace the entire `function renderTags() { ... }` with the version below. It
keeps the existing create-card / swatch / input logic verbatim and swaps the
flat `rows` for a recursive tree render:

```ts
function renderTags() {
  const roots = buildTagTree();
  const totalNodes = (() => {
    let n = 0;
    const count = (list: TagNode[]) => { list.forEach((node) => { n++; count(node.children); }); };
    count(roots);
    return n;
  })();
  tagCountEl.textContent = String(totalNodes);

  const swatchRow = TAG_COLOR_KEYS.map((key) => {
    const c = TAG_COLORS[key];
    const selected = key === tagDraftColor;
    return `<button type="button" class="tag-swatch ${selected ? 'selected' : ''}" data-tag-color="${key}" title="${key}" aria-label="${key}" style="--swatch:${c.dot}"></button>`;
  }).join('');

  const createCard = creatingTag ? `
    <div class="tag-create-card">
      <div class="tag-create-row">
        <span class="tag-dot" id="tag-create-dot" style="background:${TAG_COLORS[tagDraftColor].dot}"></span>
        <input id="tag-create-input" placeholder="Tag name" autocomplete="off" spellcheck="false" aria-label="Tag name" />
      </div>
      <div class="tag-swatch-row">
        ${swatchRow}
        <span class="tag-create-hint">↵ to save · esc to cancel</span>
      </div>
    </div>
  ` : '';

  const rowInset = (depth: number) => 8 + depth * 14;
  const renderTagRow = (node: TagNode, depth: number): string => {
    const count = tagCount(node.path);
    const isExpanded = expandedTags[node.path] ?? node.children.length > 0;
    expandedTags[node.path] = isExpanded;
    const selected = node.path === selectedTag;
    const c = colorForTag(node.path);
    const deletable = node.hasRecord && count === 0;
    return `
      <div class="tag-tree-item">
        <div class="tag-row ${selected ? 'selected' : ''}" data-tag-path="${escapeHtml(node.path)}" style="padding-left: ${rowInset(depth)}px">
          <span class="tag-disclosure ${isExpanded ? 'open' : ''} ${node.children.length ? '' : 'is-empty'}" data-toggle-tag="${escapeHtml(node.path)}" aria-hidden="true">${iconSvg('chevron', 10)}</span>
          <span class="tag-dot" style="background:${c.dot}"></span>
          <span class="tag-name">${escapeHtml(node.name)}</span>
          <span class="tag-count">${count}</span>
          ${deletable ? `<button class="tag-delete" data-delete-tag-name="${escapeHtml(node.path)}" type="button" title="Delete tag" aria-label="Delete tag">×</button>` : ''}
        </div>
        ${isExpanded ? node.children.map((child) => renderTagRow(child, depth + 1)).join('') : ''}
      </div>
    `;
  };

  const rows = roots.map((node) => renderTagRow(node, 0)).join('');
  const empty = !creatingTag && totalNodes === 0
    ? '<div class="tag-empty">Type <kbd>#tag</kbd> in a note, or press <kbd>+</kbd>.</div>'
    : '';

  tagEl.innerHTML = createCard + rows + empty;

  tagEl.querySelectorAll<HTMLElement>('.tag-row').forEach((row) => {
    row.addEventListener('click', () => selectTag(row.dataset.tagPath!));
  });
  tagEl.querySelectorAll<HTMLElement>('[data-toggle-tag]').forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const path = toggle.dataset.toggleTag!;
      expandedTags[path] = !expandedTags[path];
      renderTags();
    });
  });
  tagEl.querySelectorAll<HTMLButtonElement>('[data-delete-tag-name]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const path = button.dataset.deleteTagName!;
      const record = tags.find((t) => t.name === path);
      if (record) await deleteTag(record.id);
    });
  });
  tagEl.querySelectorAll<HTMLButtonElement>('[data-tag-color]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      tagDraftColor = button.dataset.tagColor as TagColorKey;
      const dot = document.querySelector<HTMLSpanElement>('#tag-create-dot');
      if (dot) dot.style.background = TAG_COLORS[tagDraftColor].dot;
      tagEl.querySelectorAll<HTMLElement>('[data-tag-color]').forEach((b) => {
        b.classList.toggle('selected', b.dataset.tagColor === tagDraftColor);
      });
    });
  });
  const input = document.querySelector<HTMLInputElement>('#tag-create-input');
  if (input) {
    requestAnimationFrame(() => input.focus());
    let committed = false;
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        committed = true;
        await commitTagCreate(input.value, tagDraftColor);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        committed = true;
        creatingTag = false;
        renderTags();
      }
    });
    input.addEventListener('blur', async () => {
      if (committed) return;
      committed = true;
      await commitTagCreate(input.value, tagDraftColor);
    });
  }
}
```

- [ ] **Step 3: Clear `selectedTag` when a folder is chosen**

In `renderFolders`, the folder `click` handler currently sets `selectedFolder`.
Update it to also clear the tag selection. Replace:

```ts
    button.addEventListener('click', async () => {
      selectedFolder = button.dataset.folder || null;
      await reloadNotes();
    });
```

with:

```ts
    button.addEventListener('click', async () => {
      selectedFolder = button.dataset.folder || null;
      selectedTag = null;
      await reloadNotes();
    });
```

- [ ] **Step 4: Wire pill clicks in the preview**

In `renderEditor`, the `source` input listener re-renders the live preview.
After the existing `editorRoot.querySelectorAll<...>('[data-insert], [data-wrap]')`
binding block, add delegation for pills (works for both initial render and live
updates since it is bound to the container):

```ts
  editorRoot.querySelector<HTMLDivElement>('.preview')?.addEventListener('click', (event) => {
    const pill = (event.target as HTMLElement).closest<HTMLElement>('.td-tag');
    if (pill?.dataset.tag) selectTag(pill.dataset.tag);
  });
```

- [ ] **Step 5: Add sidebar tree styling**

Append to `src/styles/sidebar.css`:

```css
.tag-tree-item { display: block; }
.tag-row { cursor: pointer; }
.tag-row.selected { background: var(--selected-overlay, var(--hover-overlay)); }
.tag-disclosure {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  margin-right: 2px;
  color: var(--text-muted);
  transition: transform 0.12s ease;
}
.tag-disclosure .folder-svg { width: 10px; height: 10px; }
.tag-disclosure.open { transform: rotate(90deg); }
.tag-disclosure.is-empty { visibility: hidden; }
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: PASS — no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/styles/sidebar.css
git commit -m "feat: nested tag tree sidebar with tag filtering"
```

---

## Task 6: Full validation & manual QA

**Files:** none (verification only)

- [ ] **Step 1: Run the full Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (frontmatter, vault, tags tests).

- [ ] **Step 2: Run cargo check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS, no warnings about unused `derive_tags`.

- [ ] **Step 3: Build the frontend**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual QA in the running app**

Run: `npm run tauri:dev`, then verify:
- Type `#notes/chemistry` and `#physics` in a note body; wait for autosave.
- The note card shows `notes/chemistry` / `physics` chips.
- Sidebar Tags section shows a `notes` parent with a `chemistry` child, and a
  `physics` row; the `notes` count includes the chemistry note.
- Collapsing/expanding the `notes` disclosure works.
- Clicking `notes` filters the list to descendant-tagged notes; the header
  reads `#notes`.
- Clicking a folder or "All Notes" clears the tag filter.
- In preview, `#notes/chemistry` renders as a pill; clicking it filters the list.
- A `# Heading` line does NOT create a tag.
- Manual "+" tag creation still works and a nested manual name (e.g.
  `work/admin`) appears in the tree.

- [ ] **Step 5: Final commit (if any QA fixes were needed)**

```bash
git add -A
git commit -m "fix: address hashtag QA findings"
```

---

## Self-Review Notes

- **Spec coverage:** create tags via `#word` (Tasks 1–2), nested `#a/b`
  (Tasks 1, 5), sidebar display (Task 5), nested folder-like structure
  (Task 5 tree + disclosure), coexist with manual tags (Tasks 3, 5
  union + colors), keep inline + pills (Task 4), all-descendants filtering
  (Task 5 `tagCount`/`selectTag`). All covered.
- **Type consistency:** `selectedTag`/`expandedTags`, `TagNode`,
  `buildTagTree`, `tagCount`, `colorForTag`, `selectTag` referenced
  consistently across Task 5 steps; `derive_tags` signature identical in
  Tasks 1–2.
- **Note:** `escapeHtml`, `iconSvg`, `TAG_COLORS`, `TAG_COLOR_KEYS`,
  `commitTagCreate`, `deleteTag` already exist in `main.ts` and are reused.
