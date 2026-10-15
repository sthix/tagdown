// Full-text search over the vault, backed by a Tantivy index in
// `.tagdown/search.idx/`. The index is rebuilt from the notes on launch and
// kept current as notes are saved, moved, starred, and deleted.
//
// Query syntax: plain words (all must match; the last one also matches as a
// prefix while typing), "exact phrases", `title:word`, `tag:path` (nested tags
// included), and `-` to exclude any of those. Archived notes are never returned.

use std::{fs, path::Path, sync::Mutex};

use tantivy::{
    collector::TopDocs,
    query::{AllQuery, BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, PhraseQuery, Query, TermQuery},
    schema::{Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, STORED, STRING},
    tokenizer::{AsciiFoldingFilter, LowerCaser, RemoveLongFilter, SimpleTokenizer, TextAnalyzer},
    Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term,
};

use crate::models::{Note, SearchResult};

const TOKENIZER: &str = "tagdown";
const MAX_RESULTS: usize = 30;
const TITLE_BOOST: f32 = 3.0;
const WRITER_MEMORY: usize = 20_000_000;
const EXCERPT_LEAD: usize = 50;
const EXCERPT_LEN: usize = 200;

#[derive(Clone, Copy)]
struct Fields {
    id: Field,
    title: Field,
    body: Field,
    tag: Field,
    folder: Field,
    note: Field,
}

pub struct SearchIndex {
    reader: IndexReader,
    writer: Mutex<IndexWriter>,
    fields: Fields,
}

fn schema() -> (Schema, Fields) {
    let text = TextOptions::default()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer(TOKENIZER)
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        )
        .set_stored();
    let mut builder = Schema::builder();
    let fields = Fields {
        id: builder.add_text_field("id", STRING | STORED),
        title: builder.add_text_field("title", text.clone()),
        body: builder.add_text_field("body", text),
        tag: builder.add_text_field("tag", STRING),
        folder: builder.add_text_field("folder", STRING),
        note: builder.add_text_field("note", STORED),
    };
    (builder.build(), fields)
}

