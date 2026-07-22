import assert from 'node:assert/strict';
import { test } from 'node:test';
import { streamPropose } from './agent-client.js';

test('streamPropose forwards AbortSignal and parses SSE frames', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null | undefined;
  const events: unknown[] = [];
  globalThis.fetch = (async (_input, init) => {
    receivedSignal = init?.signal;
    return new Response('data: {"type":"status"}\n\ndata: {"type":"done"}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as typeof fetch;
  try {
    await streamPropose('http://localhost:4319', {}, () => undefined, (event) => { events.push(event); }, '', controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(events, [{ type: 'status' }, { type: 'done' }]);
});

test('streamPropose exposes cancellation to callers', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = (async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })) as typeof fetch;
  const pending = streamPropose('http://localhost:4319', {}, () => undefined, () => undefined, '', controller.signal);
  controller.abort();
  try {
    await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
