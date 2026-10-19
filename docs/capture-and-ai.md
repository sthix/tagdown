---
title: Capture, meetings, and AI
---

# Capture, meetings, and AI

The command palette (**⌘K**) opens all the workflows below. Browser pairing and AI provider configuration are also available under **Settings → Integrations**.

## Capture from another app

While Tagdown is running, **⌥⌘J** brings its main window forward and opens Quick capture. Enter adds your text to today's journal; Shift+Enter adds a new line. You can also capture the text as a task. If another app owns the shortcut, Browser clipper setup reports the conflict and the in-app command remains available.

This uses the main window, rather than a separate floating capture window.

## Capture from a browser

The included Chrome/Chromium extension saves a selection, page text, or the page URL into a source-attributed Markdown note. Each capture retains the title, source link, and capture time.

1. Start Tagdown.
2. Load the repository's `extension/` folder as an unpacked extension in your browser's extensions manager.
3. Open **Settings → Integrations → Pair browser extension** or run **Browser clipper setup** in the palette.
4. Copy the pairing token into the extension popup and save it.
5. Choose **Save selected text**, **Save page text**, or **Save link only** on a web page.

The extension queues captures while Tagdown is closed. It removes a capture only after the app confirms saving it, and retries without creating duplicate notes. The first delivery reserves the destination vault; later retries stay with that vault even if you switch vaults. If the destination becomes unavailable, the capture stays queued.

Page text is limited to 45,000 UTF-16 characters and selections to 18,000. The queue holds up to 100 captures or 8 MB. Captures are plain text; this version does not capture screenshots or retain page HTML. Restricted browser pages cannot be captured.

The receiver runs on this computer's loopback address and requires the paired extension token. See [extension setup and troubleshooting](../extension/README.md) for limits and delivery details.

## Connect notes with aliases

Add an `aliases` property to a note to give it alternate names:

```yaml
aliases: [Sam, Samuel]
```

Typing `[[Sam` can now suggest the note titled “Samuel Rivera”. Suggestions consider title, path, and alias match quality, then recency and available backlink counts. Exact titles and file paths take precedence over aliases. A shared alias does not resolve until you disambiguate it with a title or path.

Aliases work in note links, backlinks, the local graph, block references, CLI, and MCP. A label such as `[[Samuel Rivera|Sam]]` is still just that link's visible label; it does not add an alias.

## Insert a reusable template

Type **`/template`** in a source or preview block editor and choose an enabled template. The picker inserts the template body without its title or frontmatter. It expands `{{title}}`, `{{date}}`, `{{weekday}}`, `{{yesterday}}`, and `{{tomorrow}}`, using the journal page's date when relevant. Other placeholders stay as written.

The inserted text is editable and can be undone with **⌘Z**. This inserts content into the existing note; creating a typed note still applies the template's properties as usual.

## Create linked meeting notes

Run **Create meeting note** from the palette. Enter the meeting name and day, then add people, a project, and optionally a recurring series. Put each attendee on a separate line.

Tagdown reuses matching notes and aliases. New people become Person notes, a new project becomes a Project note, and a named series groups its occurrences. The meeting starts from your enabled Meeting template, links its related notes through properties, and adds a link to that day's journal. Attendees and projects already assigned an incompatible note type must be corrected before creating the meeting.

### Import calendar events

Choose **Import calendar (.ics)** in the meeting dialog and select an export from your calendar app. Filter the events, select one, review the details, then create its meeting note. Importing the same event again opens the existing note. If that note is archived, restore it first.

This is a local file import. It does not connect to a live Google, Outlook, or Apple account or write events back to a calendar. Recurrence overrides remain separate occurrences, but recurrence rules are not expanded into future meetings. UTC times are converted to the computer's local time; named time zones retain their exported wall time and zone label. Review the day and time before creating a note.

## Optional AI

Open **Settings → Integrations → Configure AI** or run **AI provider settings**. Enable a provider and supply an OpenAI-compatible API base URL, chat model, embedding model, and transcription model. Remote providers require HTTPS; local providers may use HTTP on localhost. Provider usage is billed by your provider.

The API key is stored outside the vault in a private application configuration file, with owner-only permissions on macOS. It is not stored in browser storage or returned to the editor. This version does not use Keychain.

### Writing actions

Select text in the editor, then run **AI writing actions** from the palette or the note's More menu. Choose Summarize, Improve writing, Extract tasks, or your own instruction. You can save named instructions in AI provider settings.

Only the selection and instruction are sent for this action. Review or edit the result before replacing the selection or inserting after it. Applying can be undone, and a local version snapshot is retained. If the note changes while the request runs, applying the stale result is blocked. Closing the dialog cancels further processing; a provider request already in flight may still finish.

### Related notes and questions

Run **Ask this vault** or **Find related notes**, then choose **Build / update semantic index**. This explicitly sends eligible note titles and each note's first 12,000 characters to the configured embedding provider. The vectors stay in memory until Tagdown quits, so rebuild after a restart. Rebuilding updates changed notes; search skips stale, deleted, archived, and excluded entries.

Related notes uses embedding similarity. Vault questions send the five closest indexed excerpts to the chat provider and display clickable source citations. Check those sources when assessing an answer. This initial index uses note-level excerpts, so information beyond a long note's first 12,000 characters is not included.

### Exclude a note from AI

Choose **Exclude note from AI** in the note's More menu or palette, or set:

```yaml
ai_exclude: true
```

The policy blocks integrated AI reads, transcription, and semantic retrieval, plus MCP reads, searches, queries, tasks, backlinks, and template access. Archived notes are also excluded. Ordinary local editing and CLI access remain available. This is an access policy, not encryption, and it does not remove the note from filesystem backups or Git.

### Voice notes

Run **Record voice note** from the palette or note menu and allow microphone access. Stop the recording to preview it. **Save recording** stores the audio under the vault's `attachments/` folder. **Transcribe with provider** sends the recording to the configured transcription service and returns an editable transcript. **Insert audio and transcript** adds a portable audio link and the reviewed text to the note.

Recording stays local until you explicitly request transcription. Clips are limited to 15 minutes and 24 MB. A note excluded from AI can keep a local recording, but its audio cannot be sent for transcription. Native microphone permissions and codec availability depend on the macOS webview.
