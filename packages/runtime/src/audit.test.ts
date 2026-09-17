/**
 * Commit audit ledger — the durable "merged PR" record. Module behavior plus the
 * runtime integration (a commit appends exactly one record; no ledger = no records).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { MockModelClient } from '@otterpatch/agent';
import type { ProposeRequest } from '@otterpatch/agent';
import type { DocRev } from '@otterpatch/core';
import { FileAuditLedger, MemoryAuditLedger, auditLedgerFromEnv, type CommitAuditRecord } from './audit.js';
import { OtterPatchRuntime } from './runtime.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeXlsx(value: number): Uint8Array {
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
      `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="B1" s="2"><v>${value}</v></c></row></sheetData></worksheet>`,
    ),
  });
}

function record(overrides: Partial<CommitAuditRecord> = {}): CommitAuditRecord {
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
    backendId: 'surgical-ooxml',
    ok: true,
    touchedParts: ['xl/worksheets/sheet1.xml'],
    fidelity: 1,
    verification: { packageValid: true, verifiedEdits: ['e0'], unverifiableEdits: [], failedEdits: [] },
    ...overrides,
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'otterpatch-audit-'));
}

// ── module ───────────────────────────────────────────────────────────────────

test('MemoryAuditLedger: records per document and in append order', () => {
  const ledger = new MemoryAuditLedger();
  ledger.append(record({ ts: '2026-09-17T12:00:00.000Z' }));
  ledger.append(record({ ts: '2026-09-17T12:01:00.000Z', documentId: 'doc-b' }));
  assert.equal(ledger.read().length, 2);
  assert.equal(ledger.read('doc-a').length, 1);
  assert.equal(ledger.read('doc-b')[0]?.ts, '2026-09-17T12:01:00.000Z');
});

test('FileAuditLedger: append then read survives a new instance (restart)', () => {
  const dir = tempDir();
  try {
    const before = new FileAuditLedger(dir);
    before.append(record());
    before.append(record({ ts: '2026-09-17T12:05:00.000Z' }));

    const after = new FileAuditLedger(dir);
    const records = after.read('doc-a');
    assert.equal(records.length, 2, 'history is durable across restarts');
    assert.deepEqual(records.map((r) => r.ts), ['2026-09-17T12:00:00.000Z', '2026-09-17T12:05:00.000Z']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileAuditLedger: one file per document; read() without a documentId returns all', () => {
  const dir = tempDir();
  try {
    const ledger = new FileAuditLedger(dir);
    ledger.append(record({ documentId: 'doc-a' }));
    ledger.append(record({ documentId: 'doc-b', ts: '2026-09-17T12:02:00.000Z' }));
    assert.equal(ledger.read().length, 2);
    assert.equal(ledger.read('doc-a').length, 1);
    // Document ids are URL-encoded into the file name, so slashes cannot escape the directory.
    const files = readFileSync(join(dir, 'doc-a.jsonl'), 'utf8').trim().split('\n');
    assert.equal(files.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileAuditLedger: a truncated last line (crash mid-append) is skipped, not fatal', () => {
  const dir = tempDir();
  try {
    const ledger = new FileAuditLedger(dir);
    ledger.append(record());
    // Simulate a crash that truncated the second append mid-line.
    const file = join(dir, 'doc-a.jsonl');
    appendFileSync(file, '{"ts":"2026-09-17T12:09:00.000Z","documentId":"doc-a"');
    const records = new FileAuditLedger(dir).read('doc-a');
    assert.equal(records.length, 1, 'the intact record survives; the torn line is skipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auditLedgerFromEnv: no env var means no ledger; a directory means a file ledger', () => {
  const saved = process.env.OtterPatch_AUDIT_DIR;
  try {
    delete process.env.OtterPatch_AUDIT_DIR;
    assert.equal(auditLedgerFromEnv(), undefined, 'default is off — zero behavior change');
    const dir = tempDir();
    const ledger = auditLedgerFromEnv(dir);
    assert.ok(ledger instanceof FileAuditLedger);
    ledger!.append(record());
    assert.equal(new FileAuditLedger(dir).read('doc-a').length, 1);
    rmSync(dir, { recursive: true, force: true });
  } finally {
    if (saved === undefined) delete process.env.OtterPatch_AUDIT_DIR;
    else process.env.OtterPatch_AUDIT_DIR = saved;
  }
});

// ── runtime integration ──────────────────────────────────────────────────────

async function proposeB1Set(runtime: OtterPatchRuntime): Promise<ReturnType<OtterPatchRuntime['propose']>> {
  const model = new MockModelClient(() => ({ plan: '把 B1 改成 99', edits: [{ cell: 'Sheet1!B1', op: 'setValue', value: 99 }] }));
  const request: ProposeRequest = {
    hostId: 'h1', format: 'excel', intent: '把 B1 改成 99', baseRev: 0 as DocRev, anchors: [], context: 'B1=20',
    sheet: { a1: 'Sheet1!B1', name: 'Sheet1', values: [[20]], formulas: [[null]] },
  };
  return runtime.propose(request, model);
}

test('runtime: a reviewed commit appends exactly one record with the full trail', async () => {
  const ledger = new MemoryAuditLedger();
  const rt = new OtterPatchRuntime({ auditLedger: ledger });
  const cs = await proposeB1Set(rt);
  const source = makeXlsx(20);

  const proposal = rt.createProposal(cs, 'excel');
  const reviewed = rt.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), source, 'reviewer-7');
  const res = await rt.commit({ format: 'excel', bytes: source, changeSet: cs, ...reviewed });
  assert.equal(res.ok, true);

  const records = ledger.read();
  assert.equal(records.length, 1, 'one commit = one record');
  const entry = records[0]!;
  assert.equal(entry.reviewKind, 'receipt');
  assert.equal(entry.proposalId, proposal.proposalId);
  assert.equal(entry.reviewerSessionId, 'reviewer-7');
  assert.equal(entry.changeSetSha256, proposal.changeSetSha256);
  assert.deepEqual(entry.acceptedEditIds, cs.edits.map((edit) => edit.id));
  assert.equal(entry.intent, '把 B1 改成 99');
  assert.equal(entry.format, 'excel');
  assert.equal(entry.ok, true);
  assert.equal(entry.backendId, 'surgical-ooxml');
  assert.ok(entry.outputSha256, 'the output hash is recorded');
  assert.equal(entry.outputSha256, sha256Of(res.bytes));
  assert.deepEqual(entry.verification.verifiedEdits, ['e0']);
  assert.deepEqual(entry.verification.failedEdits, []);
});

test('runtime: without a ledger nothing is recorded (default behavior unchanged)', async () => {
  const rt = new OtterPatchRuntime();
  const cs = await proposeB1Set(rt);
  const source = makeXlsx(20);
  const proposal = rt.createProposal(cs, 'excel');
  const reviewed = rt.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), source, 'reviewer-7');
  const res = await rt.commit({ format: 'excel', bytes: source, changeSet: cs, ...reviewed });
  assert.equal(res.ok, true, 'commit works with no ledger configured');
});

test('runtime: a ledger failure never fails the commit', async () => {
  const exploding = {
    append: () => { throw new Error('disk on fire'); },
    read: () => [],
  };
  const rt = new OtterPatchRuntime({ auditLedger: exploding });
  const cs = await proposeB1Set(rt);
  const source = makeXlsx(20);
  const proposal = rt.createProposal(cs, 'excel');
  const reviewed = rt.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), source, 'reviewer-7');
  const res = await rt.commit({ format: 'excel', bytes: source, changeSet: cs, ...reviewed });
  assert.equal(res.ok, true, 'the ledger is evidence, never a gate');
});

test('runtime: an unreviewed commit records reviewKind=unreviewed', async () => {
  const ledger = new MemoryAuditLedger();
  const rt = new OtterPatchRuntime({ auditLedger: ledger, allowUnreviewedCommit: true });
  const cs = await proposeB1Set(rt);
  const source = makeXlsx(20);
  const res = await rt.commit({
    format: 'excel',
    bytes: source,
    changeSet: cs,
    acceptedEditIds: cs.edits.map((edit) => edit.id),
    currentRev: cs.baseRev,
  });
  assert.equal(res.ok, true);
  assert.equal(ledger.read()[0]?.reviewKind, 'unreviewed');
  assert.equal(ledger.read()[0]?.proposalId, undefined, 'no proposal was signed');
});

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