/// Lowercase, accent-folded words. Used for both indexing and queries.
fn analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(RemoveLongFilter::limit(40))
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .build()
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl SearchIndex {
    /// Open the index in `dir`, recreating it when it is missing, unreadable,
    /// or was written with a different schema.
    pub fn open(dir: &Path) -> Result<Self, String> {
        let (schema, fields) = schema();
        let index = match Index::open_in_dir(dir) {
            Ok(index) if index.schema() == schema => index,
            _ => {
                let _ = fs::remove_dir_all(dir);
                fs::create_dir_all(dir).map_err(err)?;
                Index::create_in_dir(dir, schema).map_err(err)?
            }
        };
        Self::with_index(index, fields)
    }

    /// An index that lives only in memory, for tools that read the vault while
    /// the app holds the on-disk index.
    pub fn in_memory() -> Result<Self, String> {
        let (schema, fields) = schema();
        Self::with_index(Index::create_in_ram(schema), fields)
    }

    fn with_index(index: Index, fields: Fields) -> Result<Self, String> {
        index.tokenizers().register(TOKENIZER, analyzer());
        let writer = index.writer_with_num_threads(1, WRITER_MEMORY).map_err(err)?;
        let reader = index.reader_builder().reload_policy(ReloadPolicy::Manual).try_into().map_err(err)?;
        Ok(Self { reader, writer: Mutex::new(writer), fields })
    }

    /// Replace the whole index with `notes`.
    pub fn rebuild(&self, notes: Vec<(Note, String)>) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(err)?;
        writer.delete_all_documents().map_err(err)?;
        for (note, content) in &notes {
            self.add(&writer, note, content)?;
        }
        self.commit(&mut writer)
    }

    pub fn upsert(&self, note: &Note, content: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(err)?;
        self.add(&writer, note, content)?;
        self.commit(&mut writer)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(err)?;
        writer.delete_term(Term::from_field_text(self.fields.id, id));
        self.commit(&mut writer)
    }

    fn add(&self, writer: &IndexWriter, note: &Note, content: &str) -> Result<(), String> {
        let f = self.fields;
        writer.delete_term(Term::from_field_text(f.id, &note.id));
        let mut doc = TantivyDocument::default();
        doc.add_text(f.id, &note.id);
        doc.add_text(f.title, &note.title);
        doc.add_text(f.body, plain_text(content));
        for path in tag_paths(&note.tags) {
            doc.add_text(f.tag, path);
        }
        doc.add_text(f.folder, note.folder_id.as_deref().unwrap_or(""));
        doc.add_text(f.note, serde_json::to_string(note).map_err(err)?);
        writer.add_document(doc).map_err(err)?;
        Ok(())
    }

    fn commit(&self, writer: &mut IndexWriter) -> Result<(), String> {
        writer.commit().map_err(err)?;
        self.reader.reload().map_err(err)
    }

    /// Ids of notes matching `raw`, best first, without building excerpts.
    pub fn matching_ids(&self, raw: &str, limit: usize) -> Result<Vec<String>, String> {
        let parsed = parse_query(raw);
        let Some(query) = self.build_query(&parsed, &mut analyzer()) else { return Ok(Vec::new()) };
        let searcher = self.reader.searcher();
        let hits = searcher.search(&query, &TopDocs::with_limit(limit).order_by_score()).map_err(err)?;
        let mut ids = Vec::with_capacity(hits.len());
        for (_, address) in hits {
            let doc: TantivyDocument = searcher.doc(address).map_err(err)?;
            if let Some(id) = doc.get_first(self.fields.id).and_then(|v| v.as_str()) {
                ids.push(id.to_string());
            }
        }
        Ok(ids)
    }

    pub fn search(&self, raw: &str) -> Result<Vec<SearchResult>, String> {
        let parsed = parse_query(raw);
        let mut analyzer = analyzer();
        let Some(query) = self.build_query(&parsed, &mut analyzer) else { return Ok(Vec::new()) };
        let highlight_terms = highlight_terms(&parsed, &mut analyzer);

        let searcher = self.reader.searcher();
        let hits = searcher.search(&query, &TopDocs::with_limit(MAX_RESULTS).order_by_score()).map_err(err)?;
        let mut results = Vec::with_capacity(hits.len());
        for (score, address) in hits {
            let doc: TantivyDocument = searcher.doc(address).map_err(err)?;
            let text = |field| doc.get_first(field).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let Ok(note) = serde_json::from_str::<Note>(&text(self.fields.note)) else { continue };
            let (excerpt, highlights) = excerpt(&text(self.fields.body), &highlight_terms, &mut analyzer);
            results.push(SearchResult { note, excerpt, highlights, score });
        }
        Ok(results)
    }

    fn build_query(&self, parsed: &ParsedQuery, analyzer: &mut TextAnalyzer) -> Option<Box<dyn Query>> {
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        for clause in &parsed.include {
            clauses.push((Occur::Must, self.clause_query(clause, analyzer)?));
        }
        let has_positive = !clauses.is_empty();
        for clause in &parsed.exclude {
            if let Some(query) = self.clause_query(clause, analyzer) {
                clauses.push((Occur::MustNot, query));
            }
        }
        if !has_positive {
            if clauses.is_empty() {
                return None;
            }
            clauses.push((Occur::Must, Box::new(AllQuery)));
        }
        let archive = Term::from_field_text(self.fields.folder, "archive");
        clauses.push((Occur::MustNot, Box::new(TermQuery::new(archive, IndexRecordOption::Basic))));
        Some(Box::new(BooleanQuery::new(clauses)))
    }

    /// The query for one clause, or `None` when it has no searchable words.
    fn clause_query(&self, clause: &Clause, analyzer: &mut TextAnalyzer) -> Option<Box<dyn Query>> {
        let f = self.fields;
        match clause {
            Clause::Tag { path, prefix } => {
                let term = Term::from_field_text(f.tag, path);
                Some(if *prefix {
                    Box::new(FuzzyTermQuery::new_prefix(term, 0, true))
                } else {
                    Box::new(TermQuery::new(term, IndexRecordOption::Basic))
                })
            }
            Clause::Text { text, title_only, prefix } => {
                let terms = analyze(analyzer, text);
                if terms.is_empty() {
                    return None;
                }
                let title = Box::new(BoostQuery::new(field_query(f.title, &terms, *prefix), TITLE_BOOST));
                if *title_only {
                    return Some(title);
                }
                Some(Box::new(BooleanQuery::new(vec![
                    (Occur::Should, title as Box<dyn Query>),
                    (Occur::Should, field_query(f.body, &terms, *prefix)),
                ])))
            }
        }
    }
}

