// Wikilinks: `[[Title]]`, `[[Title#Heading]]`, `[[Title|label]]`, and block
// references `[[Title#^id]]` (embedded with `![[Title#^id]]`).
//
// A link points at a note by title, compared case-insensitively, or, the way
// Obsidian writes them, by the note's file: `[[blog/post]]` or `[[post]]` (see
// `LinkTargets`). Links inside fenced code blocks and inline code are text,
// not links.
//
// A block is addressed by a plain-text marker at the end of its line, the way
// Obsidian writes them: `Some paragraph ^ab12cd`, `- [ ] a task ^ab12cd`. The
// marker travels with the text, so the id survives edits and moves.

use std::collections::HashMap;

use serde::Serialize;

use crate::models::Note;

/// Context lines kept per linking note.
const MENTIONS_PER_NOTE: usize = 3;
/// Lines nested under a linking line kept with its mention.
const MENTION_CHILD_LINES: usize = 12;

#[derive(Debug, Clone, PartialEq)]
pub struct Wikilink {
    /// Byte range of the whole `[[...]]` in the content.
    pub start: usize,
    pub end: usize,
    pub target: String,
    pub anchor: Option<String>,
    pub label: Option<String>,
}

impl Wikilink {
    /// The block id of a `[[Title#^id]]` link.
    pub fn block_id(&self) -> Option<&str> {
        self.anchor.as_deref().and_then(|a| a.strip_prefix('^')).filter(|id| is_block_id(id))
    }
}

/// A block found by its `^id` marker.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub id: String,
    /// Line range `[start, end)` in the content.
    pub start_line: usize,
    pub end_line: usize,
    /// The block's source, dedented, with its own `^id` marker removed.
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub note: Note,
    /// Source lines that contain the link, list and heading markers removed.
    pub mentions: Vec<String>,
}

pub fn normalize_title(title: &str) -> String {
    title.trim().to_lowercase()
}

/// A note path or a link target naming one, as compared: lowercase,
/// `/`-separated, without `.md` or a leading `./` or `/`.
pub fn normalize_path(path: &str) -> String {
    let path = path.trim().replace('\\', "/").to_lowercase();
    let path = path.trim_start_matches("./").trim_start_matches('/');
    path.strip_suffix(".md").unwrap_or(path).to_string()
}

/// Which notes a link target names. A target names the notes with that title
/// first; failing that, the note whose path in the vault it is (`[[blog/post]]`
/// for `blog/post.md`); failing that, the one note whose path ends in it
/// (`[[post]]`, `[[sub/post]]`). A file name two notes share names neither.
#[derive(Debug, Default)]
pub struct LinkTargets {
    by_title: HashMap<String, Vec<String>>,
    by_path: HashMap<String, String>,
    /// Paths and ids by the last segment of the path.
    by_name: HashMap<String, Vec<(String, String)>>,
}

impl LinkTargets {
    pub fn new<'a>(notes: impl IntoIterator<Item = &'a Note>) -> Self {
        let mut targets = Self::default();
        for note in notes {
            targets.by_title.entry(normalize_title(&note.title)).or_default().push(note.id.clone());
            let path = normalize_path(&note.path);
            if path.is_empty() {
                continue;
            }
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            targets.by_name.entry(name).or_default().push((path.clone(), note.id.clone()));
            targets.by_path.insert(path, note.id.clone());
        }
        targets
    }

    /// Ids of the notes `target` names (several when they share its title).
    pub fn resolve(&self, target: &str) -> Vec<&str> {
        match self.by_title.get(&normalize_title(target)) {
            Some(ids) => ids.iter().map(String::as_str).collect(),
            None => self.by_file(target).into_iter().collect(),
        }
    }

    pub fn links_to(&self, target: &str, id: &str) -> bool {
        self.resolve(target).contains(&id)
    }

    /// The note `target` names by its file, titles aside.
    pub fn by_file(&self, target: &str) -> Option<&str> {
        let path = normalize_path(target);
        if path.is_empty() {
            return None;
        }
        if let Some(id) = self.by_path.get(&path) {
            return Some(id);
        }
        let name = path.rsplit('/').next().unwrap_or(&path);
        let suffix = format!("/{path}");
        let mut found = self.by_name.get(name)?.iter().filter(|(p, _)| p.ends_with(&suffix));
        match (found.next(), found.next()) {
            (Some((_, id)), None) => Some(id),
            _ => None,
        }
    }
}

