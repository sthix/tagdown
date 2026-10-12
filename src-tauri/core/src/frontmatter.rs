use chrono::{DateTime, Utc};

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

    for line in meta.lines() {
        let Some((key, value)) = line.split_once(':') else { continue; };
        let key = key.trim();
        let value = value.trim();
        match key {
            "id" => id = Some(value.to_string()),
            "title" => title = Some(value.to_string()),
            "tags" => tags = parse_tags(value),
            "starred" => starred = value == "true",
            "folder_id" => if value != "null" && !value.is_empty() { folder_id = Some(value.to_string()); },
            "created" => created = Some(parse_date(value)?),
            "updated" => updated = Some(parse_date(value)?),
            _ => {}
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
    }, content))
}

pub fn write_frontmatter(meta: &NoteFrontmatter, content: &str) -> String {
    let tags = if meta.tags.is_empty() {
        "[]".to_string()
    } else {
        format!("[{}]", meta.tags.join(", "))
    };
    format!(
        "---\nid: {}\ntitle: {}\ntags: {}\nstarred: {}\nfolder_id: {}\ncreated: {}\nupdated: {}\n---\n\n{}",
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
