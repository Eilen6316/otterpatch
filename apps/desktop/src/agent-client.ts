/**
 * agent-client — the SSE transport between the cockpit and otterpatch-serve.
 * Owns fetch + stream reading + `data:` frame parsing; the caller owns event semantics.
 * Extracted from App.tsx (decomposition phase 6).
 */

/** POST `${endpoint}/propose-stream` and dispatch each parsed SSE `data:` JSON event.
 *  `onOpen` fires once after the HTTP response is OK, before the first event (optimistic UI).
 *  Throws on HTTP failure; the caller handles rollback. The stream ends when the server closes. */
export async function streamPropose<E>(
  endpoint: string,
  payload: unknown,
  onOpen: () => void,
  onEvent: (e: E) => void | Promise<void>,
  token = '',
): Promise<void> {
  const resp = await fetch(endpoint + '/propose-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-OtterPatch-Token': token } : {}) },
    body: JSON.stringify(payload),
  });
  if (!resp.ok || !resp.body) throw new Error('propose failed (' + resp.status + ')');
  onOpen();
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
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
}
