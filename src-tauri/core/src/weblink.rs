// Saved web links: a note of type `Link` for a page on the web, with its
// `url:`, the page's title and description, and the article's opening text.
//
// Pages are fetched with the system's curl (every Mac has it), so the app
// carries no HTTP or TLS stack of its own. Only http and https are fetched,
// redirects included.

use std::{path::Path, process::Command};

use chrono::Local;

use crate::{
    journal::append_block,
    models::Note,
    properties::{Property, PropertyValue},
    types::{from_template, template_type},
    vault::Vault,
};

pub const LINK_TYPE: &str = "Link";
pub const URL_KEY: &str = "url";
const SITE_KEY: &str = "site";
/// The opening text stops after this many paragraphs or characters.
const OPENING_PARAGRAPHS: usize = 3;
const OPENING_CHARS: usize = 900;
/// Shorter paragraphs are bylines, captions and buttons, not the article.
const MIN_PARAGRAPH: usize = 60;
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Tagdown";

/// What a page says about itself.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PageInfo {
    pub title: Option<String>,
    pub description: Option<String>,
    pub site: Option<String>,
    /// The article's first paragraphs.
    pub opening: Vec<String>,
}

/// `url` when it is a web address Tagdown fetches (http or https with a host), trimmed.
pub fn web_url(url: &str) -> Option<&str> {
    let url = url.trim();
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    (!host.is_empty() && !url.contains(char::is_whitespace)).then_some(url)
}

/// A title for a page that gave none: its host and path (`example.com/post`).
pub fn url_title(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let rest = rest.split(['?', '#']).next().unwrap_or(rest).trim_end_matches('/');
    rest.strip_prefix("www.").unwrap_or(rest).to_string()
}