/// Every wikilink in `content`, skipping code.
pub fn parse_wikilinks(content: &str) -> Vec<Wikilink> {
    let mut links = Vec::new();
    let mut in_fence: Option<&str> = None;
    let mut offset = 0;
    for line in content.split_inclusive('\n') {
        let line_start = offset;
        offset += line.len();
        let trimmed = line.trim_start();
        let fence = ["```", "~~~"].into_iter().find(|f| trimmed.starts_with(f));
        match (in_fence, fence) {
            (None, Some(f)) => { in_fence = Some(f); continue; }
            (Some(open), Some(f)) if open == f => { in_fence = None; continue; }
            (Some(_), _) => continue,
            _ => {}
        }
        links.extend(line_wikilinks(line, line_start));
    }
    links
}

fn line_wikilinks(line: &str, base: usize) -> Vec<Wikilink> {
    let bytes = line.as_bytes();
    let mut links = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            // Skip inline code spans.
            b'`' => {
                let ticks = bytes[i..].iter().take_while(|&&b| b == b'`').count();
                let fence = &line[i..i + ticks];
                i = line[i + ticks..].find(fence).map_or(i + ticks, |close| i + ticks + close + ticks);
            }
            b'[' if bytes.get(i + 1) == Some(&b'[') => {
                let inner_start = i + 2;
                let Some(close) = line[inner_start..].find("]]") else { break };
                let inner = &line[inner_start..inner_start + close];
                let end = inner_start + close + 2;
                if !inner.contains(['[', ']', '\n']) {
                    let (target_part, label) = match inner.split_once('|') {
                        Some((t, l)) => (t, Some(l.trim().to_string()).filter(|l| !l.is_empty())),
                        None => (inner, None),
                    };
                    let (target, anchor) = match target_part.split_once('#') {
                        Some((t, a)) => (t.trim(), Some(a.trim().to_string()).filter(|a| !a.is_empty())),
                        None => (target_part.trim(), None),
                    };
                    if !target.is_empty() {
                        links.push(Wikilink { start: base + i, end: base + end, target: target.to_string(), anchor, label });
                    }
                }
                i = end;
            }
            _ => i += 1,
        }
    }
    links
}

/// `content` with links to `old_title` pointed at `new_title`, keeping their
/// anchors and labels; `None` when nothing links to `old_title`. Links whose
/// target `keep` accepts are left alone: a link naming the note by its file
/// (`[[my-note]]` for `my-note.md`) still finds it after the rename, and
/// rewriting it would break it in other apps that read the vault.
pub fn rename_links(content: &str, old_title: &str, new_title: &str, keep: &dyn Fn(&str) -> bool) -> Option<String> {
    let old = normalize_title(old_title);
    let links: Vec<Wikilink> = parse_wikilinks(content)
        .into_iter()
        .filter(|l| normalize_title(&l.target) == old && !keep(&l.target))
        .collect();
    if links.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(content.len());
    let mut at = 0;
    for link in links {
        out.push_str(&content[at..link.start]);
        out.push_str("[[");
        out.push_str(new_title.trim());
        if let Some(anchor) = &link.anchor {
            out.push('#');
            out.push_str(anchor);
        }
        if let Some(label) = &link.label {
            out.push('|');
            out.push_str(label);
        }
        out.push_str("]]");
        at = link.end;
    }
    out.push_str(&content[at..]);
    Some(out)
}

