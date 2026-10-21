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
// Basic types come from the value. Specialized types use a YAML comment on
// the entry's first line, e.g. `price: 12.5 # tagdown:type=currency`.
// Other YAML readers still see an ordinary scalar or list.

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
    Longtext(String),
    Url(String),
    Email(String),
    Phone(String),
    Select(String),
    Multiselect(Vec<String>),
    Currency(f64),
    Percent(f64),
    /// Seconds, including fractional seconds.
    Duration(f64),
    /// An integer from zero (unrated) to five.
    Rating(f64),
    /// Local wall time, YYYY-MM-DDTHH:MM:SS.
    Datetime(String),
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
    if let Some((first, kind)) = entry.lines().next().unwrap_or_default().rsplit_once(" # tagdown:type=") {
        if !kind.is_empty() && kind.bytes().all(|b| b.is_ascii_alphanumeric()) {
            let rest = entry.find('\n').map_or("", |i| &entry[i..]);
            let base = parse_entry(&format!("{first}{rest}"));
            if matches!(base, PropertyValue::Raw(_)) { return PropertyValue::Raw(raw_value(entry)); }
            let json = serde_json::to_value(&base).unwrap_or_default();
            let typed = serde_json::from_value::<PropertyValue>(serde_json::json!({ "type": kind, "value": json["value"] }));
            return typed.ok().filter(|v| v.validate().is_ok()).unwrap_or_else(|| PropertyValue::Raw(raw_value(entry)));
        }
    }
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

/// A one-line value as YAML reads it: `2` is a number, `"2"` text, and so on.
pub fn parse_scalar(value: &str) -> PropertyValue {
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
    value.bytes().any(|b| b.is_ascii_digit())
        && value.bytes().all(|b| b.is_ascii_digit() || b"-+.eE".contains(&b))
        && value.parse::<f64>().is_ok_and(f64::is_finite)
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
        if let Ok(text) = serde_json::from_str::<String>(value) {
            return text;
        }
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
        && !text.chars().any(char::is_control)
        && matches!(parse_scalar(text), PropertyValue::Text(ref t) if t == text);
    if plain_ok {
        text.to_string()
    } else {
        serde_json::to_string(text).expect("a string is valid JSON and YAML")
    }
}

fn number_text(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 { format!("{}", n as i64) } else { format!("{n}") }
}

/// The frontmatter entry for `key: value`.
pub fn write_entry(key: &str, value: &PropertyValue) -> String {
    let specialized = match value {
        PropertyValue::Longtext(t) => Some(("longtext", PropertyValue::Text(t.clone()))),
        PropertyValue::Url(t) => Some(("url", PropertyValue::Text(t.clone()))),
        PropertyValue::Email(t) => Some(("email", PropertyValue::Text(t.clone()))),
        PropertyValue::Phone(t) => Some(("phone", PropertyValue::Text(t.clone()))),
        PropertyValue::Select(t) => Some(("select", PropertyValue::Text(t.clone()))),
        PropertyValue::Datetime(t) => Some(("datetime", PropertyValue::Text(t.clone()))),
        PropertyValue::Multiselect(items) => Some(("multiselect", PropertyValue::List(items.clone()))),
        PropertyValue::Currency(n) => Some(("currency", PropertyValue::Number(*n))),
        PropertyValue::Percent(n) => Some(("percent", PropertyValue::Number(*n))),
        PropertyValue::Duration(n) => Some(("duration", PropertyValue::Number(*n))),
        PropertyValue::Rating(n) => Some(("rating", PropertyValue::Number(*n))),
        _ => None,
    };
    if let Some((kind, base)) = specialized {
        let entry = write_entry(key, &base);
        let at = entry.find('\n').unwrap_or(entry.len());
        return format!("{} # tagdown:type={kind}{}", &entry[..at], &entry[at..]);
    }
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
        _ => unreachable!("specialized values are written above"),
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
    if key.starts_with(['#', '-', ' ', '\'', '"', '[', '{']) || key.contains([':', '\n', '\r']) {
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
    if let Some(value) = value { value.validate()?; }
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
            PropertyValue::Text(t) | PropertyValue::Longtext(t) | PropertyValue::Url(t) | PropertyValue::Email(t) | PropertyValue::Phone(t) | PropertyValue::Select(t) | PropertyValue::Raw(t) => vec![t.as_str()],
            PropertyValue::List(items) | PropertyValue::Multiselect(items) => items.iter().map(String::as_str).collect(),
            _ => Vec::new(),
        }
    }

    /// The value as one line of text, lists joined with commas.
    pub fn display(&self) -> String {
        match self {
            PropertyValue::Text(t) | PropertyValue::Longtext(t) | PropertyValue::Url(t) | PropertyValue::Email(t) | PropertyValue::Phone(t) | PropertyValue::Select(t) | PropertyValue::Datetime(t) => t.clone(),
            PropertyValue::Number(n) | PropertyValue::Currency(n) | PropertyValue::Percent(n) | PropertyValue::Duration(n) | PropertyValue::Rating(n) => number_text(*n),
            PropertyValue::Checkbox(b) => b.to_string(),
            PropertyValue::Date(d) => d.format("%Y-%m-%d").to_string(),
            PropertyValue::List(items) | PropertyValue::Multiselect(items) => items.join(", "),
            PropertyValue::Raw(raw) => raw.split_whitespace().collect::<Vec<_>>().join(" "),
        }
    }

    pub fn is_empty(&self) -> bool {
        match self {
            PropertyValue::Text(t) | PropertyValue::Longtext(t) | PropertyValue::Url(t) | PropertyValue::Email(t) | PropertyValue::Phone(t) | PropertyValue::Select(t) | PropertyValue::Raw(t) => t.trim().is_empty(),
            PropertyValue::List(items) | PropertyValue::Multiselect(items) => items.is_empty(),
            _ => false,
        }
    }

    pub fn number(&self) -> Option<f64> {
        match self {
            Self::Number(n) | Self::Currency(n) | Self::Percent(n) | Self::Duration(n) | Self::Rating(n) => Some(*n),
            _ => None,
        }
    }

    /// Validate values from the desktop, CLI and MCP before writing them.
    pub fn validate(&self) -> Result<(), String> {
        if self.number().is_some_and(|n| !n.is_finite()) { return Err("Enter a finite number.".into()); }
        match self {
            Self::Rating(n) if n.fract() != 0.0 || !(0.0..=5.0).contains(n) => Err("Rating must be a whole number from 0 to 5.".into()),
            Self::Duration(n) if *n < 0.0 => Err("Duration cannot be negative.".into()),
            Self::Datetime(t) if t.len() != 19 || chrono::NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S").is_err() => Err("Enter a valid date and time.".into()),
            Self::Url(t) if !t.is_empty() && crate::weblink::web_url(t).is_none() => Err("Enter an http or https URL with a host.".into()),
            Self::Email(t) if !t.is_empty() && !valid_email(t) => Err("Enter an email address.".into()),
            Self::Phone(t) if !t.is_empty() && (!t.chars().any(|c| c.is_ascii_digit()) || !t.chars().all(|c| c.is_ascii_digit() || " +().-xX#".contains(c))) => Err("Enter a phone number.".into()),
            Self::Multiselect(items) if items.iter().enumerate().any(|(i, item)| item.is_empty() || items[..i].contains(item)) => Err("Multiple select options must be nonempty and unique.".into()),
            _ => Ok(()),
        }
    }
}