/// Download the page at `url` as text. Fails for pages that aren't HTML.
pub fn fetch_page(url: &str) -> Result<String, String> {
    let url = web_url(url).ok_or("only http and https links can be saved")?;
    let curl = if Path::new("/usr/bin/curl").exists() { "/usr/bin/curl" } else { "curl" };
    let output = Command::new(curl)
        .args(["--silent", "--show-error", "--fail", "--location", "--max-redirs", "5", "--max-time", "15", "--max-filesize", "5000000"])
        .args(["--proto", "=http,https", "--proto-redir", "=http,https", "--compressed", "--user-agent", USER_AGENT])
        .args(["--header", "Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"])
        // The content type comes last, after the page.
        .args(["--write-out", "\n%{content_type}", "--", url])
        .output()
        .map_err(|e| format!("could not run curl: {e}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(error.trim().trim_start_matches("curl: ").to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let (page, kind) = text.rsplit_once('\n').unwrap_or((&text, ""));
    if !kind.is_empty() && !kind.contains("html") {
        return Err(format!("not a web page ({})", kind.split(';').next().unwrap_or(kind).trim()));
    }
    Ok(page.to_string())
}

/// Elements whose text is never the article.
const SKIPPED: [&str; 11] = ["script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form", "figcaption"];

/// Read a page's title, description, site name and opening paragraphs. A
/// small scanner, not a full HTML parser: enough for the `<head>` and `<p>`s.
pub fn page_info(html: &str) -> PageInfo {
    let mut info = PageInfo::default();
    let (mut meta_title, mut head_title) = (None, None);
    // Paragraphs inside <article> or <main>, and the rest.
    let (mut in_article, mut elsewhere) = (Vec::new(), Vec::new());
    let mut skip: Vec<String> = Vec::new();
    let mut article_depth = 0usize;
    let mut title: Option<String> = None;
    let mut paragraph: Option<String> = None;
    let mut rest = html;
    while !rest.is_empty() {
        let Some(open) = rest.find('<') else {
            push_text(&mut paragraph, &mut title, &skip, rest);
            break;
        };
        push_text(&mut paragraph, &mut title, &skip, &rest[..open]);
        rest = &rest[open..];
        if let Some(comment) = rest.strip_prefix("<!--") {
            rest = comment.find("-->").map_or("", |end| &comment[end + 3..]);
            continue;
        }
        let Some(close) = rest.find('>') else { break };
        let tag = &rest[1..close];
        rest = &rest[close + 1..];
        let closing = tag.starts_with('/');
        let name: String = tag.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
        if name.is_empty() {
            continue;
        }
        // Script and style bodies may hold `<`: jump to their end tag.
        if !closing && matches!(name.as_str(), "script" | "style") {
            let end = format!("</{name}");
            rest = find_ascii_ci(rest, &end).map_or("", |at| &rest[at..]);
            continue;
        }
        if SKIPPED.contains(&name.as_str()) {
            if closing {
                if let Some(at) = skip.iter().rposition(|s| *s == name) {
                    skip.truncate(at);
                }
            } else if !tag.ends_with('/') {
                skip.push(name);
            }
            continue;
        }
        match (name.as_str(), closing) {
            ("title", false) if head_title.is_none() && skip.is_empty() => title = Some(String::new()),
            ("title", true) => head_title = head_title.or(title.take().map(|t| clean(&t)).filter(|t| !t.is_empty())),
            ("meta", false) => {
                let attrs = attributes(tag);
                let key = attrs.iter().find(|(k, _)| k == "property" || k == "name").map(|(_, v)| v.to_ascii_lowercase());
                let value = attrs.iter().find(|(k, _)| k == "content").map(|(_, v)| clean(v)).filter(|v| !v.is_empty());
                match (key.as_deref(), value) {
                    (Some("og:title" | "twitter:title"), Some(v)) => meta_title = meta_title.or(Some(v)),
                    (Some("og:description" | "twitter:description" | "description"), Some(v)) => info.description = info.description.or(Some(v)),
                    (Some("og:site_name"), Some(v)) => info.site = info.site.or(Some(v)),
                    _ => {}
                }
            }
            ("article" | "main", false) => article_depth += 1,
            ("article" | "main", true) => article_depth = article_depth.saturating_sub(1),
            ("br", _) => push_text(&mut paragraph, &mut title, &skip, " "),
            // A block starting or ending closes the paragraph; a <p> starts the next.
            ("p" | "div" | "section" | "li" | "h1" | "h2" | "h3" | "h4" | "blockquote" | "pre" | "table", _) => {
                if let Some(text) = paragraph.take().map(|p| clean(&p)).filter(|p| p.chars().count() >= MIN_PARAGRAPH) {
                    if article_depth > 0 { in_article.push(text) } else { elsewhere.push(text) }
                }
                if name == "p" && !closing && skip.is_empty() {
                    paragraph = Some(String::new());
                }
            }
            _ => {}
        }
    }
    info.title = meta_title.or(head_title);
    let mut chars = 0;
    for text in if in_article.is_empty() { elsewhere } else { in_article } {
        if info.opening.len() == OPENING_PARAGRAPHS || chars >= OPENING_CHARS {
            break;
        }
        chars += text.chars().count();
        info.opening.push(text);
    }
    info
}

fn push_text(paragraph: &mut Option<String>, title: &mut Option<String>, skip: &[String], text: &str) {
    if !skip.is_empty() {
        return;
    }
    for target in [paragraph, title].into_iter().flatten() {
        target.push_str(text);
    }
}

/// Where `needle` (ASCII) starts in `haystack`, ignoring case.
fn find_ascii_ci(haystack: &str, needle: &str) -> Option<usize> {
    haystack.as_bytes().windows(needle.len()).position(|w| w.eq_ignore_ascii_case(needle.as_bytes()))
}

/// A tag's attributes as lowercase names and decoded values.
fn attributes(tag: &str) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let mut rest = tag.split_once(char::is_whitespace).map_or("", |(_, r)| r);
    loop {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '/');
        let name_end = rest.find(|c: char| c == '=' || c.is_whitespace() || c == '/').unwrap_or(rest.len());
        if name_end == 0 {
            break;
        }
        let name = rest[..name_end].to_ascii_lowercase();
        rest = rest[name_end..].trim_start();
        let Some(value) = rest.strip_prefix('=') else {
            attrs.push((name, String::new()));
            continue;
        };
        let value = value.trim_start();
        let (text, after) = match value.chars().next() {
            Some(quote @ ('"' | '\'')) => {
                let body = &value[1..];
                body.find(quote).map_or((body, ""), |end| (&body[..end], &body[end + 1..]))
            }
            _ => value.find(char::is_whitespace).map_or((value, ""), |end| (&value[..end], &value[end..])),
        };
        attrs.push((name, decode_entities(text)));
        rest = after;
    }
    attrs
}

