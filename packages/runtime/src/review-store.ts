/**
 * ReviewAuthorityStore — the durable side of the review authority.
 *
 * The HMAC secret and the replay state (consumed review-receipt nonces, committed source
 * hashes) used to live only inside the runtime process, which made multi-process or
 * restart-spanning review authority impossible. A store externalizes exactly that state:
 *  · InMemoryReviewAuthorityStore — the default, process-local replay protection
 *    (short-lived runtimes, Electron, the CLI);
 *  · FileReviewAuthorityStore — SQLite transactions on a trusted local filesystem,
 *    with an atomically published identity/secret and durable pending source claims.
 *
 * A store must make consumeNonce atomic (check-and-set): two processes receiving the same
 * receipt must not both proceed.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

export interface ReviewAuthorityStore {
  /** HMAC secret for proposal/receipt signing (at least 32 bytes). */
  readonly secret: Uint8Array;
  /** Returns true when the nonce was already consumed (replay); false when this call consumed it. */
  consumeNonce(nonce: string, expiresAt: number): boolean;
  /** Atomically consume a receipt and permanently reserve its source before any writeback. */
  beginCommit(key: string, nonce?: string, expiresAt?: number): 'nonce-used' | 'source-used' | undefined;
  /** Record that a source file (by documentKey) was successfully committed. */
  rememberCommittedSource(key: string): void;
  /** Whether the source is committed OR reserved (an uncertain attempt blocks reuse). */
  isCommittedSource(key: string): boolean;
  /** Drop expired entries; safe to call at any time. */
  prune(now: number): void;
}

const MAX_ENTRIES = 10_000;

export class ReviewStoreError extends Error {
  constructor(readonly code: 'REVIEW_STORE_CORRUPT' | 'REVIEW_STORE_IO' | 'REVIEW_STORE_BUSY' | 'REVIEW_STORE_CAPACITY' | 'REVIEW_STORE_EXPIRED', message: string, cause?: unknown) {
    super(`${code}: ${message}`, { cause });
    this.name = 'ReviewStoreError';
  }
}

/** Process-local replay state with conservative reservation before writeback. */
export class InMemoryReviewAuthorityStore implements ReviewAuthorityStore {
  readonly secret: Uint8Array;
  private readonly nonces = new Map<string, number>();
  private readonly committedSources = new Map<string, number>();

  constructor(secret: Uint8Array = randomBytes(32)) {
    this.secret = secret;
  }

  consumeNonce(nonce: string, expiresAt: number): boolean {
    this.prune(Date.now());
    if (this.nonces.has(nonce)) return true;
    if (this.nonces.size >= MAX_ENTRIES) {
      throw new Error('review nonce cache is full; wait for expired review receipts to be pruned');
    }
    this.nonces.set(nonce, expiresAt);
    return false;
  }

  beginCommit(key: string, nonce?: string, expiresAt?: number): 'nonce-used' | 'source-used' | undefined {
    if (nonce !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt! < Date.now())) throw new Error('review receipt expired');
    this.prune(Date.now());
    if (nonce && this.nonces.has(nonce)) return 'nonce-used';
    if (this.committedSources.has(key)) return 'source-used';
    if (this.committedSources.size >= MAX_ENTRIES) throw new Error('committed source cache is full');
    if (nonce && this.consumeNonce(nonce, expiresAt!)) return 'nonce-used';
    this.committedSources.set(key, Date.now());
    return undefined;
  }

  rememberCommittedSource(key: string): void {
    this.prune(Date.now());
    if (!this.committedSources.has(key) && this.committedSources.size >= MAX_ENTRIES) {
      throw new Error('committed source cache is full; restart the short-lived runtime before accepting more documents');
    }
    this.committedSources.set(key, Date.now());
  }

  isCommittedSource(key: string): boolean {
    return this.committedSources.has(key);
  }

  prune(now: number): void {
    for (const [nonce, expiry] of this.nonces) {
      if (expiry < now) this.nonces.delete(nonce);
    }
  }
}

