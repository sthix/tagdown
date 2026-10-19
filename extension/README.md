# Tagdown Clipper

The clipper saves selected text, page text, or a link into the active local Tagdown vault. Each note includes the page title, source URL, capture time, and the selected excerpt when present. Page text comes from the current rendered article or main element, falling back to visible body text. It does not bypass browser access restrictions.

## Install and pair

1. Start the Tagdown desktop app.
2. In Chrome or Chromium, open the extensions manager, enable Developer mode, choose **Load unpacked**, and select this `extension` directory.
3. In Tagdown's command palette, run **Browser clipper setup**. Select and copy the pairing token.
4. Open the clipper popup, expand **Pair with Tagdown**, paste the token, and save.
5. On a web page, choose **Save selected text**, **Save page text**, or **Save link only**. The popup confirms saving or reports that the capture is queued.

The extension only reads a page after you click a capture button. Restricted browser pages, browser stores, and file URLs cannot be clipped. Page text is limited to 45,000 UTF-16 characters, selected text to 18,000. Screenshots and HTML formatting are not captured.

## Offline delivery

The extension persists captures in `chrome.storage.local` before sending. It removes an item only after Tagdown acknowledges the same capture UUID. It retries every minute while Chrome runs and when you click **Deliver queued captures**. The badge shows pending captures. A queue holds up to 100 captures or 8 MB, whichever comes first; a full queue refuses new captures without discarding pending items. Do not uninstall the extension or clear its storage while captures are pending.

New captures use the vault active on their first delivery attempt. Tagdown reserves that destination before saving, so retries stay in the original vault even after an app crash or vault switch. If that vault becomes unavailable, the capture remains queued until it is restored. Notes remain ordinary Markdown files in the vault root. Repeated delivery of the same UUID uses the same note, even if the note moved within its vault. Keep Tagdown running to receive them. A second app instance cannot bind the same receiver port and displays an error in setup.

## Local connection

The app listens only on `127.0.0.1:43827`. Each request must carry a random per-user 64-character pairing token and a Chrome extension origin. The token is stored in Tagdown's app configuration directory as `capture-token`, with owner-only file permissions on Unix. The extension stores its pairing token locally. Web page origins cannot access the receiver. Responses never include the token or vault contents. Delete `capture-token` and restart Tagdown to generate a fresh token, then pair the extension again.

The loopback service is intentionally small: it accepts only bounded JSON captures and has no read, delete, arbitrary file path, or execution endpoint. Captured text is escaped so a page cannot insert active Tagdown syntax. The receiver may be blocked by enterprise browser or local network policies; queued captures remain available for retry.

## Quick capture

With Tagdown running, press **Option+Command+J** on macOS or **Ctrl+Alt+J** on Windows/Linux from any app. Tagdown brings its main window forward and opens the quick capture dialog. Enter submits to today's journal; Shift+Enter inserts a line. Shortcut registration conflicts appear in Browser clipper setup. This implementation uses the existing main window and does not create a floating capture window.

## Development checks

Run `node --test tests/captureQueue.test.mjs tests/captureWorker.test.mjs` from the repository root and `cargo test --manifest-path src-tauri/Cargo.toml commands::capture::tests --lib`. Manual integration: pair, save selected and page text, quit Tagdown, queue a capture, restart, retry, and verify exactly one note exists. Test with two vaults to confirm delivery follows the active vault.

Global shortcut integration uses the [official Tauri global shortcut plugin](https://v2.tauri.app/plugin/global-shortcut/).
