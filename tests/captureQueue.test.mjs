import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, acknowledged, validToken, MAX_QUEUE } from '../extension/queue.js';

test('captures survive missing and mismatched delivery acknowledgements', () => {
  const queue = [{ id: 'first' }, { id: 'second' }];
  assert.equal(acknowledged(queue, 'first', { saved: false, id: 'first' }), queue);
  assert.equal(acknowledged(queue, 'first', { saved: true, id: 'other' }), queue);
  assert.deepEqual(acknowledged(queue, 'first', { saved: true, id: 'first' }), [{ id: 'second' }]);
});
test('queue refuses overflow without discarding existing captures', () => {
  const queue = Array.from({ length: MAX_QUEUE }, (_, id) => ({ id: String(id) }));
  assert.throws(() => enqueue(queue, { id: 'new' }), /queue is full/);
  assert.equal(queue.length, MAX_QUEUE);
  assert.equal(enqueue(queue, { id: '0' }), queue);
});
test('pairing accepts only a full local token', () => {
  assert.equal(validToken('a'.repeat(64)), true);
  assert.equal(validToken('https://example.com'), false);
  assert.equal(validToken('a'.repeat(63)), false);
});