/// One word (`prefix` allowed) or a phrase of several words in one field.
fn field_query(field: Field, terms: &[String], prefix: bool) -> Box<dyn Query> {
    let to_term = |t: &String| Term::from_field_text(field, t);
    match terms {
        [only] if prefix => Box::new(FuzzyTermQuery::new_prefix(to_term(only), 0, true)),
        [only] => Box::new(TermQuery::new(to_term(only), IndexRecordOption::WithFreqs)),
        many => Box::new(PhraseQuery::new(many.iter().map(to_term).collect())),
    }
}

fn analyze(analyzer: &mut TextAnalyzer, text: &str) -> Vec<String> {
    let mut stream = analyzer.token_stream(text);
    let mut terms = Vec::new();
    while let Some(token) = stream.next() {
        terms.push(token.text.clone());
    }
    terms
}

/// A tag and each of its ancestors, so `tag:project` also finds `project/active`.
fn tag_paths(tags: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    for tag in tags {
        let parts: Vec<&str> = tag.split('/').filter(|p| !p.is_empty()).collect();
        for end in 1..=parts.len() {
            let path = parts[..end].join("/").to_lowercase();
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths
}

// ---- Query parsing ----

#[derive(Debug, PartialEq)]
enum Clause {
    Text { text: String, title_only: bool, prefix: bool },
    Tag { path: String, prefix: bool },
}

#[derive(Debug, Default, PartialEq)]
struct ParsedQuery {
    include: Vec<Clause>,
    exclude: Vec<Clause>,
}

fn parse_query(raw: &str) -> ParsedQuery {
    let chars: Vec<char> = raw.chars().collect();
    let mut parsed = ParsedQuery::default();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        let negated = chars[i] == '-';
        if negated {
            i += 1;
        }
        // Optional `tag:` / `title:` qualifier.
        let rest: String = chars[i..].iter().take(6).collect::<String>().to_lowercase();
        let qualifier = if rest.starts_with("title:") {
            Some("title")
        } else if rest.starts_with("tag:") {
            Some("tag")
        } else {
            None
        };
        i += qualifier.map_or(0, |q| q.len() + 1);

        let quoted = chars.get(i) == Some(&'"');
        let start = if quoted { i + 1 } else { i };
        let mut end = start;
        while end < chars.len() && (if quoted { chars[end] != '"' } else { !chars[end].is_whitespace() }) {
            end += 1;
        }
        let text: String = chars[start..end].iter().collect();
        i = if quoted { end + 1 } else { end };

        // The word still being typed matches as a prefix.
        let prefix = !negated && !quoted && end == chars.len();
        let clause = match qualifier {
            Some("tag") => {
                let path = text.trim_start_matches('#').split('/').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("/").to_lowercase();
                if path.is_empty() {
                    continue;
                }
                Clause::Tag { path, prefix }
            }
            _ => {
                if text.trim().is_empty() {
                    continue;
                }
                Clause::Text { text, title_only: qualifier == Some("title"), prefix }
            }
        };
        if negated {
            parsed.exclude.push(clause);
        } else {
            parsed.include.push(clause);
        }
    }
    parsed
}

// ---- Excerpts ----

/// Terms to mark in excerpts, with whether each may match as a prefix.
fn highlight_terms(parsed: &ParsedQuery, analyzer: &mut TextAnalyzer) -> Vec<(String, bool)> {
    let mut terms = Vec::new();
    for clause in &parsed.include {
        if let Clause::Text { text, title_only: false, prefix } = clause {
            let words = analyze(analyzer, text);
            let single = words.len() == 1;
            terms.extend(words.into_iter().map(|w| (w, *prefix && single)));
        }
    }
    terms
}

/// A window of the body around the first match, plus the matched ranges in
/// UTF-16 code units (JavaScript string indices) relative to the excerpt.
fn excerpt(body: &str, terms: &[(String, bool)], analyzer: &mut TextAnalyzer) -> (String, Vec<[u32; 2]>) {
    let mut matches: Vec<(usize, usize)> = Vec::new();
    if !terms.is_empty() {
        let mut stream = analyzer.token_stream(body);
        while let Some(token) = stream.next() {
            let hit = terms.iter().any(|(term, prefix)| token.text == *term || (*prefix && token.text.starts_with(term.as_str())));
            if hit {
                matches.push((token.offset_from, token.offset_to));
            }
        }
    }

    let anchor = matches.first().map_or(0, |m| m.0);
    let mut start = floor_char_boundary(body, anchor.saturating_sub(EXCERPT_LEAD));
    if start > 0 {
        // Begin on a word boundary rather than mid-word.
        start = body[start..anchor].find(char::is_whitespace).map_or(start, |ws| start + ws + 1);
    }
    let first_end = matches.first().map_or(0, |m| m.1);
    let mut end = floor_char_boundary(body, (start + EXCERPT_LEN).min(body.len()));
    if end < body.len() {
        // End on a word boundary, but never before the first match.
        if let Some(ws) = body[start..end].rfind(char::is_whitespace) {
            end = (start + ws).max(first_end);
        }
    }

    let lead = if start > 0 { "…" } else { "" };
    let tail = if end < body.len() { "…" } else { "" };
    let excerpt = format!("{lead}{}{tail}", body[start..end].trim_end());
    let utf16 = |s: &str| s.encode_utf16().count() as u32;
    let base = utf16(lead);
    let highlights = matches
        .into_iter()
        .filter(|&(from, to)| from >= start && to <= end)
        .map(|(from, to)| {
            let a = base + utf16(&body[start..from]);
            [a, a + utf16(&body[from..to])]
        })
        .collect();
    (excerpt, highlights)
}

fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Note body as readable text: Tagdown/Markdown markup removed, one line.
pub fn plain_text(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim();
        let is_markup_only = trimmed.starts_with("```")
            || trimmed.starts_with("~~~")
            || trimmed.starts_with(":::")
            || trimmed == "$$"
            || trimmed.chars().all(|c| c == '-' || c == '*' || c == '_') && trimmed.len() >= 3
            || (trimmed.starts_with('<') && trimmed.ends_with('>'));
        if trimmed.is_empty() || is_markup_only {
            continue;
        }
        let text = crate::links::strip_line_marker(trimmed);
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&strip_inline(text));
    }
    out
}

