// Note properties: the custom entries in a note's frontmatter, read as typed
// values. They stay ordinary YAML, the way Obsidian writes them:
//
//   status: active            text
//   priority: 2               number
//   reviewed: true            checkbox
//   due: 2026-11-14           date
//   owner: "[[Sam Rivera]]"   text holding a link
//   attendees:                list
//     - Alex
//     - "[[Sam Rivera]]"
//
// The type comes from the value itself, so nothing is stored besides the
// note: text that would read as another type is written in quotes. Entries
// Tagdown can't edit (nested maps, block scalars) are kept as raw YAML.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// Keys Tagdown manages itself; they are never properties.
pub const MANAGED_KEYS: [&str; 8] = ["id", "title", "tags", "starred", "folder_id", "created", "updated", "journal"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
pub enum PropertyValue {
    Text(String),
    Number(f64),
    Checkbox(bool),
    Date(NaiveDate),
    List(Vec<String>),
    /// YAML Tagdown doesn't edit, as written (without the key).
    Raw(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Property {
    pub key: String,
    #[serde(flatten)]
    pub value: PropertyValue,
}

/// The key of a frontmatter entry, if it is a `key: value` entry.
fn entry_key(entry: &str) -> Option<&str> {
    let first = entry.lines().next()?;
    if first.starts_with([' ', '\t', '#', '-']) {
        return None;
    }
    let (key, _) = first.split_once(':')?;
    let key = key.trim();
    (!key.is_empty()).then_some(key)
}

/// The properties among a note's custom frontmatter entries, in file order.
pub fn parse_properties(extra: &[String]) -> Vec<Property> {
    extra
        .iter()
        .filter_map(|entry| {
            let key = entry_key(entry)?;
            Some(Property { key: key.to_string(), value: parse_entry(entry) })
        })
        .collect()
}

fn parse_entry(entry: &str) -> PropertyValue {
    let mut lines = entry.lines();
    let first = lines.next().unwrap_or_default();
    let value = first.split_once(':').map_or("", |(_, v)| v).trim();
    let rest: Vec<&str> = lines.filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#')).collect();
    if value.is_empty() {
        if rest.is_empty() {
            return PropertyValue::Text(String::new());
        }
        // A block list: every line `- item`.
        let items: Option<Vec<String>> = rest
            .iter()
            .map(|l| l.trim_start().strip_prefix('-').map(|item| unquote(strip_comment(item.trim()))))
            .collect();
        return items.map_or_else(|| PropertyValue::Raw(raw_value(entry)), PropertyValue::List);
    }
    if !rest.is_empty() || value.starts_with(['|', '>', '{', '&', '*', '!']) {
        return PropertyValue::Raw(raw_value(entry));
    }
    parse_scalar(strip_comment(value))
}

/// Everything after the key: the value on the first line and the lines below.
fn raw_value(entry: &str) -> String {
    entry.split_once(':').map_or("", |(_, v)| v).trim_start_matches(' ').to_string()
}

fn parse_scalar(value: &str) -> PropertyValue {
    if value.starts_with('"') || value.starts_with('\'') {
        return PropertyValue::Text(unquote(value));
    }
    if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        // `[[Note]]` unquoted is a list holding a list in YAML; read it as the link it was meant to be.
        if inner.starts_with('[') && inner.ends_with(']') && !inner.contains(',') {
            return PropertyValue::Text(value.to_string());
        }
        return PropertyValue::List(split_flow(inner).into_iter().map(|item| unquote(&item)).filter(|i| !i.is_empty()).collect());
    }
    match value {
        "true" | "True" | "TRUE" => return PropertyValue::Checkbox(true),
        "false" | "False" | "FALSE" => return PropertyValue::Checkbox(false),
        "null" | "~" => return PropertyValue::Text(String::new()),
        _ => {}
    }
    if is_number(value) {
        if let Ok(n) = value.parse::<f64>() {
            return PropertyValue::Number(n);
        }
    }
    if let Some(date) = parse_date(value) {
        return PropertyValue::Date(date);
    }
    PropertyValue::Text(value.to_string())
}

fn is_number(value: &str) -> bool {
    let digits = value.strip_prefix('-').unwrap_or(value);
    let mut parts = digits.splitn(2, '.');
    let whole = parts.next().unwrap_or_default();
    let fraction = parts.next();
    !whole.is_empty() && whole.bytes().all(|b| b.is_ascii_digit()) && fraction.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    (value.len() == 10).then(|| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()).flatten()
}

/// A plain value without its trailing ` # comment`.
fn strip_comment(value: &str) -> &str {
    if value.starts_with(['"', '\'']) {
        return value;
    }
    value.find(" #").map_or(value, |i| value[..i].trim_end())
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    if let Some(inner) = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
        return inner.replace("\\\"", "\"").replace("\\\\", "\\");
    }
    if let Some(inner) = value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')) {
        return inner.replace("''", "'");
    }
    value.to_string()
}

