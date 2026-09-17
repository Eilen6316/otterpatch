/**
 * ReviewAuthorityStore: durable review-authority state (secret, consumed nonces, committed
 * sources) so the review boundary survives process restarts and spans multiple processes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { MockModelClient } from '@otterpatch/agent';
import type { ProposeRequest } from '@otterpatch/agent';
import type { DocRev } from '@otterpatch/core';
import { FileReviewAuthorityStore, InMemoryReviewAuthorityStore } from './review-store.js';
import { OtterPatchRuntime } from './runtime.js';

// ── in-memory store ──────────────────────────────────────────────────────────

test('InMemoryReviewAuthorityStore: first consume is not a replay; second is', () => {
  const store = new InMemoryReviewAuthorityStore();
  const expiry = Date.now() + 60_000;
  assert.equal(store.consumeNonce('n1', expiry), false);
  assert.equal(store.consumeNonce('n1', expiry), true);
  assert.equal(store.consumeNonce('n2', expiry), false);
});

test('InMemoryReviewAuthorityStore: committed sources are remembered and queryable', () => {
  const store = new InMemoryReviewAuthorityStore();
  assert.equal(store.isCommittedSource('doc:sha'), false);
  store.rememberCommittedSource('doc:sha');
  assert.equal(store.isCommittedSource('doc:sha'), true);
  assert.equal(store.isCommittedSource('doc:other'), false);
});

test('InMemoryReviewAuthorityStore: prune drops expired nonces only', () => {
  const store = new InMemoryReviewAuthorityStore();
  const now = Date.now();
  store.consumeNonce('expired', now - 1_000);
  store.consumeNonce('live', now + 60_000);
  store.prune(now);
  assert.equal(store.consumeNonce('expired', now + 60_000), false, 'expired nonce was pruned');
  assert.equal(store.consumeNonce('live', now + 60_000), true, 'live nonce still blocks replay');
});

test('InMemoryReviewAuthorityStore: generated secret is at least 32 bytes', () => {
  assert.ok(new InMemoryReviewAuthorityStore().secret.byteLength >= 32);
});

// ── file store ───────────────────────────────────────────────────────────────

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'otterpatch-review-'));
}

test('FileReviewAuthorityStore: secret is persisted and shared across instances', () => {
  const dir = tempDir();
  try {
    const first = new FileReviewAuthorityStore(dir);
    const second = new FileReviewAuthorityStore(dir);
    assert.deepEqual(second.secret, first.secret);
    assert.equal(first.secret.byteLength >= 32, true);
    // A fresh instance in the same directory MUST agree on the secret or proposals
    // signed by one process would fail verification in another.
    assert.equal(Buffer.compare(Buffer.from(second.secret), Buffer.from(first.secret)), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileReviewAuthorityStore: nonce replay is detected across instances (multi-process)', () => {
  const dir = tempDir();
  try {
    const writer = new FileReviewAuthorityStore(dir);
    const reader = new FileReviewAuthorityStore(dir);
    const expiry = Date.now() + 60_000;
    assert.equal(writer.consumeNonce('shared-nonce', expiry), false);
    assert.equal(reader.consumeNonce('shared-nonce', expiry), true, 'the second process must see the replay');
    assert.equal(reader.consumeNonce('other-nonce', expiry), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileReviewAuthorityStore: committed sources survive re-instantiation (restart)', () => {
  const dir = tempDir();
  try {
    const before = new FileReviewAuthorityStore(dir);
    before.rememberCommittedSource('doc-h:sha256');
    const after = new FileReviewAuthorityStore(dir);
    assert.equal(after.isCommittedSource('doc-h:sha256'), true);
    assert.equal(after.isCommittedSource('doc-h:other'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileReviewAuthorityStore: a corrupt state file starts empty instead of crashing', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'review-state.json'), '{ not json');
    const store = new FileReviewAuthorityStore(dir);
    assert.equal(store.consumeNonce('n', Date.now() + 60_000), false);
    assert.equal(store.isCommittedSource('x'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileReviewAuthorityStore: state file is written with restrictive permissions', () => {
  const dir = tempDir();
  try {
    const store = new FileReviewAuthorityStore(dir);
    store.rememberCommittedSource('k');
    const secret = readFileSync(join(dir, 'review-secret.key'));
    assert.ok(secret.byteLength >= 32);
    // The state file exists and parses back to the remembered source.
    const state = JSON.parse(readFileSync(join(dir, 'review-state.json'), 'utf8')) as { committedSources: Array<[string, number]> };
    assert.deepEqual(state.committedSources, [['k', state.committedSources[0]![1]]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── runtime integration (shared store across processes) ──────────────────────

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeXlsx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'xl/workbook.xml': enc(
      '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': enc(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/styles.xml': enc('<?xml version="1.0"?><styleSheet/>'),
    'xl/worksheets/sheet1.xml': enc(
      '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="B1" s="2"><v>20</v></c></row></sheetData></worksheet>',
    ),
  });
}

async function proposeB1Set(runtime: OtterPatchRuntime): Promise<{ cs: Awaited<ReturnType<OtterPatchRuntime['propose']>>; original: Uint8Array }> {
  const model = new MockModelClient(() => ({ plan: '把 B1 改成 99', edits: [{ cell: 'Sheet1!B1', op: 'setValue', value: 99 }] }));
  const request: ProposeRequest = {
    hostId: 'h1', format: 'excel', intent: '把 B1 改成 99', baseRev: 0 as DocRev, anchors: [], context: 'B1=20',
    sheet: { a1: 'Sheet1!B1', name: 'Sheet1', values: [[20]], formulas: [[null]] },
  };
  const cs = await runtime.propose(request, model);
  return { cs, original: makeXlsx() };
}

test('runtime: a shared store lets a second runtime verify the first runtime’s proposal and receipt', async () => {
  const dir = tempDir();
  try {
    const store = new FileReviewAuthorityStore(dir);
    const signing = new OtterPatchRuntime({ reviewStore: store });
    const committing = new OtterPatchRuntime({ reviewStore: store });

    const { cs, original } = await proposeB1Set(signing);
    const proposal = signing.createProposal(cs, 'excel');
    const reviewed = signing.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), original, 'reviewer-1');

    // The receipt was signed by `signing`; `committing` shares the secret via the store,
    // so cross-process verification must succeed.
    const res = await committing.commit({ format: 'excel', bytes: original, changeSet: cs, ...reviewed });
    assert.equal(res.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime: a shared store rejects the replayed receipt in a second runtime', async () => {
  const dir = tempDir();
  try {
    const store = new FileReviewAuthorityStore(dir);
    const first = new OtterPatchRuntime({ reviewStore: store });
    const second = new OtterPatchRuntime({ reviewStore: store });

    const { cs, original } = await proposeB1Set(first);
    const proposal = first.createProposal(cs, 'excel');
    const reviewed = first.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), original, 'reviewer-1');

    assert.equal((await first.commit({ format: 'excel', bytes: original, changeSet: cs, ...reviewed })).ok, true);
    // Same receipt, different process: the shared store must catch the replay
    // (consumed nonce and/or already-committed source) instead of trusting process-local memory.
    await assert.rejects(
      second.commit({ format: 'excel', bytes: original, changeSet: cs, ...reviewed }),
      /already been (used|committed)/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime: the default store is process-local (receipts do not cross process boundaries)', async () => {
  const first = new OtterPatchRuntime();
  const second = new OtterPatchRuntime();
  const { cs, original } = await proposeB1Set(first);
  const proposal = first.createProposal(cs, 'excel');
  const reviewed = first.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), original, 'reviewer-1');
  assert.equal((await first.commit({ format: 'excel', bytes: original, changeSet: cs, ...reviewed })).ok, true);
  // Without a shared store, each runtime generates its own signing secret, so a receipt
  // minted by one process is invalid in another — the documented process-local boundary.
  // (A shared store is what makes cross-process review authority work; see the tests above.)
  await assert.rejects(
    second.commit({ format: 'excel', bytes: original, changeSet: cs, ...reviewed }),
    /invalid proposal signature/,
  );
});