fn valid_email(text: &str) -> bool {
    let Some((local, domain)) = text.split_once('@') else { return false };
    !local.is_empty() && domain.split_once('.').is_some_and(|(host, suffix)| !host.is_empty() && !suffix.is_empty())
        && !domain.contains('@') && !text.contains(char::is_whitespace)
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

    #[test]
    fn specialized_types_round_trip_through_yaml_and_serde() {
        use PropertyValue::*;
        for value in [
            Longtext("  first line\n\nsecond line\twith \\\"quotes\\\"\r\n".into()),
            Url("https://example.com/a?q=x#section".into()), Email("sam@example.com".into()),
            Phone("+49 (30) 123-456".into()), Select("in progress".into()), Select(String::new()),
            Multiselect(vec!["a, b".into(), "say \"hi\"".into(), "[[Sam]]".into()]), Multiselect(vec![]),
            Currency(12.5), Percent(0.75), Percent(0.00000001), Duration(5405.5), Rating(4.0),
            Datetime("2026-10-19T14:30:00".into()),
        ] {
            let mut extra = vec![write_entry("field", &value)];
            assert_eq!(parse_properties(&extra)[0].value, value, "{}", extra[0]);
            let json = serde_json::to_string(&Property { key: "field".into(), value: value.clone() }).unwrap();
            assert_eq!(serde_json::from_str::<Property>(&json).unwrap().value, value);
            set_property(&mut extra, "renamed", Some(&value), Some("field")).unwrap();
            assert_eq!(parse_properties(&extra)[0], Property { key: "renamed".into(), value });
        }
        let literal = Text("literal # tagdown:type=url".into());
        assert_eq!(parse_properties(&[write_entry("literal", &literal)])[0].value, literal);
    }

    #[test]
    fn invalid_typed_values_are_preserved_and_invalid_writes_rejected() {
        for entry in ["a: 6 # tagdown:type=rating", "a: -1 # tagdown:type=duration", "a: nope # tagdown:type=currency", "a: 2026-02-30T14:30:00 # tagdown:type=datetime", "a: https:// # tagdown:type=url", "a: bad@ # tagdown:type=email", "a: call me # tagdown:type=phone", "a: [a, a] # tagdown:type=multiselect", "a: 1 # tagdown:type=future"] {
            assert!(matches!(parse_properties(&[entry.into()])[0].value, PropertyValue::Raw(_)), "{entry}");
        }
        let mut extra = vec!["rating: 4 # tagdown:type=rating".into()];
        let before = extra.clone();
        for value in [PropertyValue::Rating(5.5), PropertyValue::Duration(-1.0), PropertyValue::Number(f64::NAN)] {
            assert!(set_property(&mut extra, "rating", Some(&value), None).is_err());
            assert_eq!(extra, before);
        }
        assert_eq!(parse_properties(&[write_entry("text", &PropertyValue::Text("a\nb\t\\n".into()))])[0].value, PropertyValue::Text("a\nb\t\\n".into()));
    }
}
