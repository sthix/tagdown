const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('button')];
async function send(message) {
  buttons.forEach(button => { button.disabled = true; });
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || 'Extension did not respond.');
    status.textContent = result.queued ? `${result.queued} queued. ${result.lastError || ''}` : result.captured ? 'Saved in Tagdown.' : result.paired ? 'Paired. All captures delivered.' : 'Pair with Tagdown to start saving.';
    if (!result.paired) document.querySelector('#pairing').open = true;
  } catch (error) { status.textContent = error.message || String(error); }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => void send({ action: 'capture', mode: button.dataset.mode })));
document.querySelector('#retry').addEventListener('click', () => void send({ action: 'retry' }));
document.querySelector('#pair').addEventListener('submit', event => { event.preventDefault(); void send({ action: 'pair', token: document.querySelector('#token').value }); });
void send({ action: 'status' });
