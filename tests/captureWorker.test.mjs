import test from 'node:test';
import assert from 'node:assert/strict';

test('worker persists offline captures, checks the save acknowledgement, and retries without changing IDs', async () => {
  const stored = { token: 'a'.repeat(64) };
  let listener;
  globalThis.chrome = {
    storage: { local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])])),
      set: async values => { Object.assign(stored, structuredClone(values)); },
    } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com/article' }] },
    scripting: { executeScript: async () => [{ result: { title: 'Example', url: 'https://example.com/article', selection: 'An excerpt', text: 'Page body' } }] },
    alarms: { onAlarm: { addListener() {} }, create: async () => {} },
    runtime: { onMessage: { addListener: fn => { listener = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, request) => {
      assert.equal(stored.queue.length, 1, 'capture is durable before networking starts');
      assert.equal(JSON.parse(request.body).selection, 'An excerpt');
      throw new Error('App is closed');
    };
    await import('../extension/worker.js');
    const send = message => new Promise(resolve => listener(message, {}, resolve));
    const captured = await send({ action: 'capture', mode: 'page' });
    assert.equal(captured.ok, true);
    assert.equal(captured.queued, 1);
    const captureId = stored.queue[0].id;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ saved: true, id: 'wrong' }) });
    const unacknowledged = await send({ action: 'retry' });
    assert.equal(unacknowledged.queued, 1);
    assert.equal(stored.queue[0].id, captureId);
    globalThis.fetch = async (url, request) => {
      assert.equal(url, 'http://127.0.0.1:43827/capture');
      assert.equal(request.headers.Authorization, `Bearer ${stored.token}`);
      assert.equal(JSON.parse(request.body).id, captureId);
      return { ok: true, json: async () => ({ saved: true, id: captureId }) };
    };
    const delivered = await send({ action: 'retry' });
    assert.equal(delivered.queued, 0);
    assert.deepEqual(stored.queue, []);
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});
