// Wikilinks: `[[Title]]`, `[[Title#Heading]]`, `[[Title|label]]`.
//
// A link points at a note by title, compared case-insensitively. Links inside
// fenced code blocks and inline code are text, not links.

use serde::Serialize;

use crate::models::Note;

/// Context lines kept per linking note.
const MENTIONS_PER_NOTE: usize = 3;

#[derive(Debug, Clone, PartialEq)]
pub struct Wikilink {
    /// Byte range of the whole `[[...]]` in the content.
    pub start: usize,
    pub end: usize,
    pub target: String,
    pub anchor: Option<String>,
    pub label: Option<String>,
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

/// Source lines of `content` that link to `title`.
pub fn mentions(content: &str, title: &str) -> Vec<String> {
    let wanted = normalize_title(title);
    let mut mentions: Vec<String> = Vec::new();
    let mut last_line = usize::MAX;
    for link in parse_wikilinks(content).into_iter().filter(|l| normalize_title(&l.target) == wanted) {
        let line_start = content[..link.start].rfind('\n').map_or(0, |i| i + 1);
        if line_start == last_line {
            continue;
        }
        last_line = line_start;
        let line_end = content[link.end..].find('\n').map_or(content.len(), |i| link.end + i);
        mentions.push(strip_line_marker(&content[line_start..line_end]).to_string());
        if mentions.len() == MENTIONS_PER_NOTE {
            break;
        }
    }
    mentions
}

/// A line without its heading, quote, list, or task marker.
fn strip_line_marker(line: &str) -> &str {
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
    fn mentions_are_linking_lines_without_markers() {
        let content = "# Notes\n\n- [ ] Read [[Über Alles|this]] and [[über alles]].\n## See [[Über Alles]]\nUnrelated [[Other]].\n";
        assert_eq!(mentions(content, "über alles"), vec!["Read [[Über Alles|this]] and [[über alles]].", "See [[Über Alles]]"]);
    }
}
