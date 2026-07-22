import assert from 'node:assert/strict';
import { test } from 'node:test';
import { streamPropose } from './agent-client.js';
import type { DesktopLocalServiceBridge, DesktopProposeEnvelope } from './electron-bridge.js';

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
    await streamPropose('http://localhost:4319', {}, () => undefined, (event) => { events.push(event); }, controller.signal);
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
  const pending = streamPropose('http://localhost:4319', {}, () => undefined, () => undefined, controller.signal);
  controller.abort();
  try {
    await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamPropose uses narrow Electron IPC without exposing a local service token', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalFetch = globalThis.fetch;
  let listener: ((event: DesktopProposeEnvelope) => void) | undefined;
  let invocation: { requestId: string; payload: unknown } | undefined;
  const bridge: DesktopLocalServiceBridge = {
    version: 'test',
    platform: 'test',
    async streamPropose(input) {
      invocation = input;
      listener?.({ requestId: input.requestId, kind: 'open' });
      listener?.({ requestId: input.requestId, kind: 'event', event: { type: 'done' } });
      return { ok: true, eventCount: 2 };
    },
    cancelPropose() {},
    onProposeEvent(next) { listener = next; },
    offProposeEvent(next) { if (listener === next) listener = undefined; },
    async commitWriteback() { return {}; },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { otterpatch: bridge } });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('Electron transport must not read renderer credentials'); },
  });
  globalThis.fetch = (async () => { throw new Error('HTTP fallback must not run in Electron'); }) as typeof fetch;
  const events: unknown[] = [];
  let opened = 0;
  try {
    await streamPropose('http://localhost:4319', { format: 'excel' }, () => { opened++; }, (event) => { events.push(event); });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as { window?: unknown }).window;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }

  assert.equal(opened, 1);
  assert.deepEqual(events, [{ type: 'done' }]);
  assert.deepEqual(invocation?.payload, { format: 'excel' });
  assert.equal('serveToken' in bridge, false);
  assert.equal('reviewToken' in bridge, false);
});

test('streamPropose forwards renderer cancellation through the request-scoped IPC method', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let rejectInvocation: ((error: Error) => void) | undefined;
  let activeRequestId = '';
  let cancelledRequestId = '';
  const bridge: DesktopLocalServiceBridge = {
    version: 'test',
    platform: 'test',
    streamPropose(input) {
      activeRequestId = input.requestId;
      return new Promise<{ ok: true; eventCount: number }>((_resolve, reject) => { rejectInvocation = reject; });
    },
    cancelPropose(requestId) {
      cancelledRequestId = requestId;
      rejectInvocation?.(new Error('main request cancelled'));
    },
    onProposeEvent() {},
    offProposeEvent() {},
    async commitWriteback() { return {}; },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { otterpatch: bridge } });
  const controller = new AbortController();
  try {
    const pending = streamPropose('http://localhost:4319', {}, () => undefined, () => undefined, controller.signal);
    controller.abort();
    await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError');
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
  assert.ok(activeRequestId);
  assert.equal(cancelledRequestId, activeRequestId);
});