/// Text with entities decoded and whitespace collapsed.
fn clean(text: &str) -> String {
    decode_entities(text).split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let end = rest[1..].find(';').map(|i| i + 1).filter(|&i| i <= 10);
        let decoded = end.and_then(|end| {
            let name = &rest[1..end];
            let code = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                "ndash" => Some('–'),
                "mdash" => Some('—'),
                "hellip" => Some('…'),
                "rsquo" => Some('’'),
                "lsquo" => Some('‘'),
                "rdquo" => Some('”'),
                "ldquo" => Some('“'),
                _ => name.strip_prefix('#').and_then(|n| match n.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => n.parse().ok(),
                }).and_then(char::from_u32),
            };
            code.map(|c| (c, end))
        });
        match decoded {
            Some((c, end)) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Page text as Markdown that renders as written: angle brackets (which
/// Tagdown reads as components) and link brackets escaped.
fn as_text(text: &str) -> String {
    text.replace('<', "&lt;").replace("[[", "\\[\\[").replace("{{", "\\{\\{")
}

/// The body a Link note starts with: the description as a quote, then the opening text.
pub fn link_body(info: &PageInfo) -> String {
    let mut blocks = Vec::new();
    if let Some(description) = &info.description {
        // The opening paragraph often repeats the description.
        blocks.push(format!("> {}", as_text(description)));
    }
    let description = info.description.as_deref().map(str::to_lowercase);
    for paragraph in &info.opening {
        if description.as_deref().is_some_and(|d| paragraph.to_lowercase().starts_with(d.trim_end_matches(['.', '…']))) {
            continue;
        }
        blocks.push(as_text(paragraph));
    }
    blocks.join("\n\n")
}

impl Vault {
    /// The live note saved for `url`, if there is one.
    pub fn find_web_link(&self, url: &str) -> Result<Option<Note>, String> {
        let wanted = url.trim().trim_end_matches('/');
        Ok(self.notes_with_content()?.into_iter().map(|(n, _)| n).find(|n| {
            n.folder_id.as_deref() != Some("archive")
                && n.properties.iter().any(|p| p.key.eq_ignore_ascii_case(URL_KEY) && matches!(&p.value, PropertyValue::Text(t) | PropertyValue::Url(t) if t.trim().trim_end_matches('/') == wanted))
        }))
    }

    /// A new `Link` note for `url`, from what `page` says (or just the address,
    /// when it couldn't be read), started from the Link Template if there is one.
    pub fn create_web_link(&self, url: &str, page: Option<&PageInfo>, folder_id: Option<String>) -> Result<Note, String> {
        let url = web_url(url).ok_or("only http and https links can be saved")?;
        let title = page.and_then(|p| p.title.clone()).unwrap_or_else(|| url_title(url));
        // Titles are one line, and `[[` in one would break links to it.
        let title = title.replace(['[', ']'], "").replace('\n', " ");
        let template = self.type_template(LINK_TYPE)?;
        let name = template.as_ref().and_then(|(n, _)| template_type(&n.title)).unwrap_or_else(|| LINK_TYPE.to_string());
        let (mut properties, template_body) = from_template(&name, &title, template.as_ref().map(|(n, c)| (n, c.as_str())), &self.type_names()?, Local::now().date_naive());
        let mut set = |key: &str, value: &str| match properties.iter_mut().find(|p| p.key.eq_ignore_ascii_case(key)) {
            Some(p) => p.value = PropertyValue::Text(value.to_string()),
            None => properties.push(Property { key: key.to_string(), value: PropertyValue::Text(value.to_string()) }),
        };
        set(URL_KEY, url);
        if let Some(site) = page.and_then(|p| p.site.as_deref()) {
            set(SITE_KEY, site);
        }
        let mut content = format!("# {title}\n");
        for block in [page.map(link_body).unwrap_or_default(), template_body] {
            if !block.trim().is_empty() {
                content = append_block(&content, &block);
            }
        }
        self.create_note_with(folder_id, &content, None, &properties)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = r#"<!doctype html><html><head>
<meta charset="utf-8"><title>Ignored &amp; overridden</title>
<meta property="og:title" content="Local-first software: you own your data">
<meta name="description" content="A manifesto for apps that keep your data on your devices.">
<meta property="og:site_name" content='Ink &amp; Switch'>
<script>if (a < b) { document.write("<p>not text</p>") }</script>
</head><body>
<nav><p>Home, About, a long menu that should never be mistaken for the article itself</p></nav>
<p>A sidebar paragraph outside the article that is long enough to count as text.</p>
<article>
<h1>Local-first software</h1>
<p>By <a href="/team">the team</a></p>
<p>Cloud apps like Google Docs and Trello are popular because they enable real-time collaboration&nbsp;with colleagues.</p>
<!-- <p>commented out paragraph that is long enough to otherwise be picked up</p> -->
<figure><img src="x.png"><figcaption>A caption long enough to be a paragraph if it were one, but it is not.</figcaption></figure>
<p>But they take away ownership: the data lives on servers, and <em>you</em> are a tenant &#8212; see [[this]] and <code>&lt;query /&gt;</code>.</p>
</article></body></html>"#;

    #[test]
    fn reads_title_description_site_and_opening_text() {
        let info = page_info(PAGE);
        assert_eq!(info.title.as_deref(), Some("Local-first software: you own your data"));
        assert_eq!(info.description.as_deref(), Some("A manifesto for apps that keep your data on your devices."));
        assert_eq!(info.site.as_deref(), Some("Ink & Switch"));
        assert_eq!(info.opening, vec![
            "Cloud apps like Google Docs and Trello are popular because they enable real-time collaboration with colleagues.".to_string(),
            "But they take away ownership: the data lives on servers, and you are a tenant — see [[this]] and <query />.".to_string(),
        ], "the article's paragraphs: no byline, nav, sidebar, comment, caption or script");
        let fallback = page_info("<html><head><title>\n  Plain   page </title></head><body><div>Short.</div></body></html>");
        assert_eq!(fallback, PageInfo { title: Some("Plain page".into()), ..Default::default() });
    }

    #[test]
    fn only_web_addresses_are_fetched() {
        assert_eq!(web_url(" https://example.com/a?b=1 "), Some("https://example.com/a?b=1"));
        assert_eq!(web_url("http://example.com"), Some("http://example.com"));
        assert_eq!(web_url("file:///etc/passwd"), None);
        assert_eq!(web_url("https://"), None);
        assert_eq!(web_url("https://example.com/a b"), None);
        assert!(fetch_page("file:///etc/passwd").is_err());
        assert_eq!(url_title("https://www.example.com/blog/post/?utm=x#top"), "example.com/blog/post");
    }

    #[test]
    fn saves_a_link_note_from_the_page_and_its_template() {
        let root = std::env::temp_dir().join(format!("tagdown-weblink-{}", uuid::Uuid::new_v4()));
        let vault = Vault::open_or_create(root.clone()).unwrap();
        let template = vault.create_note(None).unwrap();
        vault.save_note(&template.id, "# Link Template\n\n## Why I saved it\n".into()).unwrap();
        vault.set_property(&template.id, "read", Some(PropertyValue::Checkbox(false)), None).unwrap();
        let url = "https://www.inkandswitch.com/local-first/";
        let note = vault.create_web_link(url, Some(&page_info(PAGE)), None).unwrap();
        assert_eq!(note.title, "Local-first software: you own your data");
        let value = |key: &str| note.properties.iter().find(|p| p.key == key).map(|p| p.value.clone());
        assert_eq!(value("type"), Some(PropertyValue::Text("Link".into())));
        assert_eq!(value("url"), Some(PropertyValue::Text(url.into())));
        assert_eq!(value("site"), Some(PropertyValue::Text("Ink & Switch".into())));
        assert_eq!(value("read"), Some(PropertyValue::Checkbox(false)), "the template's properties come along");
        let content = vault.get_note_content(&note.id).unwrap().content;
        assert_eq!(content, "# Local-first software: you own your data\n\n> A manifesto for apps that keep your data on your devices.\n\nCloud apps like Google Docs and Trello are popular because they enable real-time collaboration with colleagues.\n\nBut they take away ownership: the data lives on servers, and you are a tenant — see \\[\\[this]] and &lt;query />.\n\n## Why I saved it\n");
        assert_eq!(vault.find_web_link("https://www.inkandswitch.com/local-first").unwrap().map(|n| n.id), Some(note.id));
        assert!(vault.find_web_link("https://example.com").unwrap().is_none());

        let bare = vault.create_web_link("https://example.com/post", None, None).unwrap();
        assert_eq!(bare.title, "example.com/post");
        assert_eq!(vault.get_note_content(&bare.id).unwrap().content, "# example.com/post\n\n## Why I saved it\n");
        std::fs::remove_dir_all(root).ok();
    }
}
