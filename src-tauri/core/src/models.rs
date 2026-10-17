use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::properties::Property;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortOrder {
    UpdatedDesc,
    CreatedDesc,
    TitleAsc,
    TitleDesc,
    WordCountDesc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub tags: Vec<String>,
    pub starred: bool,
    pub folder_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub word_count: u32,
    /// The day this note is the journal page for, if it is one.
    #[serde(default)]
    pub journal: Option<NaiveDate>,
    /// Custom frontmatter entries as typed values.
    #[serde(default)]
    pub properties: Vec<Property>,
    /// The note's file relative to the vault, `/`-separated (`blog/post.md`).
    /// Wikilinks can name a note by it, as Obsidian writes them.
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: u32,
    pub note_count: u32,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub note: Note,
    pub excerpt: String,
    /// Matched ranges in `excerpt`, as UTF-16 offsets (JavaScript string indices).
    pub highlights: Vec<[u32; 2]>,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRecord {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMeta {
    pub version: u32,
    pub name: String,
    pub created: DateTime<Utc>,
    pub folders: Vec<FolderRecord>,
    #[serde(default)]
    pub tags: Vec<TagRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRecord {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: u32,
    pub icon: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NoteFrontmatter {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub starred: bool,
    pub folder_id: Option<String>,
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
    pub journal: Option<NaiveDate>,
    /// Frontmatter entries Tagdown doesn't manage, kept verbatim (one entry
    /// per item, continuation lines included) so saving never drops them.
    pub extra: Vec<String>,
}
