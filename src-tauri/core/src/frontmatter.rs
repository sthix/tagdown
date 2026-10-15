use chrono::{DateTime, NaiveDate, Utc};

use crate::models::NoteFrontmatter;

pub fn split_frontmatter(raw: &str) -> Result<(NoteFrontmatter, String), String> {
    let raw = raw.strip_prefix("---\n").ok_or("missing frontmatter")?;
    let Some(end) = raw.find("\n---\n") else {
        return Err("unterminated frontmatter".into());
    };
    let (meta, content) = raw.split_at(end);
    let content = content
        .trim_start_matches("\n---\n")
        .strip_prefix('\n')
        .unwrap_or_else(|| content.trim_start_matches("\n---\n"))
        .to_string();

    let mut id = None;
    let mut title = None;
    let mut tags = Vec::new();
    let mut starred = false;
    let mut folder_id = None;
    let mut created = None;
    let mut updated = None;
    let mut journal = None;
    let mut extra: Vec<String> = Vec::new();
    // What the previous top-level line was, so indented or `- ` lines after
    // it are read as part of the same entry.
    enum Owner { None, Tags, Extra, Known }
    let mut owner = Owner::None;

    for line in meta.lines() {
        if is_continuation(line) {
            match owner {
                // Comments and blank lines are kept on their own; anything
                // else under a managed key is rewritten with that key.
                _ if is_comment_or_blank(line) => extra.push(line.to_string()),
                Owner::Extra => if let Some(entry) = extra.last_mut() {
                    entry.push('\n');
                    entry.push_str(line);
                },
                Owner::Tags => if let Some(item) = line.trim_start().strip_prefix('-') {
                    let tag = item.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
                    if !tag.is_empty() { tags.push(tag); }
                },
                Owner::Known | Owner::None => {}
            }
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            extra.push(line.to_string());
            owner = Owner::Extra;
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        owner = Owner::Known;
        match key {
            "id" => id = Some(value.to_string()),
            "title" => title = Some(value.to_string()),
            "tags" => {
                tags = parse_tags(value);
                owner = Owner::Tags;
            }
            "starred" => starred = value == "true",
            "folder_id" => if value != "null" && !value.is_empty() { folder_id = Some(value.to_string()); },
            "created" => created = Some(parse_date(value)?),
            "updated" => updated = Some(parse_date(value)?),
            "journal" => journal = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok(),
            _ => {
                extra.push(line.to_string());
                owner = Owner::Extra;
            }
        }
    }

    Ok((NoteFrontmatter {
        id: id.ok_or("frontmatter missing id")?,
        title: title.unwrap_or_else(|| "Untitled".into()),
        tags,
        starred,
        folder_id,
        created: created.ok_or("frontmatter missing created")?,
        updated: updated.ok_or("frontmatter missing updated")?,
        journal,
        extra,
    }, content))
}

pub fn write_frontmatter(meta: &NoteFrontmatter, content: &str) -> String {
    let tags = if meta.tags.is_empty() {
        "[]".to_string()
    } else {
        format!("[{}]", meta.tags.join(", "))
    };
    // Only journal pages carry a `journal:` line, so other notes stay as they were.
    let journal = meta.journal.map(|day| format!("journal: {}\n", day.format("%Y-%m-%d"))).unwrap_or_default();
    let extra: String = meta.extra.iter().map(|entry| format!("{entry}\n")).collect();
    format!(
        "---\nid: {}\ntitle: {}\ntags: {}\nstarred: {}\nfolder_id: {}\ncreated: {}\nupdated: {}\n{journal}{extra}---\n\n{}",
        meta.id,
        meta.title.replace('\n', " "),
        tags,
        meta.starred,
        meta.folder_id.clone().unwrap_or_else(|| "null".into()),
        meta.created.to_rfc3339(),
        meta.updated.to_rfc3339(),
        content.trim_start()
    )
}

/// Lines that belong to the entry above them: indented values, YAML list
/// items, comments and blank lines.
fn is_continuation(line: &str) -> bool {
    line.starts_with([' ', '\t'])
        || line == "-"
        || line.starts_with("- ")
        || is_comment_or_blank(line)
}

fn is_comment_or_blank(line: &str) -> bool {
    line.starts_with('#') || line.trim().is_empty()
}

fn parse_tags(value: &str) -> Vec<String> {
    value
        .trim_matches(|c| c == '[' || c == ']')
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_matches('"').to_string())
        .collect()
}

