import { enqueue, acknowledged, validToken } from './queue.js';

const ENDPOINT = 'http://127.0.0.1:43827/capture';
let pending = Promise.resolve();
function serial(task) {
  const result = pending.then(task, task);
  pending = result.catch(() => {});
  return result;
}

async function status() {
  const { queue = [], token = '', lastError = '' } = await chrome.storage.local.get(['queue', 'token', 'lastError']);
  return { queued: queue.length, paired: validToken(token), lastError };
}

async function badge() {
  const { queued } = await status();
  await chrome.action.setBadgeText({ text: queued ? String(queued) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#8b6428' });
}

async function flush() {
  let { queue = [], token = '' } = await chrome.storage.local.get(['queue', 'token']);
  if (!validToken(token)) { await chrome.storage.local.set({ lastError: 'Pair with Tagdown to deliver captures.' }); return status(); }
  for (const clip of [...queue]) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(clip), signal: AbortSignal.timeout(5_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Tagdown returned ${response.status}`);
      const remaining = acknowledged(queue, clip.id, result);
      if (remaining.length === queue.length) throw new Error('Tagdown did not acknowledge this capture. It remains queued.');
      queue = remaining;
      await chrome.storage.local.set({ queue, lastError: '' });
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure);
      await chrome.storage.local.set({ lastError: `Capture queued. Open Tagdown to deliver it. ${detail}` });
      break;
    }
  }
  await badge();
  return status();
}

async function capture(mode) {
  if (!['selection', 'page', 'link'].includes(mode)) throw new Error('Unknown capture mode.');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) throw new Error('Open an http or https web page first.');
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ title: document.title.slice(0, 900), url: location.href, selection: window.getSelection()?.toString().slice(0, 18_000) || '', text: (document.querySelector('article') || document.querySelector('main') || document.body)?.innerText?.slice(0, 45_000) || '' }),
  });
  if (new TextEncoder().encode(result.url).length > 8_000) throw new Error('This page URL is too long to save.');
  for (const field of ['title', 'selection', 'text']) result[field] = result[field].replaceAll('\0', '');
  if (mode === 'selection' && !result.selection.trim()) throw new Error('Select text on the page first.');
  const clip = { id: crypto.randomUUID(), url: result.url, title: result.title, capturedAt: new Date().toISOString(), selection: mode === 'link' ? '' : result.selection, text: mode === 'page' ? result.text : '' };
  const { queue = [] } = await chrome.storage.local.get('queue');
  await chrome.storage.local.set({ queue: enqueue(queue, clip) });
  await badge();
  const resultStatus = await flush();
  return { ...resultStatus, captured: true };
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  serial(async () => {
    if (message.action === 'status') return status();
    if (message.action === 'capture') return capture(message.mode);
    if (message.action === 'retry') return flush();
    if (message.action === 'pair') {
      const token = String(message.token || '').trim();
      if (!validToken(token)) throw new Error('Paste the 64-character pairing token from Tagdown.');
      await chrome.storage.local.set({ token });
      return flush();
    }
    throw new Error('Unknown action.');
  }).then(result => reply({ ok: true, ...result }), failure => reply({ ok: false, error: String(failure.message || failure) }));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'tagdown-delivery') void serial(flush); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create('tagdown-delivery', { periodInMinutes: 1 }); void serial(flush); });
chrome.runtime.onStartup.addListener(() => { void chrome.alarms.create('tagdown-delivery', { periodInMinutes: 1 }); void serial(flush); });
