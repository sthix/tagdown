// Wikilinks: `[[Title]]`, `[[Title#Heading]]`, `[[Title|label]]`, and block
// references `[[Title#^id]]` (embedded with `![[Title#^id]]`).
//
// A link points at a note by title, compared case-insensitively. Links inside
// fenced code blocks and inline code are text, not links.
//
// A block is addressed by a plain-text marker at the end of its line, the way
// Obsidian writes them: `Some paragraph ^ab12cd`, `- [ ] a task ^ab12cd`. The
// marker travels with the text, so the id survives edits and moves.

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
/// anchors and labels; `None` when nothing links to `old_title`.
pub fn rename_links(content: &str, old_title: &str, new_title: &str) -> Option<String> {
    let old = normalize_title(old_title);
    let links: Vec<Wikilink> = parse_wikilinks(content).into_iter().filter(|l| normalize_title(&l.target) == old).collect();
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
/// line.
pub fn find_block(content: &str, id: &str) -> Option<Block> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut in_fence: Option<&str> = None;
    let mut at = None;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        let fence = ["```", "~~~"].into_iter().find(|f| trimmed.starts_with(f));
        match (in_fence, fence) {
            (None, Some(f)) => { in_fence = Some(f); continue; }
            (Some(open), Some(f)) if open == f => { in_fence = None; continue; }
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
    let (_, cut) = block_marker(line)?;
    let depth = indent_width(lines[start]);
    let text = lines[start..end]
        .iter()
        .enumerate()
        .map(|(k, l)| {
            let l = if start + k == at { &l[..cut] } else { l };
            let l = l.replace('\t', "  ");
            let skip = l.len() - l.trim_start_matches(' ').len();
            l[skip.min(depth)..].to_string()
        })
        .collect::<Vec<_>>()
        .join("\n");
    Some(Block { id: block_marker(line)?.0.to_string(), start_line: start, end_line: end, text })
}

/// The note titled `title` among `notes` and its block `^id`. Archived notes
/// are left out.
pub fn resolve_block(notes: Vec<(Note, String)>, title: &str, id: &str) -> Option<(Note, Block)> {
    let wanted = normalize_title(title);
    notes
        .into_iter()
        .filter(|(note, _)| note.folder_id.as_deref() != Some("archive") && normalize_title(&note.title) == wanted)
        .find_map(|(note, content)| find_block(&content, id).map(|block| (note, block)))
}

/// Notes in `notes` that link to the note `id`, most recently edited first.
/// Archived notes are left out.
pub fn backlinks(notes: Vec<(Note, String)>, id: &str) -> Vec<Backlink> {
    let Some(title) = notes.iter().find(|(note, _)| note.id == id).map(|(note, _)| note.title.clone()) else {
        return Vec::new();
    };
    let mut backlinks: Vec<Backlink> = notes
        .into_iter()
        .filter(|(note, _)| note.id != id && note.folder_id.as_deref() != Some("archive"))
        .filter_map(|(note, content)| {
            let mentions = mentions(&content, &title);
            (!mentions.is_empty()).then_some(Backlink { note, mentions })
        })
        .collect();
    backlinks.sort_by(|a, b| b.note.updated_at.cmp(&a.note.updated_at));
    backlinks
}

/// Source lines of `content` that link to `title`, each with the lines indented
/// under it (tasks nested under a link, say), re-indented two spaces under the
/// linking line.
pub fn mentions(content: &str, title: &str) -> Vec<String> {
    let wanted = normalize_title(title);
    let mut mentions: Vec<String> = Vec::new();
    // Links before this byte were already shown, on a linking line or nested under one.
    let mut covered = 0;
    for link in parse_wikilinks(content).into_iter().filter(|l| normalize_title(&l.target) == wanted) {
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
            rename_links(content, "Old Title", "New Title").unwrap(),
            "[[New Title]] and [[New Title#Part|label]] but not [[Older]] or `[[Old Title]]`"
        );
        assert_eq!(rename_links("no links here", "Old Title", "New"), None);
    }

    #[test]
    fn block_links_carry_their_id() {
        let links = parse_wikilinks("[[Plan#^ab12cd]] ![[Plan#^x-1|quoted]] [[Plan#Setup]] [[Plan#^]]");
        let ids: Vec<_> = links.iter().map(|l| l.block_id()).collect();
        assert_eq!(ids, vec![Some("ab12cd"), Some("x-1"), None, None]);
        assert_eq!(rename_links("![[Plan#^ab12cd]]", "plan", "Roadmap").unwrap(), "![[Roadmap#^ab12cd]]");
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
    fn a_moved_block_keeps_its_id() {
        let before = "Intro\n\n- keep me ^k1\n\nOutro";
        let after = "- keep me, edited ^k1\n\nIntro\n\nOutro";
        assert_eq!(find_block(before, "k1").unwrap().text, "- keep me");
        assert_eq!(find_block(after, "k1").unwrap().text, "- keep me, edited");
    }

    #[test]
    fn mentions_are_linking_lines_without_markers() {
        let content = "# Notes\n\n- [ ] Read [[Über Alles|this]] and [[über alles]].\n## See [[Über Alles]]\nUnrelated [[Other]].\n";
        assert_eq!(mentions(content, "über alles"), vec!["Read [[Über Alles|this]] and [[über alles]].", "See [[Über Alles]]"]);
    }

    #[test]
    fn mentions_keep_the_lines_nested_under_the_link() {
        let content = "[[Page]]\n  - [ ] Call back\n    - [ ] about [[Page]]\nNot nested\n\n- [[Page]] list item\n  - [x] done\n- sibling";
        assert_eq!(
            mentions(content, "page"),
            vec!["[[Page]]\n  - [ ] Call back\n    - [ ] about [[Page]]", "[[Page]] list item\n  - [x] done"]
        );
    }
}