fn is_block_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// The `^id` marker ending `line` (after whitespace), and the byte where the
/// whitespace before it starts.
pub fn block_marker(line: &str) -> Option<(&str, usize)> {
    let trimmed = line.trim_end();
    let caret = trimmed.rfind('^')?;
    let id = &trimmed[caret + 1..];
    if !is_block_id(id) {
        return None;
    }
    let before = &trimmed[..caret];
    if caret > 0 && !before.ends_with([' ', '\t']) {
        return None;
    }
    Some((id, before.trim_end().len()))
}

fn is_list_item(line: &str) -> bool {
    let rest = line.trim_start();
    if ["- ", "* ", "+ "].iter().any(|m| rest.starts_with(m)) {
        return true;
    }
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    digits > 0 && (rest[digits..].starts_with(". ") || rest[digits..].starts_with(") "))
}

fn is_heading(line: &str) -> bool {
    let hashes = line.chars().take_while(|c| *c == '#').count();
    (1..=6).contains(&hashes) && line[hashes..].starts_with(' ')
}

/// A line that ends a paragraph above it, or isn't paragraph text at all.
fn breaks_paragraph(line: &str) -> bool {
    let t = line.trim_start();
    t.is_empty() || is_heading(line) || is_list_item(line) || line.starts_with([' ', '\t'])
        || ["```", "~~~", ":::", "$$", "|", "<", "---"].iter().any(|p| t.starts_with(p))
}

/// The block in `content` marked `^id` (compared case-insensitively), outside
/// code fences. A list item or task brings the lines nested under it; a
/// paragraph is the run of text lines ending in the marker; a heading is its
/// line. A marker on a line of its own names the block above it (a table,
/// callout, code block, quote or list), as in Obsidian.
pub fn find_block(content: &str, id: &str) -> Option<Block> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut in_fence: Option<(&str, usize)> = None;
    // Closing fence line -> its opening line.
    let mut fences = HashMap::new();
    let mut at = None;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        let fence = ["```", "~~~"].into_iter().find(|f| trimmed.starts_with(f));
        match (in_fence, fence) {
            (None, Some(f)) => { in_fence = Some((f, i)); continue; }
            (Some((open, from)), Some(f)) if open == f => { fences.insert(i, from); in_fence = None; continue; }
            (Some(_), _) => continue,
            _ => {}
        }
        if block_marker(line).is_some_and(|(found, _)| found.eq_ignore_ascii_case(id)) {
            at = Some(i);
            break;
        }
    }
    let at = at?;
    let line = lines[at];
    let (found, cut) = block_marker(line)?;
    if cut == 0 {
        let last = (0..at).rev().find(|&i| !lines[i].trim().is_empty())?;
        let start = block_start(&lines, last, &fences);
        return Some(Block { id: found.to_string(), start_line: start, end_line: at + 1, text: dedent(&lines[start..=last]) });
    }
    let (start, end) = if is_list_item(line) {
        let depth = indent_width(line);
        let children = lines[at + 1..]
            .iter()
            .take_while(|l| !l.trim().is_empty() && indent_width(l) > depth)
            .count();
        (at, at + 1 + children)
    } else if is_heading(line) || breaks_paragraph(line) {
        (at, at + 1)
    } else {
        let mut start = at;
        while start > 0 && !breaks_paragraph(lines[start - 1]) {
            start -= 1;
        }
        (start, at + 1)
    };
    let mut block_lines = lines[start..end].to_vec();
    block_lines[at - start] = &line[..cut];
    Some(Block { id: found.to_string(), start_line: start, end_line: end, text: dedent(&block_lines) })
}

