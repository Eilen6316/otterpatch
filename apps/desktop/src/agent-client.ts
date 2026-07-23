/**
 * agent-client — the SSE transport between the cockpit and otterpatch-serve.
 * Owns fetch + stream reading + `data:` frame parsing; the caller owns event semantics.
 * Extracted from App.tsx (decomposition phase 6).
 */
import { browserLocalCredential, desktopLocalServiceBridge, type DesktopProposeEnvelope } from './electron-bridge.js';

export class LocalServiceHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'LocalServiceHttpError';
  }
}

/** POST `${endpoint}/propose-stream` and dispatch each parsed SSE `data:` JSON event.
 *  `onOpen` fires once after the HTTP response is OK, before the first event (optimistic UI).
 *  Throws on HTTP failure; the caller handles rollback. AbortSignal cancels fetch and stream reads. */
export async function streamPropose<E>(
  endpoint: string,
  payload: unknown,
  onOpen: () => void,
  onEvent: (e: E) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const bridge = desktopLocalServiceBridge();
  if (bridge) {
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `request_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let queue = Promise.resolve();
    let eventFailure: unknown;
    let receivedEvents = 0;
    let checkDrain: (() => void) | undefined;
    const listener = (envelope: DesktopProposeEnvelope): void => {
      if (envelope.requestId !== requestId || eventFailure) return;
      receivedEvents += 1;
      checkDrain?.();
      queue = queue.then(async () => {
        if (envelope.kind === 'open') onOpen();
        else await onEvent(envelope.event as E);
      }).catch((error: unknown) => {
        eventFailure = error;
        bridge.cancelPropose(requestId);
      });
    };
    const cancel = (): void => bridge.cancelPropose(requestId);
    bridge.onProposeEvent(listener);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      signal?.throwIfAborted();
      let invokeError: unknown;
      let expectedEvents = 0;
      try {
        expectedEvents = (await bridge.streamPropose({ requestId, payload })).eventCount;
      } catch (error) {
        invokeError = error;
      }
      if (!invokeError && receivedEvents < expectedEvents) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            checkDrain = undefined;
            reject(new Error('desktop stream events did not arrive before completion'));
          }, 1_000);
          checkDrain = () => {
            if (receivedEvents < expectedEvents) return;
            checkDrain = undefined;
            clearTimeout(timer);
            resolve();
          };
          checkDrain();
        });
      }
      await queue;
      if (eventFailure) throw eventFailure;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (invokeError) throw invokeError;
      return;
    } finally {
      signal?.removeEventListener('abort', cancel);
      bridge.offProposeEvent(listener);
    }
  }

  const token = browserLocalCredential('oa.serveToken');
  const resp = await fetch(endpoint + '/propose-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-OtterPatch-Token': token } : {}) },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => undefined) as { error?: unknown } | undefined;
    const detail = typeof data?.error === 'string' ? ': ' + data.error : '';
    throw new LocalServiceHttpError(resp.status, 'propose failed (' + resp.status + ')' + detail);
  }
  if (!resp.body) throw new LocalServiceHttpError(resp.status, 'propose failed: response stream is missing');
  onOpen();
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const chunks = buf.split('\n\n');
      buf = chunks.pop() ?? '';
      for (const c of chunks) {
        const line = c.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        let e: E;
        try { e = JSON.parse(line.slice(6)) as E; } catch { continue; }
        await onEvent(e);
      }
    }
  } finally {
    if (signal?.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