interface LegacyState {
  version: 1;
  nonces: Array<[string, number]>;
  committedSources: Array<[string, number]>;
}
interface AuthorityIdentity { version: 2; id: string; secretHash: string }
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const corrupt = (message: string): never => { throw new ReviewStoreError('REVIEW_STORE_CORRUPT', message); };
const sqlite = (): typeof import('node:sqlite') => createRequire(import.meta.url)('node:sqlite');

/**
 * Local-filesystem SQLite authority (Node >=22.16). No database lock spans async
 * writeback: a durable pending source claim is never automatically released. An
 * interrupted attempt therefore fails closed, even if no output was returned.
 * SQLite's OS locks/journal recover killed writers; application code never deletes locks.
 */
export class FileReviewAuthorityStore implements ReviewAuthorityStore {
  readonly secret: Uint8Array;
  private readonly root: string;
  private readonly identity: AuthorityIdentity;

  constructor(directory: string, secret: Uint8Array | string = randomBytes(32), options: { migrateLegacy?: boolean } = {}) {
    this.root = join(directory, 'authority-v2');
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const initialized = join(directory, 'review-initialized');
      if (!existsSync(this.root)) {
        if (existsSync(initialized)) corrupt('initialized authority directory is missing');
        this.initialize(directory, secret, options.migrateLegacy ?? false);
      }
      this.identity = this.readIdentity();
      this.secret = new Uint8Array(readLimited(join(this.root, 'review-secret.key'), 4096));
      if (this.secret.length < 32 || this.secret.length > 4096 || digest(this.secret) !== this.identity.secretHash) corrupt('secret is invalid or does not match authority');
      this.transaction(() => undefined);
      // Publish this witness before exposing the key to callers. It distinguishes
      // deletion of authority-v2 from a genuinely new directory. A crash before the
      // witness is safe: the published authority is already complete and revalidated.
      mkdirSync(initialized, { recursive: true, mode: 0o700 });
      syncDirectory(directory);
    } catch (error) { throw storeError(error); }
  }

  consumeNonce(nonce: string, expiresAt: number): boolean {
    checkEntry(nonce, expiresAt);
    return this.transaction((db) => this.consume(db, nonce, expiresAt));
  }

  beginCommit(key: string, nonce?: string, expiresAt?: number): 'nonce-used' | 'source-used' | undefined {
    checkEntry(key, Date.now());
    if (nonce !== undefined) checkEntry(nonce, expiresAt!);
    return this.transaction((db) => {
      // Acquiring SQLite's writer lock may take seconds; recheck TTL after the wait.
      if (nonce !== undefined && expiresAt! < Date.now()) throw new ReviewStoreError('REVIEW_STORE_EXPIRED', 'review receipt expired');
      if (nonce !== undefined && db.prepare('SELECT 1 FROM nonces WHERE key=?').get(nonce)) return 'nonce-used';
      if (db.prepare('SELECT 1 FROM sources WHERE key=?').get(key)) return 'source-used';
      this.capacity(db, 'sources');
      if (nonce !== undefined) this.consume(db, nonce, expiresAt!);
      db.prepare("INSERT INTO sources VALUES (?, ?, 'pending')").run(key, Date.now());
      return undefined;
    });
  }

  rememberCommittedSource(key: string): void {
    checkEntry(key, Date.now());
    this.transaction((db) => {
      if (!db.prepare('SELECT 1 FROM sources WHERE key=?').get(key)) this.capacity(db, 'sources');
      db.prepare("INSERT INTO sources VALUES (?, ?, 'committed') ON CONFLICT(key) DO UPDATE SET status='committed'").run(key, Date.now());
    });
  }

  /** Pending claims also block commits; they are not evidence of successful output. */
  isCommittedSource(key: string): boolean {
    return this.transaction((db) => !!db.prepare('SELECT 1 FROM sources WHERE key=?').get(key));
  }

  prune(now: number): void {
    if (!Number.isSafeInteger(now)) throw new Error('invalid prune time');
    this.transaction((db) => { db.prepare('DELETE FROM nonces WHERE time < ?').run(now); });
  }

  private consume(db: DatabaseSync, nonce: string, expiry: number): boolean {
    db.prepare('DELETE FROM nonces WHERE time < ?').run(Date.now());
    if (db.prepare('SELECT 1 FROM nonces WHERE key=?').get(nonce)) return true;
    this.capacity(db, 'nonces');
    db.prepare('INSERT INTO nonces VALUES (?, ?)').run(nonce, expiry);
    return false;
  }

  private capacity(db: DatabaseSync, table: 'nonces' | 'sources'): void {
    if (Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n) >= MAX_ENTRIES) {
      throw new ReviewStoreError('REVIEW_STORE_CAPACITY', `${table} limit reached; do not clear replay history`);
    }
  }

  private readIdentity(): AuthorityIdentity {
    const value = JSON.parse(readLimited(join(this.root, 'review-state.json'), 4096).toString('utf8')) as AuthorityIdentity;
    if (!value || value.version !== 2 || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)
      || typeof value.secretHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.secretHash)) corrupt('invalid authority metadata/schema version');
    return value;
  }

  private transaction<T>(work: (db: DatabaseSync) => T): T {
    let db: DatabaseSync | undefined;
    try {
      const identity = this.readIdentity();
      if (identity.id !== this.identity.id || identity.secretHash !== this.identity.secretHash
        || digest(readLimited(join(this.root, 'review-secret.key'), 4096)) !== identity.secretHash) corrupt('authority identity/secret changed');
      const path = join(this.root, 'review-state.sqlite');
      // Do not let DatabaseSync create an empty replacement for missing/truncated state.
      const size = statSync(path).size;
      if (size < 512 || size > 256 * 1024 * 1024) corrupt('truncated or oversized database');
      db = new (sqlite().DatabaseSync)(path);
      db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
      if (db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') corrupt('database integrity check failed');
      if (db.prepare('PRAGMA user_version').get()!.user_version !== 2) corrupt('unsupported database schema version');
      const meta = db.prepare('SELECT id, secretHash FROM authority LIMIT 2').all();
      if (meta.length !== 1 || meta[0]!.id !== identity.id || meta[0]!.secretHash !== identity.secretHash) corrupt('database identity/secret mismatch');
      for (const table of ['nonces', 'sources']) {
        const rows = db.prepare(`SELECT * FROM ${table} LIMIT ${MAX_ENTRIES + 1}`).all();
        if (rows.length > MAX_ENTRIES) corrupt('database exceeds replay-state limit');
        for (const row of rows) {
          checkEntry(row.key, row.time);
          if (table === 'sources' && row.status !== 'pending' && row.status !== 'committed') corrupt('invalid source status');
        }
      }
      const result = work(db);
      db.exec('COMMIT'); // FULL synchronous: never return acceptance before persistence.
      return result;
    } catch (error) {
      if (db?.isTransaction) { try { db.exec('ROLLBACK'); } catch { /* close releases OS locks; next open recovers journal */ } }
      throw storeError(error);
    } finally { db?.close(); }
  }

  private initialize(directory: string, suppliedSecret: Uint8Array | string, migrate: boolean): void {
    let secret = typeof suppliedSecret === 'string' ? new TextEncoder().encode(suppliedSecret) : new Uint8Array(suppliedSecret);
    let legacy: LegacyState | undefined;
    const legacyState = join(directory, 'review-state.json');
    const legacySecret = join(directory, 'review-secret.key');
    if (existsSync(legacyState) || existsSync(legacySecret)) {
      // Validate even when migration was not requested. Never repair/reset a partial pair.
      legacy = JSON.parse(readLimited(legacyState, 128 * 1024 * 1024).toString('utf8')) as LegacyState;
      secret = new Uint8Array(readLimited(legacySecret, 4096));
      if (!legacy || legacy.version !== 1) corrupt('unsupported legacy schema');
      for (const entries of [legacy.nonces, legacy.committedSources]) {
        if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) corrupt('invalid legacy replay state');
        const keys = new Set<string>();
        for (const entry of entries) {
          if (!Array.isArray(entry) || entry.length !== 2) corrupt('invalid legacy entry');
          checkEntry(entry[0], entry[1]);
          if (keys.has(entry[0])) corrupt('duplicate legacy entry');
          keys.add(entry[0]);
        }
      }
      if (!migrate) throw new ReviewStoreError('REVIEW_STORE_CORRUPT', 'legacy state requires explicit offline migration (migrateLegacy: true)');
    }
    if (secret.length < 32 || secret.length > 4096) corrupt('secret must contain 32..4096 bytes');
    const stage = mkdtempSync(join(directory, '.authority-init-'));
    let db: DatabaseSync | undefined;
    try {
      const identity: AuthorityIdentity = { version: 2, id: randomUUID(), secretHash: digest(secret) };
      durableWrite(join(stage, 'review-secret.key'), secret);
      durableWrite(join(stage, 'review-state.json'), JSON.stringify(identity));
      const path = join(stage, 'review-state.sqlite');
      durableWrite(path, '');
      db = new (sqlite().DatabaseSync)(path);
      db.exec(`PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
        PRAGMA user_version=2;
        CREATE TABLE authority (id TEXT NOT NULL, secretHash TEXT NOT NULL) STRICT;
        CREATE TABLE nonces (key TEXT PRIMARY KEY, time INTEGER NOT NULL) STRICT;
        CREATE TABLE sources (key TEXT PRIMARY KEY, time INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','committed'))) STRICT;`);
      db.prepare('INSERT INTO authority VALUES (?, ?)').run(identity.id, identity.secretHash);
      for (const [key, time] of legacy?.nonces ?? []) db.prepare('INSERT INTO nonces VALUES (?, ?)').run(key, time);
      const sources = new Map(legacy?.committedSources ?? []);
      // Retain original legacy keys and additionally block canonical format aliases.
      for (const [key, time] of [...sources]) {
        let parts: unknown;
        try { parts = JSON.parse(key); } catch { continue; }
        if (Array.isArray(parts) && parts.length === 3 && parts.every((part) => typeof part === 'string')) {
          const canonical = parts[1] === 'xlsx' ? 'excel' : parts[1] === 'docx' ? 'word' : parts[1];
          sources.set(JSON.stringify([parts[0], canonical, parts[2]]), time);
        }
      }
      if (sources.size > MAX_ENTRIES) throw new ReviewStoreError('REVIEW_STORE_CAPACITY', 'legacy sources plus canonical aliases exceed capacity');
      for (const [key, time] of sources) {
        checkEntry(key, time);
        db.prepare("INSERT INTO sources VALUES (?, ?, 'committed')").run(key, time);
      }
      db.exec('COMMIT');
      db.close(); db = undefined;
      syncDirectory(stage);
      try { renameSync(stage, this.root); }
      catch (error) {
        // Concurrent initializers publish complete, nonempty directories; the winner
        // cannot be replaced by rename. Only that winner's identity will be used.
        if (!existsSync(this.root) || !['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
      syncDirectory(directory);
    } finally {
      db?.close();
      rmSync(stage, { recursive: true, force: true }); // our unpublished stage only, never another writer's locks
    }
  }
}

function checkEntry(key: unknown, time: unknown): void {
  if (typeof key !== 'string' || !key.length || Buffer.byteLength(key, 'utf8') > 4096 || typeof time !== 'number' || !Number.isSafeInteger(time) || time < 0) {
    corrupt('invalid replay-state entry');
  }
}
function readLimited(path: string, maximum: number): Buffer {
  if (statSync(path).size > maximum) corrupt(`oversized authority file: ${path}`);
  return readFileSync(path);
}
function durableWrite(path: string, value: string | Uint8Array): void {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path: string): void {
  // Windows does not expose directory fsync through Node. SQLite still uses its
  // native FULL-sync journal; initial directory publication has a power-loss caveat.
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function storeError(error: unknown): ReviewStoreError {
  if (error instanceof ReviewStoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/locked|busy/i.test(message)) return new ReviewStoreError('REVIEW_STORE_BUSY', 'SQLite lock timeout; retry only after diagnosis', error);
  if (error instanceof SyntaxError || /malformed|not a database|no such table|no such column/i.test(message)) return new ReviewStoreError('REVIEW_STORE_CORRUPT', message, error);
  return new ReviewStoreError('REVIEW_STORE_IO', message, error);
}
