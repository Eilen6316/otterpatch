/**
 * ReviewAuthorityStore: durable review-authority state (secret, consumed nonces, committed
 * sources) so the review boundary survives process restarts and spans multiple processes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { MockModelClient } from '@otterpatch/agent';
import type { ProposeRequest } from '@otterpatch/agent';
import type { DocRev } from '@otterpatch/core';
import { FileReviewAuthorityStore, InMemoryReviewAuthorityStore } from './review-store.js';
import { OtterPatchRuntime } from './runtime.js';
import { createBuiltinAdapterRegistry } from './adapters.js';

const statePath = (dir: string): string => join(dir, 'authority-v2', 'review-state.sqlite');
const metadataPath = (dir: string): string => join(dir, 'authority-v2', 'review-state.json');
const secretPath = (dir: string): string => join(dir, 'authority-v2', 'review-secret.key');
interface WorkerMessage { kind: string; result?: unknown; error?: string; phase?: string }

function worker(dir: string, action: string, key = '') {
  const child = fork(fileURLToPath(new URL('./review-store.test-worker.ts', import.meta.url)), [dir, action, key], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const messages: WorkerMessage[] = [];
  const waiters = new Map<string, (message: WorkerMessage) => void>();
  let stderr = '';
  child.stderr!.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
  child.on('message', (message: WorkerMessage) => {
    const waiter = waiters.get(message.kind);
    if (waiter) { waiters.delete(message.kind); waiter(message); }
    else messages.push(message);
  });
  const wait = (kind: string): Promise<WorkerMessage> => new Promise((resolve, reject) => {
    const index = messages.findIndex((message) => message.kind === kind);
    if (index >= 0) { resolve(messages.splice(index, 1)[0]!); return; }
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`worker ${action}/${kind} timed out: ${stderr}`)); }, 20_000);
    waiters.set(kind, (message) => { clearTimeout(timer); resolve(message); });
  });
  return { child, wait };
}

async function race(dir: string, action: string, keys: string[], inputs: object[] = [], forceLock = false): Promise<WorkerMessage[]> {
  const workers = keys.map((key) => worker(dir, action, key));
  let db: DatabaseSync | undefined;
  try {
    await Promise.all(workers.map((w) => w.wait('ready')));
    if (forceLock) { db = new DatabaseSync(statePath(dir)); db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE'); }
    workers.forEach((w, i) => w.child.send(inputs[i] ?? {}));
    // All children enter the critical operation while the parent's database writer
    // lock is held. This is a controlled contention window, not a timing sleep.
    await Promise.all(workers.map((w) => w.wait('attempting')));
    if (db) { db.exec('COMMIT'); db.close(); db = undefined; }
    return await Promise.all(workers.map((w) => w.wait('result')));
  } finally {
    db?.close();
    await Promise.all(workers.map(async ({ child }) => {
      if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
    }));
  }
}

test('12 independent processes initialize exactly one shared authority and consume one nonce once', async () => {
  const dir = tempDir();
  try {
    const initialized = await race(dir, 'init', Array(12).fill(''));
    assert.ok(initialized.every((message) => !message.error), JSON.stringify(initialized));
    assert.equal(new Set(initialized.map((message) => message.result)).size, 1);
    const results = await race(dir, 'nonce', Array(12).fill('same-nonce'), [], true);
    assert.ok(results.every((message) => !message.error), JSON.stringify(results));
    assert.equal(results.filter((message) => message.result === false).length, 1);
    assert.equal(results.filter((message) => message.result === true).length, 11);
    assert.equal((await race(dir, 'nonce', ['same-nonce']))[0]!.result, true, 'fresh process detects replay');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('independent processes preserve every distinct nonce without lost updates', async () => {
  const dir = tempDir();
  try {
    new FileReviewAuthorityStore(dir);
    const keys = Array.from({ length: 12 }, (_, i) => `distinct-${i}`);
    const results = await race(dir, 'nonce', keys, [], true);
    assert.ok(results.every((message) => message.result === false && !message.error), JSON.stringify(results));
    const store = new FileReviewAuthorityStore(dir);
    for (const key of keys) assert.equal(store.consumeNonce(key, Date.now() + 60_000), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const contents of ['', '{broken', '{"version":2', '{}', '{"version":999}']) {
  test(`persistent metadata fails closed: ${JSON.stringify(contents)}`, () => {
    const dir = tempDir();
    try {
      const store = new FileReviewAuthorityStore(dir);
      store.consumeNonce('recorded', Date.now() + 60_000);
      const backup = readFileSync(metadataPath(dir));
      writeFileSync(metadataPath(dir), contents);
      assert.throws(() => new FileReviewAuthorityStore(dir), /REVIEW_STORE_CORRUPT/);
      assert.throws(() => store.consumeNonce('recorded', Date.now() + 60_000), /REVIEW_STORE_CORRUPT/);
      writeFileSync(metadataPath(dir), backup);
      assert.equal(store.consumeNonce('recorded', Date.now() + 60_000), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('missing state, truncated SQLite, unsupported schema, malformed rows, and damaged secrets fail closed', () => {
  const dir = tempDir();
  try {
    const store = new FileReviewAuthorityStore(dir);
    store.consumeNonce('recorded', Date.now() + 60_000);
    for (const path of [statePath(dir), metadataPath(dir), secretPath(dir)]) {
      const backup = readFileSync(path);
      rmSync(path);
      assert.throws(() => new FileReviewAuthorityStore(dir), /REVIEW_STORE_(IO|CORRUPT)/);
      assert.throws(() => store.isCommittedSource('x'), /REVIEW_STORE_(IO|CORRUPT)/);
      writeFileSync(path, backup, { mode: 0o600 });
      for (const contents of [Buffer.alloc(0), Buffer.from('truncated'), Buffer.alloc(64, 1)]) {
        writeFileSync(path, contents);
        assert.throws(() => new FileReviewAuthorityStore(dir), /REVIEW_STORE_(IO|CORRUPT)/);
      }
      writeFileSync(path, backup);
    }
    const db = new DatabaseSync(statePath(dir));
    try {
      db.exec('PRAGMA user_version=999');
      assert.throws(() => new FileReviewAuthorityStore(dir), /unsupported database schema/);
      db.exec('PRAGMA user_version=2');
      db.prepare('INSERT INTO nonces VALUES (?, ?)').run('', 1);
      assert.throws(() => store.consumeNonce('new', Date.now() + 60_000), /invalid replay-state entry/);
      db.exec("DELETE FROM nonces WHERE key=''");
    } finally { db.close(); }
    assert.equal(store.consumeNonce('recorded', Date.now() + 60_000), true);
    if (process.platform !== 'win32') {
      assert.equal(statSync(secretPath(dir)).mode & 0o777, 0o600);
      assert.equal(statSync(statePath(dir)).mode & 0o777, 0o600);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('removing the initialized authority directory cannot silently create a fresh authority', () => {
  const dir = tempDir();
  try {
    new FileReviewAuthorityStore(dir);
    rmSync(join(dir, 'authority-v2'), { recursive: true });
    assert.throws(() => new FileReviewAuthorityStore(dir), /initialized authority directory is missing/);
    assert.equal(existsSync(join(dir, 'authority-v2')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed persistence rolls back nonce and source together and never reports acceptance', () => {
  const dir = tempDir();
  try {
    const store = new FileReviewAuthorityStore(dir);
    const db = new DatabaseSync(statePath(dir));
    try {
      db.exec("CREATE TRIGGER reject_source BEFORE INSERT ON sources BEGIN SELECT RAISE(ABORT, 'injected persist failure'); END");
      assert.throws(() => store.beginCommit('source', 'nonce', Date.now() + 60_000), /REVIEW_STORE_IO.*injected persist failure/);
      db.exec('DROP TRIGGER reject_source');
      assert.equal(store.beginCommit('source', 'nonce', Date.now() + 60_000), undefined);
      db.exec("CREATE TRIGGER reject_completion BEFORE UPDATE ON sources BEGIN SELECT RAISE(ABORT, 'injected completion failure'); END");
      assert.throws(() => store.rememberCommittedSource('source'), /injected completion failure/);
      assert.equal(store.isCommittedSource('source'), true, 'uncertain completion remains reserved');
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('commit admission rejects expired receipts without reserving a source', () => {
  const dir = tempDir();
  try {
    for (const store of [new FileReviewAuthorityStore(dir), new InMemoryReviewAuthorityStore()]) {
      assert.throws(() => store.beginCommit('expired-source', 'expired-receipt', Date.now() - 1), /receipt expired/);
      assert.equal(store.isCommittedSource('expired-source'), false);
      assert.equal(store.beginCommit('expired-source', 'valid-receipt', Date.now() + 60_000), undefined);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const outcome of ['before', 'after']) {
  test(`COMMIT acknowledgement failure ${outcome} persistence never returns acceptance`, () => {
    const dir = tempDir();
    const store = new FileReviewAuthorityStore(dir);
    const exec = DatabaseSync.prototype.exec;
    try {
      DatabaseSync.prototype.exec = function (sql: string): void {
        if (sql === 'COMMIT') {
          if (outcome === 'after') exec.call(this, sql);
          throw new Error('injected COMMIT I/O acknowledgement failure');
        }
        exec.call(this, sql);
      };
      assert.throws(() => store.beginCommit('ack-source', 'ack-nonce', Date.now() + 60_000), /REVIEW_STORE_IO.*COMMIT I\/O/);
    } finally { DatabaseSync.prototype.exec = exec; }
    try {
      const reopened = new FileReviewAuthorityStore(dir);
      assert.equal(reopened.isCommittedSource('ack-source'), outcome === 'after');
      assert.equal(reopened.consumeNonce('ack-nonce', Date.now() + 60_000), outcome === 'after');
      assert.equal(reopened.beginCommit('unrelated', 'new-nonce', Date.now() + 60_000), undefined);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('writer lock timeout fails closed; releasing the real SQLite lock restores progress', () => {
  const dir = tempDir();
  const store = new FileReviewAuthorityStore(dir);
  const db = new DatabaseSync(statePath(dir));
  try {
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => store.consumeNonce('timeout', Date.now() + 60_000), /REVIEW_STORE_BUSY/);
    db.exec('ROLLBACK');
    assert.equal(store.consumeNonce('timeout', Date.now() + 60_000), false);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('permission/read failure is explicit and cannot reset state', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const dir = tempDir();
  try {
    const store = new FileReviewAuthorityStore(dir);
    chmodSync(secretPath(dir), 0);
    assert.throws(() => store.consumeNonce('n', Date.now() + 60_000), /REVIEW_STORE_IO.*EACCES/);
    chmodSync(secretPath(dir), 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legacy migration is explicit, validates the entire pair, and preserves key and replay history', () => {
  const dir = tempDir();
  try {
    const secret = Buffer.alloc(32, 7);
    writeFileSync(join(dir, 'review-secret.key'), secret, { mode: 0o600 });
    const aliasKey = JSON.stringify(['doc', 'xlsx', 'sha']);
    const state = { version: 1, nonces: [['legacy', Date.now() + 60_000]], committedSources: [['source', Date.now()], [aliasKey, Date.now()]] };
    for (const contents of ['', '{broken', '{}', JSON.stringify({ ...state, version: 3 }), JSON.stringify({ ...state, nonces: [['n', 'bad']] })]) {
      writeFileSync(join(dir, 'review-state.json'), contents);
      assert.throws(() => new FileReviewAuthorityStore(dir, undefined, { migrateLegacy: true }), /REVIEW_STORE_CORRUPT/);
    }
    writeFileSync(join(dir, 'review-state.json'), JSON.stringify(state));
    assert.throws(() => new FileReviewAuthorityStore(dir), /explicit offline migration/);
    const store = new FileReviewAuthorityStore(dir, undefined, { migrateLegacy: true });
    assert.deepEqual(Buffer.from(store.secret), secret);
    assert.equal(store.consumeNonce('legacy', Date.now() + 60_000), true);
    assert.equal(store.isCommittedSource('source'), true);
    assert.equal(store.isCommittedSource(JSON.stringify(['doc', 'excel', 'sha'])), true);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'review-state.json'), 'utf8')), state, 'legacy backup untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an incomplete legacy pair or short key is never repaired or replaced', () => {
  for (const missing of ['review-state.json', 'review-secret.key', 'short-key']) {
    const dir = tempDir();
    try {
      const state = JSON.stringify({ version: 1, nonces: [], committedSources: [] });
      if (missing !== 'review-state.json') writeFileSync(join(dir, 'review-state.json'), state);
      if (missing !== 'review-secret.key') writeFileSync(join(dir, 'review-secret.key'), Buffer.alloc(missing === 'short-key' ? 4 : 32, 2));
      assert.throws(() => new FileReviewAuthorityStore(dir, undefined, { migrateLegacy: true }), /REVIEW_STORE_(IO|CORRUPT)/);
      assert.equal(existsSync(join(dir, 'authority-v2')), false);
      if (missing === 'short-key') assert.equal(readFileSync(join(dir, 'review-secret.key')).length, 4);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

for (const phase of ['locked', 'modified', 'committed']) {
  test(`killed SQLite writer at ${phase}: OS lock recovery and atomic journal outcome`, async () => {
    const dir = tempDir();
    const store = new FileReviewAuthorityStore(dir);
    const w = worker(dir, 'transaction', 'crash-nonce');
    try {
      await w.wait('ready'); w.child.send({ phase }); await w.wait('phase');
      const exit = once(w.child, 'exit'); w.child.kill('SIGKILL'); await exit;
      assert.equal(store.consumeNonce('crash-nonce', Date.now() + 60_000), phase === 'committed');
      assert.equal(store.consumeNonce('crash-nonce', Date.now() + 60_000), true);
    } finally { w.child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
  });
}

test('killed owner after durable reservation blocks reuse without retaining any OS lock', async () => {
  const dir = tempDir();
  new FileReviewAuthorityStore(dir);
  const w = worker(dir, 'reserve', 'uncertain-source');
  try {
    await w.wait('ready'); w.child.send({}); await w.wait('phase');
    const exit = once(w.child, 'exit'); w.child.kill('SIGKILL'); await exit;
    const store = new FileReviewAuthorityStore(dir);
    assert.equal(store.beginCommit('uncertain-source', 'different-receipt', Date.now() + 60_000), 'source-used');
    assert.equal(store.consumeNonce('nonce-uncertain-source', Date.now() + 60_000), true);
    assert.equal(store.beginCommit('unrelated-source', 'unrelated-receipt', Date.now() + 60_000), undefined);
  } finally { w.child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});

for (const phase of ['staged', 'published']) {
  test(`initializer killed at ${phase} cannot publish mismatched key/state or strand a lock`, async () => {
    const dir = tempDir();
    const w = worker(dir, 'init-crash');
    try {
      await w.wait('ready'); w.child.send({ phase }); await w.wait('phase');
      const exit = once(w.child, 'exit'); w.child.kill('SIGKILL'); await exit;
      assert.equal(existsSync(statePath(dir)), phase === 'published');
      const store = new FileReviewAuthorityStore(dir);
      assert.equal(store.consumeNonce('after-init-crash', Date.now() + 60_000), false);
      assert.deepEqual(new FileReviewAuthorityStore(dir).secret, store.secret);
    } finally { w.child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
  });
}

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

test('8 independent runtimes with different receipts race one source: exactly one verified commit', async () => {
  const dir = tempDir();
  try {
    const signing = new OtterPatchRuntime({ reviewStore: new FileReviewAuthorityStore(dir) });
    const { cs, original } = await proposeB1Set(signing);
    const proposal = signing.createProposal(cs, 'excel');
    const inputs = Array.from({ length: 8 }, (_, i) => ({ commit: {
      format: 'excel', bytes: original, changeSet: cs,
      ...signing.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), original, `reviewer-${i}`),
    } }));
    const results = await race(dir, 'commit', Array(8).fill(''), inputs, true);
    assert.equal(results.filter((message) => message.result === true).length, 1, JSON.stringify(results));
    assert.equal(results.filter((message) => /already been committed or reserved/.test(message.error ?? '')).length, 7, JSON.stringify(results));
    const sourceKey = JSON.stringify(['h1', 'excel', inputs[0]!.commit.proposal.sourceFileSha256]);
    assert.equal((await race(dir, 'source', [sourceKey]))[0]!.result, true);
    const db = new DatabaseSync(statePath(dir));
    try { assert.equal(db.prepare('SELECT status FROM sources WHERE key=?').get(sourceKey)!.status, 'committed'); }
    finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stalled writeback holds no global store lock; format aliases cannot bypass source reservation', async () => {
  const dir = tempDir();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const adapter = createBuiltinAdapterRegistry().create('excel', 'h1');
  try {
    const first = new OtterPatchRuntime({ reviewStore: new FileReviewAuthorityStore(dir) });
    const second = new OtterPatchRuntime({ reviewStore: new FileReviewAuthorityStore(dir) });
    const base = adapter.writebacks()[0]!;
    first.registerWriteback('excel', () => ({
      id: base.id, strategy: base.strategy,
      supports: base.supports.bind(base), canHandle: base.canHandle.bind(base), verify: base.verify.bind(base),
      async commit(cs, doc) { started(); await barrier; return base.commit(cs, doc); },
    }));
    const { cs, original } = await proposeB1Set(first);
    const review = first.reviewProposal(first.createProposal(cs, 'excel'), cs, cs.edits.map((edit) => edit.id), original, 'first');
    const committing = first.commit({ format: 'excel', bytes: original, changeSet: cs, ...review });
    try {
      await entered;
      const aliasReview = second.reviewProposal(second.createProposal(cs, 'xlsx'), cs, cs.edits.map((edit) => edit.id), original, 'alias');
      await assert.rejects(second.commit({ format: 'xlsx', bytes: original, changeSet: cs, ...aliasReview }), /already been committed or reserved/);
      const otherCs = { ...cs, origin: { by: 'human' as const } };
      const otherReview = second.reviewProposal(second.createProposal(otherCs, 'excel', 'other-document'), otherCs, otherCs.edits.map((edit) => edit.id), original, 'other');
      assert.equal((await second.commit({ format: 'excel', bytes: original, changeSet: otherCs, ...otherReview })).ok, true);
    } finally { release(); await committing; }
  } finally { release(); adapter.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test('completion persistence failure after verified writeback rejects instead of returning success', async () => {
  const dir = tempDir();
  try {
    const store = new FileReviewAuthorityStore(dir);
    const runtime = new OtterPatchRuntime({ reviewStore: store });
    const { cs, original } = await proposeB1Set(runtime);
    const reviewed = runtime.reviewProposal(runtime.createProposal(cs, 'excel'), cs, cs.edits.map((edit) => edit.id), original, 'reviewer');
    const db = new DatabaseSync(statePath(dir));
    try {
      db.exec("CREATE TRIGGER reject_completion BEFORE UPDATE ON sources BEGIN SELECT RAISE(ABORT, 'completion persist failed'); END");
      await assert.rejects(runtime.commit({ format: 'excel', bytes: original, changeSet: cs, ...reviewed }), /completion persist failed/);
      assert.equal(db.prepare('SELECT status FROM sources').get()!.status, 'pending');
      const again = runtime.reviewProposal(runtime.createProposal(cs, 'excel'), cs, cs.edits.map((edit) => edit.id), original, 'second');
      await assert.rejects(runtime.commit({ format: 'excel', bytes: original, changeSet: cs, ...again }), /already been committed or reserved/);
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an existing runtime refuses to issue signed proposals or receipts after corruption', async () => {
  const dir = tempDir();
  try {
    const store = new FileReviewAuthorityStore(dir);
    const runtime = new OtterPatchRuntime({ reviewStore: store });
    const { cs, original } = await proposeB1Set(runtime);
    const proposal = runtime.createProposal(cs, 'excel');
    const reviewed = runtime.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), original, 'reviewer');
    writeFileSync(metadataPath(dir), '{}');
    assert.throws(() => runtime.createProposal(cs, 'excel'), /REVIEW_STORE_CORRUPT/);
    assert.throws(() => runtime.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), original, 'reviewer'), /REVIEW_STORE_CORRUPT/);
    await assert.rejects(runtime.commit({ format: 'excel', bytes: original, changeSet: cs, ...reviewed }), /REVIEW_STORE_CORRUPT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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