/// Items of a flow list (`a, "b, c", d`), quotes kept.
fn split_flow(inner: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut depth = 0;
    for c in inner.chars() {
        match c {
            '"' | '\'' if quote.is_none() => quote = Some(c),
            c if Some(c) == quote => quote = None,
            '[' if quote.is_none() => depth += 1,
            ']' if quote.is_none() => depth -= 1,
            ',' if quote.is_none() && depth == 0 => {
                items.push(std::mem::take(&mut current).trim().to_string());
                continue;
            }
            _ => {}
        }
        current.push(c);
    }
    if !current.trim().is_empty() {
        items.push(current.trim().to_string());
    }
    items
}

/// `text` as a YAML scalar that reads back as the same text.
fn text_scalar(text: &str) -> String {
    let plain_ok = !text.is_empty()
        && !text.starts_with(['[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@', '`', ',', '-', '?', ':', ' '])
        && !text.ends_with([' ', ':'])
        && !text.contains(": ")
        && !text.contains(" #")
        && !text.contains('\n')
        && matches!(parse_scalar(text), PropertyValue::Text(ref t) if t == text);
    if plain_ok {
        text.to_string()
    } else {
        format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " "))
    }
}

fn number_text(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 { format!("{}", n as i64) } else { format!("{n}") }
}

/// The frontmatter entry for `key: value`.
pub fn write_entry(key: &str, value: &PropertyValue) -> String {
    match value {
        PropertyValue::Text(t) if t.is_empty() => format!("{key}:"),
        PropertyValue::Text(t) => format!("{key}: {}", text_scalar(t)),
        PropertyValue::Number(n) => format!("{key}: {}", number_text(*n)),
        PropertyValue::Checkbox(b) => format!("{key}: {b}"),
        PropertyValue::Date(d) => format!("{key}: {}", d.format("%Y-%m-%d")),
        PropertyValue::List(items) if items.is_empty() => format!("{key}: []"),
        PropertyValue::List(items) => {
            let mut out = format!("{key}:");
            for item in items {
                out.push_str("\n  - ");
                out.push_str(&text_scalar(item));
            }
            out
        }
        PropertyValue::Raw(raw) if raw.starts_with('\n') => format!("{key}:{raw}"),
        PropertyValue::Raw(raw) => format!("{key}: {raw}"),
    }
}

/// Whether `key` can name a property.
pub fn check_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("A property needs a name.".into());
    }
    if MANAGED_KEYS.contains(&key.to_lowercase().as_str()) {
        return Err(format!("“{key}” is managed by Tagdown."));
    }
    if key.starts_with(['#', '-', ' ', '\'', '"', '[', '{']) || key.contains([':', '\n']) {
        return Err(format!("“{key}” can’t be a property name."));
    }
    Ok(())
}

/// Set (`Some`) or remove (`None`) the property `key` among `extra`, keeping
/// its place. With `rename_from`, the property of that name is replaced.
pub fn set_property(extra: &mut Vec<String>, key: &str, value: Option<&PropertyValue>, rename_from: Option<&str>) -> Result<(), String> {
    let key = key.trim();
    let from = rename_from.map(str::trim).unwrap_or(key);
    if value.is_some() {
        check_key(key)?;
    }
    if from != key && extra.iter().any(|e| entry_key(e) == Some(key)) {
        return Err(format!("This note already has a property “{key}”."));
    }
    let at = extra.iter().position(|e| entry_key(e) == Some(from));
    match (value, at) {
        (Some(value), Some(i)) => extra[i] = write_entry(key, value),
        (Some(value), None) => extra.push(write_entry(key, value)),
        (None, Some(i)) => {
            extra.remove(i);
        }
        (None, None) => {}
    }
    Ok(())
}

impl PropertyValue {
    /// Text values and list items, for links and display.
    pub fn texts(&self) -> Vec<&str> {
        match self {
            PropertyValue::Text(t) | PropertyValue::Raw(t) => vec![t.as_str()],
            PropertyValue::List(items) => items.iter().map(String::as_str).collect(),
            _ => Vec::new(),
        }
    }

    /// The value as one line of text, lists joined with commas.
    pub fn display(&self) -> String {
        match self {
            PropertyValue::Text(t) => t.clone(),
            PropertyValue::Number(n) => number_text(*n),
            PropertyValue::Checkbox(b) => b.to_string(),
            PropertyValue::Date(d) => d.format("%Y-%m-%d").to_string(),
            PropertyValue::List(items) => items.join(", "),
            PropertyValue::Raw(raw) => raw.split_whitespace().collect::<Vec<_>>().join(" "),
        }
    }

