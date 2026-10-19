import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './styles/capture.css';

type Connection = { endpoint: string; token: string; available: boolean; error?: string; shortcutError?: string };

/** The backend brings the main window forward before requesting the existing capture dialog. */
export async function initializeCapture(open: () => void): Promise<() => void> {
  return listen('quick-capture', () => open());
}

export async function openCaptureSetup(): Promise<void> {
  const existing = document.querySelector<HTMLDialogElement>('.clipper-setup');
  if (existing) { existing.focus(); return; }
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog clipper-setup';
  dialog.setAttribute('aria-label', 'Browser clipper setup');
  dialog.innerHTML = `<form class="confirm-shell" method="dialog">
    <h2 class="confirm-title">Browser clipper setup</h2>
    <p class="confirm-detail">Install the Tagdown Clipper extension in Chrome or Chromium, then paste this pairing token into its popup.</p>
    <p class="clipper-status" role="status">Loading local connection…</p>
    <label class="clipper-label">Pairing token<input class="clipper-token" readonly spellcheck="false" aria-label="Pairing token"></label>
    <p class="confirm-detail">Captures save to the active vault. When Tagdown is closed, the extension keeps them queued on this computer and retries after it opens. Keep this token private.</p>
    <p class="clipper-shortcut confirm-detail">Quick capture from any app: ⌥⌘J on macOS, Ctrl+Alt+J on Windows and Linux.</p>
    <div class="confirm-actions"><button class="confirm-button is-primary" value="close">Done</button></div>
  </form>`;
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  try {
    const connection = await invoke<Connection>('capture_connection');
    const token = dialog.querySelector<HTMLInputElement>('.clipper-token')!;
    token.value = connection.token;
    token.addEventListener('focus', () => token.select());
    dialog.querySelector('.clipper-status')!.textContent = connection.available ? `Ready at ${connection.endpoint}` : connection.error || 'Local capture receiver is unavailable. Restart Tagdown to retry.';
    if (connection.shortcutError) dialog.querySelector('.clipper-shortcut')!.textContent = `Global shortcut unavailable: ${connection.shortcutError}. Quick capture is still available inside Tagdown.`;
  } catch (failure) {
    dialog.querySelector('.clipper-status')!.textContent = `Could not load connection: ${String(failure)}`;
  }
}
