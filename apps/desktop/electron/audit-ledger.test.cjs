'use strict';

/**
 * audit-ledger.cjs + the audit-history IPC contract: the read-only ledger projection
 * the main process serves to the renderer. Contract rules mirror the desktop bridge.
 */
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { readAuditLedger } = require('./audit-ledger.cjs');
const { validateAuditHistoryInput, validateAuditHistoryResult } = require('./ipc-contract.cjs');

function record(overrides = {}) {
  return {
    ts: '2026-09-17T12:00:00.000Z',
    documentId: 'doc-a',
    format: 'excel',
    reviewKind: 'receipt',
    changeSetId: 'cs1',
    intent: 'set B1',
    editCount: 1,
    acceptedEditIds: ['e0'],
    sourceSha256: 'a'.repeat(64),
    outputSha256: 'b'.repeat(64),
    backendId: 'surgical-ooxml',
    ok: true,
    touchedParts: ['xl/worksheets/sheet1.xml'],
    fidelity: 1,
    verification: { packageValid: true, verifiedEdits: ['e0'], unverifiableEdits: [], failedEdits: [] },
    ...overrides,
  };
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'otterpatch-ledger-'));
}

// ── ledger reader ────────────────────────────────────────────────────────────

test('readAuditLedger: per-document file, sorted by ts, all documents when omitted', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'doc-a.jsonl'), JSON.stringify(record({ ts: '2026-09-17T12:05:00.000Z' })) + '\n' + JSON.stringify(record({ ts: '2026-09-17T12:00:00.000Z' })) + '\n');
    writeFileSync(join(dir, 'doc-b.jsonl'), JSON.stringify(record({ documentId: 'doc-b', ts: '2026-09-17T12:02:00.000Z' })) + '\n');

    assert.deepEqual(readAuditLedger(dir, 'doc-a').map((r) => r.ts), ['2026-09-17T12:00:00.000Z', '2026-09-17T12:05:00.000Z']);
    assert.equal(readAuditLedger(dir, 'doc-b').length, 1);
    assert.equal(readAuditLedger(dir).length, 3);
    assert.deepEqual(readAuditLedger(dir).map((r) => r.ts), ['2026-09-17T12:00:00.000Z', '2026-09-17T12:02:00.000Z', '2026-09-17T12:05:00.000Z']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAuditLedger: torn last line is skipped, missing directory is empty', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'doc-a.jsonl'), JSON.stringify(record()) + '\n{"ts":"2026-09-17T12:09:00.000Z"');
    assert.equal(readAuditLedger(dir, 'doc-a').length, 1);
    assert.deepEqual(readAuditLedger('/nonexistent-otterpatch-dir'), []);
    assert.deepEqual(readAuditLedger(undefined), []);
    assert.deepEqual(readAuditLedger(dir, ''), [], 'blank documentId reads nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── IPC contract ─────────────────────────────────────────────────────────────

test('validateAuditHistoryInput: optional documentId, bounded and non-blank', () => {
  assert.deepEqual(validateAuditHistoryInput({}), {});
  assert.deepEqual(validateAuditHistoryInput({ documentId: 'doc-a' }), { documentId: 'doc-a' });
  assert.throws(() => validateAuditHistoryInput({ documentId: '' }), /must not be blank/);
  assert.throws(() => validateAuditHistoryInput({ documentId: 'x'.repeat(513) }), /at most 512/);
  assert.throws(() => validateAuditHistoryInput({ url: 'https://evil.test' }), /unsupported fields/);
});

test('validateAuditHistoryResult: accepts well-formed records and rejects tampering', () => {
  const ok = validateAuditHistoryResult([record()]);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].intent, 'set B1');

  assert.throws(() => validateAuditHistoryResult('not-an-array'), /must be an array/);
  assert.throws(() => validateAuditHistoryResult([{ ...record(), extra: 'x' }]), /unsupported fields/);
  assert.throws(() => validateAuditHistoryResult([{ ...record(), reviewKind: 'skipped' }]), /reviewKind invalid/);
  assert.throws(() => validateAuditHistoryResult([{ ...record(), ts: '' }]), /ts must be a non-empty/);
  assert.throws(() => validateAuditHistoryResult([{ ...record(), ok: 'yes' }]), /ok must be boolean/);
  assert.throws(() => validateAuditHistoryResult([{ ...record(), verification: { packageValid: 'true', verifiedEdits: [], unverifiableEdits: [], failedEdits: [] } }]), /packageValid must be boolean/);
  assert.throws(() => validateAuditHistoryResult([record(), record(), ...Array(500).fill(record())]), /exceeds 500/);
});
