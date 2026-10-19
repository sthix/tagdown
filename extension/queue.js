export const MAX_QUEUE = 100;
export const MAX_QUEUE_BYTES = 8_000_000;

export function enqueue(queue, clip) {
  if (queue.some(item => item.id === clip.id)) return queue;
  const next = [...queue, clip];
  if (next.length > MAX_QUEUE || new TextEncoder().encode(JSON.stringify(next)).length > MAX_QUEUE_BYTES) {
    throw new Error('Your capture queue is full. Open Tagdown and deliver pending captures first.');
  }
  return next;
}

export function acknowledged(queue, id, response) {
  return response?.saved === true && response.id === id ? queue.filter(clip => clip.id !== id) : queue;
}

export function validToken(token) { return /^[a-f0-9]{64}$/.test(token); }