fn strip_inline(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        match c {
            // Paired emphasis markers and inline code ticks.
            '*' | '=' | '~' if next == Some(c) => i += 2,
            '`' => i += 1,
            '[' if next == Some('[') => i += 2,
            ']' if next == Some(']') => i += 2,
            '|' if out.ends_with(|ch: char| !ch.is_whitespace()) => {
                out.push(' ');
                i += 1;
            }
            // [label](url) and ![alt](src) keep only the label.
            '!' if next == Some('[') => i += 1,
            ']' if next == Some('(') => {
                i += 2;
                while i < chars.len() && chars[i] != ')' {
                    i += 1;
                }
                i += 1;
            }
            '[' => i += 1,
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn note(id: &str, title: &str, tags: &[&str], folder: Option<&str>) -> Note {
        Note {
            id: id.into(),
            title: title.into(),
            preview: String::new(),
            tags: tags.iter().map(|t| t.to_string()).collect(),
            starred: false,
            folder_id: folder.map(Into::into),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            word_count: 0,
            journal: None,
            properties: Vec::new(),
        }
    }

    fn index() -> (SearchIndex, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("tagdown-search-{}", uuid::Uuid::new_v4()));
        let index = SearchIndex::open(&dir).unwrap();
        index
            .rebuild(vec![
                (note("a", "Photosynthesis", &["biology/plants"], None), "# Photosynthesis\n\nPlants turn **light** into sugar. Über alles.".into()),
                (note("b", "Meeting notes", &["work"], None), "# Meeting notes\n\nWe discussed the light rail budget and the new office.".into()),
                (note("c", "Old plan", &["work"], Some("archive")), "# Old plan\n\nLight everything.".into()),
            ])
            .unwrap();
        (index, dir)
    }

    fn ids(index: &SearchIndex, q: &str) -> Vec<String> {
        let mut ids: Vec<String> = index.search(q).unwrap().into_iter().map(|r| r.note.id).collect();
        ids.sort();
        ids
    }

    #[test]
    fn searches_body_title_tags_phrases_and_exclusions() {
        let (index, dir) = index();
        assert_eq!(ids(&index, "light"), vec!["a", "b"], "body match, archive excluded");
        assert_eq!(ids(&index, "budget office"), vec!["b"], "all words must match");
        assert_eq!(ids(&index, "photo"), vec!["a"], "last word matches as a prefix");
        assert_eq!(ids(&index, "photo "), Vec::<String>::new(), "finished words match exactly");
        assert_eq!(ids(&index, "\"light rail\""), vec!["b"]);
        assert_eq!(ids(&index, "light -rail"), vec!["a"]);
        assert_eq!(ids(&index, "tag:biology"), vec!["a"], "parent tag finds nested tags");
        assert_eq!(ids(&index, "-tag:work"), vec!["a"]);
        assert_eq!(ids(&index, "title:meeting light"), vec!["b"]);
        assert_eq!(ids(&index, "uber"), vec!["a"], "accents are folded");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn upsert_and_remove_update_results() {
        let (index, dir) = index();
        index.upsert(&note("b", "Meeting notes", &["work"], None), "Nothing about trains now").unwrap();
        assert_eq!(ids(&index, "rail"), Vec::<String>::new());
        index.remove("a").unwrap();
        assert_eq!(ids(&index, "light"), Vec::<String>::new());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn title_matches_rank_first() {
        let (index, dir) = index();
        index.upsert(&note("d", "Light", &[], None), "Short note.").unwrap();
        assert_eq!(index.search("light").unwrap()[0].note.id, "d");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn excerpt_highlights_match_in_utf16_units() {
        let (index, dir) = index();
        let result = index.search("über").unwrap().remove(0);
        let units: Vec<u16> = result.excerpt.encode_utf16().collect();
        let [a, b] = result.highlights[0];
        assert_eq!(String::from_utf16(&units[a as usize..b as usize]).unwrap(), "Über");
        assert!(!result.excerpt.contains("**"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn parses_qualifiers_quotes_and_negation() {
        let parsed = parse_query("tag:#Work/ \"exact words\" -title:draft wri");
        assert_eq!(parsed.include, vec![
            Clause::Tag { path: "work".into(), prefix: false },
            Clause::Text { text: "exact words".into(), title_only: false, prefix: false },
            Clause::Text { text: "wri".into(), title_only: false, prefix: true },
        ]);
        assert_eq!(parsed.exclude, vec![Clause::Text { text: "draft".into(), title_only: true, prefix: false }]);
    }

    #[test]
    fn plain_text_drops_markup() {
        let text = plain_text("# Title\n\n::: info\nSee [the docs](https://x.y) and [[Other|label]].\n:::\n\n```js\ncode()\n```\n<tabs>\n**bold** ==mark==\n- [ ] Open task\n  - [x] Done task\n1. First");
        assert_eq!(text, "Title See the docs and Other label. code() bold mark Open task Done task First");
    }
}