fn parse_date(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|err| err.to_string())
}

pub fn derive_title(content: &str) -> String {
    content
        .lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|s| !s.is_empty())
        .unwrap_or("Untitled")
        .to_string()
}

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
                    .join("/")
                    .to_lowercase();
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

pub fn derive_preview(content: &str) -> String {
    content
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(160)
        .collect()
}

pub fn word_count(content: &str) -> u32 {
    content.split_whitespace().count() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_writes_frontmatter() {
        let raw = "---\nid: abc\ntitle: Test\ntags: [one, two]\nstarred: true\nfolder_id: null\ncreated: 2026-05-18T09:14:22Z\nupdated: 2026-05-18T10:14:22Z\n---\n\n# Test\nBody";
        let (meta, content) = split_frontmatter(raw).unwrap();
        assert_eq!(meta.id, "abc");
        assert_eq!(meta.tags, vec!["one", "two"]);
        assert_eq!(content, "# Test\nBody");
        assert!(write_frontmatter(&meta, &content).contains("starred: true"));
        assert!(!write_frontmatter(&meta, &content).contains("journal:"));
    }

    #[test]
    fn journal_day_round_trips() {
        let raw = "---\nid: abc\ntitle: 2026-10-13\ntags: []\nstarred: false\nfolder_id: null\ncreated: 2026-10-13T09:14:22+00:00\nupdated: 2026-10-13T10:14:22+00:00\njournal: 2026-10-13\n---\n\n# 2026-10-13\n";
        let (meta, content) = split_frontmatter(raw).unwrap();
        assert_eq!(meta.journal, NaiveDate::from_ymd_opt(2026, 10, 13));
        assert_eq!(write_frontmatter(&meta, &content), raw);
    }

    #[test]
    fn custom_entries_survive_a_save() {
        let raw = "---\nid: abc\ntitle: Atlas\ntags: []\nstarred: false\nfolder_id: null\ncreated: 2026-10-13T09:14:22+00:00\nupdated: 2026-10-13T10:14:22+00:00\nstatus: active\n# reviewed weekly\nattendees:\n  - Alex\n  - Sam\nsource:\n  url: https://example.com\n  id: not-the-note-id\n---\n\n# Atlas\n";
        let (meta, content) = split_frontmatter(raw).unwrap();
        assert_eq!(meta.id, "abc");
        assert_eq!(meta.extra, vec![
            "status: active",
            "# reviewed weekly",
            "attendees:\n  - Alex\n  - Sam",
            "source:\n  url: https://example.com\n  id: not-the-note-id",
        ]);
        assert_eq!(write_frontmatter(&meta, &content), raw);
    }

    #[test]
    fn custom_entries_follow_the_managed_ones() {
        let raw = "---\nauthor: Ursula\nid: abc\ntitle: Book\ntags: []\nstarred: false\nfolder_id: null\ncreated: 2026-10-13T09:14:22+00:00\nupdated: 2026-10-13T10:14:22+00:00\n---\n\n# Book\n";
        let (meta, content) = split_frontmatter(raw).unwrap();
        let written = write_frontmatter(&meta, &content);
        assert!(written.contains("updated: 2026-10-13T10:14:22+00:00\nauthor: Ursula\n---"));
        assert_eq!(split_frontmatter(&written).unwrap().0.extra, vec!["author: Ursula"]);
    }

    #[test]
    fn reads_block_list_tags() {
        let raw = "---\nid: abc\ntitle: T\ntags:\n  - one\n  - \"two\"\nstarred: false\nfolder_id: null\ncreated: 2026-10-13T09:14:22+00:00\nupdated: 2026-10-13T10:14:22+00:00\n---\n\n# T\n";
        let (meta, _) = split_frontmatter(raw).unwrap();
        assert_eq!(meta.tags, vec!["one", "two"]);
        assert!(meta.extra.is_empty());
    }

    #[test]
    fn derive_tags_basic_and_nested() {
        let body = "Notes about #chemistry and #notes/organic stuff.";
        assert_eq!(derive_tags(body), vec!["chemistry", "notes/organic"]);
    }

    #[test]
    fn derive_tags_excludes_headings_and_midword() {
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

    #[test]
    fn derive_tags_lowercases_and_dedups_case_variants() {
        let body = "#hAhAHA and #hahaha and #Notes/Chemistry";
        assert_eq!(derive_tags(body), vec!["hahaha", "notes/chemistry"]);
    }
}
