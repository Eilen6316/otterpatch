import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitWriteback } from './commit-client.js';

test('commit client obtains a bound review receipt before commit', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, body, headers: new Headers(init?.headers) });
    if (url.endsWith('/review')) {
      return new Response(JSON.stringify({ proposal: { proposalId: 'bound' }, reviewReceipt: { nonce: 'receipt' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, fileBase64: 'b3V0', touchedParts: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await commitWriteback({
      endpoint: 'http://127.0.0.1:4319', token: 'local', reviewToken: 'review', format: 'excel', fileBase64: 'aW4=',
      changeSet: { baseRev: 3 }, proposal: { proposalId: 'unbound' }, acceptedEditIds: ['e1'],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => call.url), ['http://127.0.0.1:4319/review', 'http://127.0.0.1:4319/commit']);
    assert.deepEqual(calls[0]!.body.acceptedEditIds, ['e1']);
    assert.equal(calls[0]!.headers.get('X-OtterPatch-Review-Token'), 'review');
    assert.equal(calls[1]!.headers.get('X-OtterPatch-Review-Token'), null, 'review authority token is not sent to commit');
    assert.deepEqual(calls[1]!.body.proposal, { proposalId: 'bound' });
    assert.deepEqual(calls[1]!.body.reviewReceipt, { nonce: 'receipt' });
    assert.equal('acceptedEditIds' in calls[1]!.body, false, 'commit authority comes from the signed receipt');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