/// First line of the block that ends on line `last`.
fn block_start(lines: &[&str], last: usize, fences: &HashMap<usize, usize>) -> usize {
    if let Some(&open) = fences.get(&last) {
        return open;
    }
    let t = lines[last].trim();
    let up_to = |found: &dyn Fn(&str) -> bool| (0..last).rev().find(|&i| found(lines[i].trim())).unwrap_or(last);
    let walk_up = |keep: &dyn Fn(&str) -> bool| {
        let mut start = last;
        while start > 0 && keep(lines[start - 1]) {
            start -= 1;
        }
        start
    };
    if t == ":::" {
        return up_to(&|l| l.starts_with(":::") && l.len() > 3);
    }
    if t == "$$" {
        return up_to(&|l| l.starts_with("$$"));
    }
    if let Some(name) = t.strip_prefix("</").and_then(|r| r.strip_suffix('>')).map(str::trim).filter(|n| !n.is_empty()) {
        // Walk up to the tag that opens this one, counting nested pairs.
        let mut depth = 0i32;
        for i in (0..=last).rev() {
            depth += count_tags(lines[i], name, true) - count_tags(lines[i], name, false);
            if depth <= 0 {
                return i;
            }
        }
        return last;
    }
    if t.starts_with('|') {
        return walk_up(&|l| l.trim_start().starts_with('|'));
    }
    if t.starts_with('>') {
        return walk_up(&|l| l.trim_start().starts_with('>'));
    }
    if is_list_item(lines[last]) || lines[last].starts_with([' ', '\t']) {
        return walk_up(&|l| !l.trim().is_empty() && !is_heading(l) && !l.trim_start().starts_with("```") && !l.trim_start().starts_with("~~~"));
    }
    if is_heading(lines[last]) {
        return last;
    }
    walk_up(&|l| !breaks_paragraph(l))
}

/// How often `line` closes (`</name>`) or opens (`<name …>`, not self-closing) the tag `name`.
fn count_tags(line: &str, name: &str, closing: bool) -> i32 {
    let lower = line.to_lowercase();
    let name = name.to_lowercase();
    let prefix = if closing { format!("</{name}") } else { format!("<{name}") };
    let mut count = 0;
    let mut from = 0;
    while let Some(i) = lower[from..].find(&prefix) {
        let after = from + i + prefix.len();
        let rest = &lower[after..];
        let boundary = rest.starts_with(['>', ' ', '\t']) || rest.is_empty();
        let self_closing = !closing && rest.split('>').next().is_some_and(|attrs| attrs.trim_end().ends_with('/'));
        if boundary && !self_closing {
            count += 1;
        }
        from = after;
    }
    count
}

