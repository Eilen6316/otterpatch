/**
 * ReviewAuthorityStore — the durable side of the review authority.
 *
 * The HMAC secret and the replay state (consumed review-receipt nonces, committed source
 * hashes) used to live only inside the runtime process, which made multi-process or
 * restart-spanning review authority impossible. A store externalizes exactly that state:
 *  · InMemoryReviewAuthorityStore — the default; identical semantics to the old
 *    process-local behavior (short-lived runtimes, Electron, the CLI);
 *  · FileReviewAuthorityStore — a JSON file shared by processes on one machine, with an
 *    atomically written state file and a persisted secret; enough for multi-process
 *    deployments that share a filesystem.
 *
 * A store must make consumeNonce atomic (check-and-set): two processes receiving the same
 * receipt must not both proceed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface ReviewAuthorityStore {
  /** HMAC secret for proposal/receipt signing (at least 32 bytes). */
  readonly secret: Uint8Array;
  /** Returns true when the nonce was already consumed (replay); false when this call consumed it. */
  consumeNonce(nonce: string, expiresAt: number): boolean;
  /** Record that a source file (by documentKey) was successfully committed. */
  rememberCommittedSource(key: string): void;
  /** Whether the source file was already committed in this authority. */
  isCommittedSource(key: string): boolean;
  /** Drop expired entries; safe to call at any time. */
  prune(now: number): void;
}

const MAX_ENTRIES = 10_000;

/** Default process-local store: exact semantics of the previous in-runtime maps. */
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

  rememberCommittedSource(key: string): void {
    this.prune(Date.now());
    if (this.committedSources.size >= MAX_ENTRIES) {
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

interface SerializedState {
  version: 1;
  nonces: Array<[string, number]>;
  committedSources: Array<[string, number]>;
}

/**
 * File-backed store for processes that share a filesystem (self-hosted HTTP service,
 * multi-window desktop, sidecar deployments). The secret is persisted on first use; the
 * state file is replaced atomically (write-temp + rename) so a crash cannot leave a
 * half-written replay ledger.
 */
export class FileReviewAuthorityStore implements ReviewAuthorityStore {
  readonly secret: Uint8Array;
  private readonly statePath: string;
  private readonly secretPath: string;
  private nonces = new Map<string, number>();
  private committedSources = new Map<string, number>();

  constructor(directory: string, secret: Uint8Array | string = randomBytes(32)) {
    mkdirSync(directory, { recursive: true });
    this.secretPath = join(directory, 'review-secret.key');
    this.statePath = join(directory, 'review-state.json');
    this.secret = typeof secret === 'string' ? new TextEncoder().encode(secret) : new Uint8Array(secret);
    if (existsSync(this.secretPath)) {
      const stored = readFileSync(this.secretPath);
      // An existing secret wins: every process in the deployment must sign and verify
      // with the same key, so a persisted key is never silently replaced.
      if (stored.byteLength >= 32) this.secret = new Uint8Array(stored);
      else writeFileSync(this.secretPath, this.secret, { mode: 0o600 });
    } else {
      writeFileSync(this.secretPath, this.secret, { mode: 0o600 });
    }
    this.reload();
  }

  consumeNonce(nonce: string, expiresAt: number): boolean {
    this.reload();
    this.prune(Date.now());
    if (this.nonces.has(nonce)) return true;
    if (this.nonces.size >= MAX_ENTRIES) {
      throw new Error('review nonce cache is full; wait for expired review receipts to be pruned');
    }
    this.nonces.set(nonce, expiresAt);
    this.save();
    return false;
  }

  rememberCommittedSource(key: string): void {
    this.reload();
    this.prune(Date.now());
    if (this.committedSources.size >= MAX_ENTRIES) {
      throw new Error('committed source cache is full; clear the review state directory before accepting more documents');
    }
    this.committedSources.set(key, Date.now());
    this.save();
  }

  isCommittedSource(key: string): boolean {
    this.reload();
    return this.committedSources.has(key);
  }

  prune(now: number): void {
    let changed = false;
    for (const [nonce, expiry] of this.nonces) {
      if (expiry < now) {
        this.nonces.delete(nonce);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /**
   * Re-read the shared state file. Cross-process correctness needs read-through: another
   * process may have consumed a nonce or committed a source since this instance last loaded.
   * Missing/corrupt files are treated as empty state (a failed persist must not brick the
   * deployment; the next successful save rewrites it).
   */
  private reload(): void {
    if (!existsSync(this.statePath)) return;
    let parsed: SerializedState;
    try {
      parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as SerializedState;
      if (parsed.version !== 1) return;
    } catch {
      return;
    }
    for (const [nonce, expiry] of parsed.nonces ?? []) {
      if (typeof nonce === 'string' && Number.isFinite(expiry)) this.nonces.set(nonce, expiry);
    }
    for (const [key, time] of parsed.committedSources ?? []) {
      if (typeof key === 'string' && Number.isFinite(time)) this.committedSources.set(key, time);
    }
  }

  private save(): void {
    const state: SerializedState = {
      version: 1,
      nonces: [...this.nonces],
      committedSources: [...this.committedSources],
    };
    const tmp = `${this.statePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    try {
      renameSync(tmp, this.statePath);
    } catch (error) {
      // Windows can refuse a rename onto an open handle; a failed persist is preferable
      // to a corrupted ledger but must not be silent either.
      throw new Error(`review state persist failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