    pub fn is_empty(&self) -> bool {
        match self {
            PropertyValue::Text(t) | PropertyValue::Raw(t) => t.trim().is_empty(),
            PropertyValue::List(items) => items.is_empty(),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(yaml: &str) -> Vec<String> {
        // One entry per top-level line, continuation lines attached, as the frontmatter parser does.
        let mut out: Vec<String> = Vec::new();
        for line in yaml.lines() {
            if line.starts_with([' ', '\t']) || line.starts_with("- ") {
                out.last_mut().unwrap().push_str(&format!("\n{line}"));
            } else {
                out.push(line.to_string());
            }
        }
        out
    }

    #[test]
    fn reads_types_from_the_values() {
        let props = parse_properties(&entries("status: active\npriority: 2\nscore: -1.5\nreviewed: true\ndue: 2026-11-14\nowner: \"[[Sam]]\"\nbare: [[Sam]]\nquoted: \"42\"\nempty:\n# a comment\ntags2: [a, \"b, c\"]\nattendees:\n  - Alex\n  - \"[[Sam]]\"\nsource:\n  url: x\nnote: |\n  long\nversion: 1.2.3 # semver"));
        let values: Vec<(&str, &PropertyValue)> = props.iter().map(|p| (p.key.as_str(), &p.value)).collect();
        use PropertyValue::*;
        assert_eq!(values, vec![
            ("status", &Text("active".into())),
            ("priority", &Number(2.0)),
            ("score", &Number(-1.5)),
            ("reviewed", &Checkbox(true)),
            ("due", &Date(NaiveDate::from_ymd_opt(2026, 11, 14).unwrap())),
            ("owner", &Text("[[Sam]]".into())),
            ("bare", &Text("[[Sam]]".into())),
            ("quoted", &Text("42".into())),
            ("empty", &Text(String::new())),
            ("tags2", &List(vec!["a".into(), "b, c".into()])),
            ("attendees", &List(vec!["Alex".into(), "[[Sam]]".into()])),
            ("source", &Raw("\n  url: x".into())),
            ("note", &Raw("|\n  long".into())),
            ("version", &Text("1.2.3".into())),
        ]);
    }

    #[test]
    fn writes_values_that_read_back_the_same() {
        use PropertyValue::*;
        let cases = [
            Text("active".into()),
            Text("42".into()),
            Text("true".into()),
            Text("2026-11-14".into()),
            Text("[[Sam Rivera]]".into()),
            Text("a: b".into()),
            Text("say \"hi\"".into()),
            Text("- not a list".into()),
            Text(String::new()),
            Number(3.0),
            Number(0.25),
            Checkbox(false),
            Date(NaiveDate::from_ymd_opt(2026, 1, 2).unwrap()),
            List(vec!["Alex".into(), "[[Sam]]".into(), "12".into()]),
            List(vec![]),
        ];
        for value in cases {
            let entry = write_entry("key", &value);
            assert_eq!(parse_properties(&entries(&entry)), vec![Property { key: "key".into(), value: value.clone() }], "{entry}");
        }
        assert_eq!(write_entry("owner", &Text("[[Sam]]".into())), "owner: \"[[Sam]]\"");
        assert_eq!(write_entry("people", &List(vec!["A".into(), "B".into()])), "people:\n  - A\n  - B");
    }

    #[test]
    fn sets_renames_and_removes_in_place() {
        let mut extra = entries("status: active\n# keep me\nsource:\n  url: x");
        set_property(&mut extra, "status", Some(&PropertyValue::Text("done".into())), None).unwrap();
        set_property(&mut extra, "due", Some(&PropertyValue::Date(NaiveDate::from_ymd_opt(2026, 1, 2).unwrap())), None).unwrap();
        set_property(&mut extra, "state", Some(&PropertyValue::Text("done".into())), Some("status")).unwrap();
        assert_eq!(extra, vec!["state: done", "# keep me", "source:\n  url: x", "due: 2026-01-02"]);
        assert!(set_property(&mut extra, "due", Some(&PropertyValue::Text("x".into())), Some("state")).is_err());
        assert!(set_property(&mut extra, "tags", Some(&PropertyValue::Text("x".into())), None).is_err());
        assert!(set_property(&mut extra, "a:b", Some(&PropertyValue::Text("x".into())), None).is_err());
        set_property(&mut extra, "source", None, None).unwrap();
        assert_eq!(extra, vec!["state: done", "# keep me", "due: 2026-01-02"]);
    }
}
