// Saved web links: the "Save web link…" box, and the offer that shows up
// after pasting a lone link on an empty line. The vault fetches the page and
// makes the Link note (weblink.rs); these only ask.

/** `text` when it is one http(s) address and nothing else. */
export function webUrl(text: string): string | null {
  const url = text.trim();
  return /^https?:\/\/[^\s/?#]+\S*$/i.test(url) ? url : null;
}

/** Whether the selection `from`–`to` in `value` sits on a line with nothing else on it. */
export function onEmptyLine(value: string, from: number, to: number) {
  const start = value.lastIndexOf('\n', from - 1) + 1;
  const end = value.indexOf('\n', to);
  return !value.slice(start, from).trim() && !value.slice(to, end < 0 ? value.length : end).trim();
}

type SaveOptions = {
  /** Saves the link; a rejection keeps the box open with the error. */
  save: (url: string) => Promise<void>;
};

/** A box asking for a link to save as a note. */
export function openSaveLinkDialog({ save }: SaveOptions) {
  document.querySelector('.link-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog capture-dialog link-dialog';
  dialog.setAttribute('aria-label', 'Save web link');
  dialog.innerHTML = `
    <form class="confirm-shell" method="dialog" novalidate>
      <h2 class="confirm-title">Save web link</h2>
      <p class="confirm-detail">Makes a Link note with the page’s title, description and opening text.</p>
      <input class="capture-text link-url" type="url" placeholder="https://" aria-label="Link" spellcheck="false" autocomplete="off">
      <p class="capture-error" role="alert" hidden></p>
      <div class="confirm-actions">
        <button type="button" class="confirm-button" data-link-cancel>Cancel</button>
        <button type="submit" class="confirm-button is-primary" data-link-ok>Save</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  const error = dialog.querySelector<HTMLElement>('.capture-error')!;
  const ok = dialog.querySelector<HTMLButtonElement>('[data-link-ok]')!;
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const fail = (text: string) => { error.textContent = text; error.hidden = false; };
  dialog.querySelector('form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = webUrl(input.value);
    if (!url) { fail('Enter a link starting with http:// or https://.'); input.focus(); return; }
    ok.disabled = true;
    ok.textContent = 'Saving…';
    error.hidden = true;
    try {
      await save(url);
      close();
    } catch (failure) {
      fail(String(failure));
      ok.disabled = false;
      ok.textContent = 'Save';
    }
  });
  dialog.querySelector('[data-link-cancel]')!.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); if (!ok.disabled) close(); });
  dialog.showModal();
  input.focus();
}

/**
 * After a link was pasted on its own line: a small bar offering to save it
 * as a Link note. It goes away by itself after a while.
 */
export function offerLinkNote(url: string, accept: () => Promise<void>) {
  document.querySelector('.link-offer')?.remove();
  const bar = document.createElement('div');
  bar.className = 'link-offer';
  bar.setAttribute('role', 'status');
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* shown as is */ }
  bar.innerHTML = `
    <span>Save the ${escapeHtml(host)} link as a note?</span>
    <button type="button" class="link-offer-save">Save as Link note</button>
    <button type="button" class="link-offer-close" aria-label="Dismiss">×</button>`;
  document.body.append(bar);
  const timer = window.setTimeout(() => bar.remove(), 10000);
  const save = bar.querySelector<HTMLButtonElement>('.link-offer-save')!;
  bar.querySelector('.link-offer-close')!.addEventListener('click', () => { window.clearTimeout(timer); bar.remove(); });
  save.addEventListener('click', async () => {
    window.clearTimeout(timer);
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      await accept();
    } finally {
      bar.remove();
    }
  });
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
