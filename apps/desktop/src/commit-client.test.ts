import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitWriteback } from './commit-client.js';
import type { DesktopCommitInput, DesktopLocalServiceBridge } from './electron-bridge.js';

test('browser commit fails before HTTP when local review credentials are missing', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.fetch = (async () => { throw new Error('fetch must not run'); }) as typeof fetch;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null },
  });
  try {
    await assert.rejects(
      commitWriteback({
        endpoint: 'http://127.0.0.1:4319', format: 'excel', fileBase64: 'aW4=',
        changeSet: { baseRev: 3 }, proposal: { proposalId: 'unbound' }, acceptedEditIds: ['e1'],
      }),
      /local service credentials are not configured/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('commit client obtains a bound review receipt before commit', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
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
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => key === 'oa.serveToken' ? 'local' : key === 'oa.reviewToken' ? 'review' : null },
  });

  try {
    const result = await commitWriteback({
      endpoint: 'http://127.0.0.1:4319', format: 'excel', fileBase64: 'aW4=',
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
    assert.equal('currentRev' in calls[1]!.body, false, 'the service derives currentRev from uploaded bytes');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('commit client delegates review and commit to Electron main without renderer credentials', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalFetch = globalThis.fetch;
  let invocation: DesktopCommitInput | undefined;
  const bridge: DesktopLocalServiceBridge = {
    version: 'test',
    platform: 'test',
    async streamPropose() { return { ok: true, eventCount: 1 }; },
    cancelPropose() {},
    onProposeEvent() {},
    offProposeEvent() {},
    async commitWriteback(input) {
      invocation = input;
      return { ok: true, fileBase64: 'b3V0', touchedParts: [] };
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { otterpatch: bridge } });
  globalThis.fetch = (async () => { throw new Error('HTTP fallback must not run in Electron'); }) as typeof fetch;
  try {
    const result = await commitWriteback({
      endpoint: 'http://localhost:4319',
      format: 'excel',
      fileBase64: 'aW4=',
      changeSet: { baseRev: 4 },
      proposal: { proposalId: 'p' },
      acceptedEditIds: ['e1'],
    });
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }

  assert.deepEqual(invocation, {
    format: 'excel', fileBase64: 'aW4=', changeSet: { baseRev: 4 }, proposal: { proposalId: 'p' }, acceptedEditIds: ['e1'],
  });
  assert.equal('serveToken' in bridge, false);
  assert.equal('reviewToken' in bridge, false);
});