/// `lines` joined, tabs as two spaces, without the first line's indent.
fn dedent(lines: &[&str]) -> String {
    let depth = lines.first().map_or(0, |l| indent_width(l));
    lines
        .iter()
        .map(|l| {
            let l = l.replace('\t', "  ");
            let skip = l.len() - l.trim_start_matches(' ').len();
            l[skip.min(depth)..].to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The note `target` names among `notes` and its block `^id`. Archived notes
/// are left out.
pub fn resolve_block(notes: Vec<(Note, String)>, target: &str, id: &str) -> Option<(Note, Block)> {
    let live: Vec<(Note, String)> = notes.into_iter().filter(|(note, _)| is_live(note)).collect();
    let targets = LinkTargets::new(live.iter().map(|(note, _)| note));
    let wanted: Vec<String> = targets.resolve(target).into_iter().map(str::to_string).collect();
    live.into_iter()
        .filter(|(note, _)| wanted.contains(&note.id))
        .find_map(|(note, content)| find_block(&content, id).map(|block| (note, block)))
}

fn is_live(note: &Note) -> bool {
    note.folder_id.as_deref() != Some("archive")
}

/// Notes in `notes` that link to the note `id`, most recently edited first.
/// Archived notes are left out.
pub fn backlinks(notes: Vec<(Note, String)>, id: &str) -> Vec<Backlink> {
    if !notes.iter().any(|(note, _)| note.id == id) {
        return Vec::new();
    }
    let targets = LinkTargets::new(notes.iter().map(|(note, _)| note).filter(|note| is_live(note) || note.id == id));
    let links_here = |target: &str| targets.links_to(target, id);
    let mut backlinks: Vec<Backlink> = notes
        .iter()
        .filter(|(note, _)| note.id != id && is_live(note))
        .filter_map(|(note, content)| {
            let mut mentions = property_mentions(note, &links_here);
            mentions.extend(self::mentions(content, &links_here));
            mentions.truncate(MENTIONS_PER_NOTE);
            (!mentions.is_empty()).then(|| Backlink { note: note.clone(), mentions })
        })
        .collect();
    backlinks.sort_by(|a, b| b.note.updated_at.cmp(&a.note.updated_at));
    backlinks
}

/// The note's properties with a link whose target `wanted` accepts, as
/// `key: value` lines.
pub fn property_mentions(note: &Note, wanted: &dyn Fn(&str) -> bool) -> Vec<String> {
    note.properties
        .iter()
        .filter(|p| p.value.texts().iter().any(|t| parse_wikilinks(t).iter().any(|l| wanted(&l.target))))
        .map(|p| format!("{}: {}", p.key, p.value.display()))
        .collect()
}

/// Source lines of `content` with a link whose target `wanted` accepts, each
/// with the lines indented under it (tasks nested under a link, say),
/// re-indented two spaces under the linking line.
pub fn mentions(content: &str, wanted: &dyn Fn(&str) -> bool) -> Vec<String> {
    let mut mentions: Vec<String> = Vec::new();
    // Links before this byte were already shown, on a linking line or nested under one.
    let mut covered = 0;
    for link in parse_wikilinks(content).into_iter().filter(|l| wanted(&l.target)) {
        if link.start < covered {
            continue;
        }
        let line_start = content[..link.start].rfind('\n').map_or(0, |i| i + 1);
        let line_end = content[link.end..].find('\n').map_or(content.len(), |i| link.end + i);
        let line = &content[line_start..line_end];
        let mut mention = strip_line_marker(line).to_string();
        covered = line_end;
        let children = nested_lines(&content[line_end..], indent_width(line));
        if let Some(min) = children.iter().map(|child| indent_width(child)).min() {
            for child in &children {
                mention.push_str("\n  ");
                mention.push_str(&child.replace('\t', "  ")[min..]);
            }
            covered += children.iter().map(|child| child.len() + 1).sum::<usize>();
        }
        mentions.push(mention);
        if mentions.len() == MENTIONS_PER_NOTE {
            break;
        }
    }
    mentions
}

/// Lines nested under a line indented `depth` columns, from `rest` (which
/// starts at that line's newline): the following lines indented deeper, up to
/// a blank line.
fn nested_lines(rest: &str, depth: usize) -> Vec<&str> {
    rest.split('\n')
        .skip(1)
        .take_while(|line| !line.trim().is_empty() && indent_width(line) > depth)
        .take(MENTION_CHILD_LINES)
        .collect()
}

fn indent_width(line: &str) -> usize {
    line.chars().take_while(|c| *c == ' ' || *c == '\t').map(|c| if c == '\t' { 2 } else { 1 }).sum()
}

/// A line without its heading, quote, list, or task marker.
pub(crate) fn strip_line_marker(line: &str) -> &str {
    let mut rest = line.trim();
    rest = rest.trim_start_matches('#').trim_start_matches('>').trim_start();
    for marker in ["- ", "* ", "+ "] {
        if let Some(r) = rest.strip_prefix(marker) {
            rest = r;
            break;
        }
    }
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 {
        if let Some(r) = rest[digits..].strip_prefix(". ").or_else(|| rest[digits..].strip_prefix(") ")) {
            rest = r;
        }
    }
    for task in ["[ ] ", "[x] ", "[X] "] {
        if let Some(r) = rest.strip_prefix(task) {
            rest = r;
            break;
        }
    }
    rest.trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn titled(title: &str) -> impl Fn(&str) -> bool {
        let wanted = normalize_title(title);
        move |target| normalize_title(target) == wanted
    }

    fn note(id: &str, title: &str, path: &str) -> Note {
        Note { id: id.into(), title: title.into(), preview: String::new(), tags: vec![], starred: false, folder_id: None, created_at: Default::default(), updated_at: Default::default(), word_count: 0, journal: None, properties: vec![], path: path.into() }
    }

    #[test]
    fn parses_targets_anchors_and_labels_outside_code() {
        let content = "See [[Alpha]], [[Beta#Setup|the setup]] and `[[Not a link]]`.\n```\n[[Fenced]]\n```\n[[ Gamma | g ]]";
        let links = parse_wikilinks(content);
        let targets: Vec<_> = links.iter().map(|l| (l.target.as_str(), l.anchor.as_deref(), l.label.as_deref())).collect();
        assert_eq!(targets, vec![("Alpha", None, None), ("Beta", Some("Setup"), Some("the setup")), ("Gamma", None, Some("g"))]);
        assert_eq!(&content[links[0].start..links[0].end], "[[Alpha]]");
    }

    #[test]
    fn renames_links_case_insensitively_and_keeps_anchor_and_label() {
        let content = "[[old title]] and [[Old Title#Part|label]] but not [[Older]] or `[[Old Title]]`";
        assert_eq!(
            rename_links(content, "Old Title", "New Title", &|_| false).unwrap(),
            "[[New Title]] and [[New Title#Part|label]] but not [[Older]] or `[[Old Title]]`"
        );
        assert_eq!(rename_links("no links here", "Old Title", "New", &|_| false), None);
    }

    #[test]
    fn block_links_carry_their_id() {
        let links = parse_wikilinks("[[Plan#^ab12cd]] ![[Plan#^x-1|quoted]] [[Plan#Setup]] [[Plan#^]]");
        let ids: Vec<_> = links.iter().map(|l| l.block_id()).collect();
        assert_eq!(ids, vec![Some("ab12cd"), Some("x-1"), None, None]);
        assert_eq!(rename_links("![[Plan#^ab12cd]]", "plan", "Roadmap", &|_| false).unwrap(), "![[Roadmap#^ab12cd]]");
    }

    #[test]
    fn block_markers_need_a_space_before_them() {
        assert_eq!(block_marker("Text ^ab12cd"), Some(("ab12cd", 4)));
        assert_eq!(block_marker("- [ ] task\t^id-2  "), Some(("id-2", 10)));
        assert_eq!(block_marker("^solo"), Some(("solo", 0)));
        assert_eq!(block_marker("x^2"), None);
        assert_eq!(block_marker("2^10 ^"), None);
        assert_eq!(block_marker("a ^b^"), None);
        assert_eq!(block_marker("[[Note#^ab]]"), None);
    }

    #[test]
    fn finds_paragraphs_by_their_last_line() {
        let content = "# Title\n\nFirst line\nsecond line ^para1\n\nOther";
        let block = find_block(content, "PARA1").unwrap();
        assert_eq!(block, Block { id: "para1".into(), start_line: 2, end_line: 4, text: "First line\nsecond line".into() });
        assert_eq!(find_block(content, "nope"), None);
    }

    #[test]
    fn finds_list_items_with_their_children() {
        let content = "- one\n  - [ ] two ^t2\n    - three\n  - four\n- five";
        let block = find_block(content, "t2").unwrap();
        assert_eq!((block.start_line, block.end_line), (1, 3));
        assert_eq!(block.text, "- [ ] two\n  - three");
    }

    #[test]
    fn finds_headings_and_skips_code() {
        let content = "```\nfake ^h1\n```\n## Setup ^h1\nbody";
        let block = find_block(content, "h1").unwrap();
        assert_eq!((block.start_line, block.text.as_str()), (3, "## Setup"));
    }

    #[test]
    fn a_marker_on_its_own_line_names_the_block_above() {
        let table = "Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n^tbl\n\nAfter";
        let block = find_block(table, "tbl").unwrap();
        assert_eq!((block.start_line, block.end_line, block.text.as_str()), (2, 7, "| a | b |\n| - | - |\n| 1 | 2 |"));

        let code = "```js\nlet x = 1;\n\n```\n^code";
        assert_eq!(find_block(code, "code").unwrap().text, "```js\nlet x = 1;\n\n```");

        let callout = "::: tip Title\nBody\n\nMore\n:::\n\n^tip";
        assert_eq!(find_block(callout, "tip").unwrap().start_line, 0);

        let tags = "<grid 2>\n<col>\nA\n</col>\n</grid>\n^g";
        assert_eq!(find_block(tags, "g").unwrap().text, "<grid 2>\n<col>\nA\n</col>\n</grid>");

        let list = "Text\n\n- one\n  - two\n- three\n\n^lst";
        assert_eq!(find_block(list, "lst").unwrap().text, "- one\n  - two\n- three");

        let quote = "> said\n> twice\n^q";
        assert_eq!(find_block(quote, "q").unwrap().text, "> said\n> twice");

        assert_eq!(find_block("^lonely", "lonely"), None);
    }

    #[test]
    fn a_moved_block_keeps_its_id() {
        let before = "Intro\n\n- keep me ^k1\n\nOutro";
        let after = "- keep me, edited ^k1\n\nIntro\n\nOutro";
        assert_eq!(find_block(before, "k1").unwrap().text, "- keep me");
        assert_eq!(find_block(after, "k1").unwrap().text, "- keep me, edited");
    }

    #[test]
    fn properties_that_link_count_as_backlinks() {
        use crate::properties::{Property, PropertyValue};
        let mut linking = Note { id: "a".into(), title: "Meeting".into(), preview: String::new(), tags: vec![], starred: false, folder_id: None, created_at: Default::default(), updated_at: Default::default(), word_count: 0, journal: None, properties: vec![], path: String::new() };
        linking.properties = vec![
            Property { key: "owner".into(), value: PropertyValue::Text("[[Sam]]".into()) },
            Property { key: "attendees".into(), value: PropertyValue::List(vec!["Alex".into(), "[[sam|S.]]".into()]) },
            Property { key: "status".into(), value: PropertyValue::Text("Sam".into()) },
        ];
        let mut target = linking.clone();
        (target.id, target.title, target.properties) = ("b".into(), "Sam".into(), vec![]);
        let found = backlinks(vec![(linking, "# Meeting\n\nWith [[Sam]].".into()), (target, "# Sam".into())], "b");
        assert_eq!(found[0].mentions, vec!["owner: [[Sam]]", "attendees: Alex, [[sam|S.]]", "With [[Sam]]."]);
    }

    #[test]
    fn mentions_are_linking_lines_without_markers() {
        let content = "# Notes\n\n- [ ] Read [[Über Alles|this]] and [[über alles]].\n## See [[Über Alles]]\nUnrelated [[Other]].\n";
        assert_eq!(mentions(content, &titled("über alles")), vec!["Read [[Über Alles|this]] and [[über alles]].", "See [[Über Alles]]"]);
    }

    #[test]
    fn mentions_keep_the_lines_nested_under_the_link() {
        let content = "[[Page]]\n  - [ ] Call back\n    - [ ] about [[Page]]\nNot nested\n\n- [[Page]] list item\n  - [x] done\n- sibling";
        assert_eq!(
            mentions(content, &titled("page")),
            vec!["[[Page]]\n  - [ ] Call back\n    - [ ] about [[Page]]", "[[Page]] list item\n  - [x] done"]
        );
    }

    #[test]
    fn targets_name_notes_by_title_then_path_then_file_name() {
        let notes = [
            note("acwi", "Die Ein-Fonds-Lösung", "blog/msci-acwi-imi-fm.md"),
            note("universe", "Das Investment-Universum", "investment-universum.md"),
            note("blog-index", "Blog home", "blog/index.md"),
            note("wiki-index", "Index page", "wiki/index.md"),
            note("titled", "msci-acwi-imi-fm", "elsewhere.md"),
        ];
        let targets = LinkTargets::new(&notes);
        // Title first, case-insensitively, even when a file has that name.
        assert_eq!(targets.resolve("MSCI-ACWI-IMI-FM"), vec!["titled"]);
        assert_eq!(targets.resolve("die ein-fonds-lösung"), vec!["acwi"]);
        // The path in the vault, with or without `.md` or a leading slash.
        assert_eq!(targets.resolve("blog/msci-acwi-imi-fm"), vec!["acwi"]);
        assert_eq!(targets.resolve("/Blog/MSCI-ACWI-IMI-FM.md"), vec!["acwi"]);
        assert_eq!(targets.resolve("blog/index"), vec!["blog-index"]);
        // A file name, or the end of a path, when only one note has it.
        assert_eq!(targets.resolve("investment-universum"), vec!["universe"]);
        assert_eq!(targets.resolve("index"), Vec::<&str>::new());
        assert_eq!(targets.resolve("log/index"), Vec::<&str>::new());
        assert_eq!(targets.resolve("missing"), Vec::<&str>::new());
        assert_eq!(targets.by_file("msci-acwi-imi-fm"), Some("acwi"));
    }

    #[test]
    fn links_by_path_count_as_backlinks() {
        let target = note("acwi", "Die Ein-Fonds-Lösung", "blog/msci-acwi-imi-fm.md");
        let notes = vec![
            (note("a", "Start", "start.md"), "See [[blog/msci-acwi-imi-fm|Die Ein-Fonds-Lösung]].".to_string()),
            (note("b", "Other", "other.md"), "- [[msci-acwi-imi-fm#Kosten]]\n- [[Die Ein-Fonds-Lösung]]".to_string()),
            (note("c", "Unrelated", "c.md"), "[[blog/other-post]]".to_string()),
            (target, "# Die Ein-Fonds-Lösung".to_string()),
        ];
        let found = backlinks(notes, "acwi");
        let mut found: Vec<_> = found.iter().map(|b| (b.note.id.as_str(), b.mentions.clone())).collect();
        found.sort();
        assert_eq!(found, vec![
            ("a", vec!["See [[blog/msci-acwi-imi-fm|Die Ein-Fonds-Lösung]].".to_string()]),
            ("b", vec!["[[msci-acwi-imi-fm#Kosten]]".to_string(), "[[Die Ein-Fonds-Lösung]]".to_string()]),
        ]);
    }

    #[test]
    fn block_embeds_resolve_by_path() {
        let notes = vec![(note("p", "Plan", "work/plan-2026.md"), "- ship it ^s1".to_string())];
        let (found, block) = resolve_block(notes, "work/plan-2026", "s1").unwrap();
        assert_eq!((found.id.as_str(), block.text.as_str()), ("p", "- ship it"));
    }

    #[test]
    fn renaming_leaves_links_that_name_the_file() {
        // `notes.md` has no heading, so its title is its file name; adding one renames it.
        let targets = LinkTargets::new([&note("n", "notes", "notes.md")]);
        let keep = |target: &str| targets.by_file(target) == Some("n");
        let content = "[[notes]] [[Notes#Part]] [[notes.md]]";
        assert_eq!(rename_links(content, "notes", "Meeting notes", &keep), None);
        // Without the file to fall back on, the title link follows.
        let none = |_: &str| false;
        assert_eq!(rename_links(content, "notes", "Meeting notes", &none).unwrap(), "[[Meeting notes]] [[Meeting notes#Part]] [[notes.md]]");
    }
}
