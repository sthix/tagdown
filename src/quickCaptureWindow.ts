import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { initializeTheme } from './settings/theme';
import { mountQuickCapture, type CaptureResult } from './quickCapture';
import './styles/tokens.css';

async function initializeCaptureWindow() {
  initializeTheme();
  document.documentElement.classList.add('capture-window');
  const windowHandle = getCurrentWindow();
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  await listen<CaptureResult>('quick-capture-result', ({ payload }) => {
    const request = pending.get(payload.id);
    if (!request) return;
    pending.delete(payload.id);
    if (payload.error) request.reject(new Error(payload.error));
    else request.resolve();
  });
  const capture = mountQuickCapture(document.querySelector<HTMLElement>('#app')!, {
    close: () => { void windowHandle.hide(); },
    resize: height => { void windowHandle.setSize(new LogicalSize(780, height)); },
    save: (day, text, asTask) => new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve, reject });
      void emitTo('main', 'quick-capture-save', { id, day, text, asTask }).catch(error => {
        pending.delete(id);
        reject(error);
      });
    }),
  });
  await listen('quick-capture-opened', () => { initializeTheme(); capture.refresh(); });
  await listen('quick-capture-dismiss', capture.dismiss);
  await windowHandle.onCloseRequested(event => { event.preventDefault(); capture.dismiss(); });
  window.addEventListener('storage', event => { if (event.key === 'tagdown.theme') initializeTheme(); });
}

void initializeCaptureWindow();
