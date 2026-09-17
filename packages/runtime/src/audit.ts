/**
 * Durable commit audit ledger — the "merged PR" record of the Office-as-PR model.
 *
 * The review authority (secret, nonces, committed sources) prevents replays; it is NOT a
 * history of what was reviewed and merged. This ledger is: an append-only record per
 * commit attempt — who reviewed, which edits were accepted, the exact source→output hashes,
 * which backend landed them, and the verification outcome. Runtime appends automatically;
 * hosts read it back to show a Git-like commit history and to audit after the fact.
 *
 * Deliberately host-side and opt-in: the default is no ledger (no behavior change), a
 * shared deployment points every instance at the same directory/env, and the runtime never
 * reads it back for control flow — it is evidence, not a gate.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CommitAuditVerification {
  packageValid: boolean;
  verifiedEdits: string[];
  unverifiableEdits: string[];
  failedEdits: Array<{ editId: string; reason: string }>;
}

export interface CommitAuditRecord {
  ts: string;
  documentId: string;
  format: string;
  /** Proposal id from the signed ProposalEnvelope (undefined for unreviewed commits). */
  proposalId?: string;
  /** Reviewer session id from the ReviewReceipt (undefined for unreviewed commits). */
  reviewerSessionId?: string;
  /** 'receipt' = signed proposal + human review; 'unreviewed' = explicitly enabled exception. */
  reviewKind: 'receipt' | 'unreviewed';
  changeSetId: string;
  changeSetSha256?: string;
  intent: string;
  editCount: number;
  acceptedEditIds: string[];
  sourceSha256: string;
  /** Output hash — only present when the commit succeeded. */
  outputSha256?: string;
  backendId: string;
  ok: boolean;
  touchedParts: string[];
  fidelity: number;
  verification: CommitAuditVerification;
  /** Where the new bytes came from, e.g. the signed proposal's bound source. */
  droppedEdits?: Array<{ editId: string; reason: string }>;
}

export interface AuditLedger {
  append(record: CommitAuditRecord): void;
  /** Records for one document (or all when documentId is omitted), oldest first. */
  read(documentId?: string): CommitAuditRecord[];
}

/** In-memory ledger: tests and short-lived runtimes. */
export class MemoryAuditLedger implements AuditLedger {
  private readonly records: CommitAuditRecord[] = [];

  append(record: CommitAuditRecord): void {
    this.records.push(record);
  }

  read(documentId?: string): CommitAuditRecord[] {
    return this.records.filter((record) => documentId === undefined || record.documentId === documentId);
  }
}

/**
 * File ledger: one JSONL file per document under `directory` (append-only, so a crash
 * mid-write can at most truncate the last line, which readers skip). Multiple processes
 * sharing the directory share the history — same deployment story as the review store.
 */
export class FileAuditLedger implements AuditLedger {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  append(record: CommitAuditRecord): void {
    const file = this.fileFor(record.documentId);
    appendFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });
  }

  read(documentId?: string): CommitAuditRecord[] {
    const files = documentId === undefined
      ? this.allFiles()
      : [this.fileFor(documentId)];
    const records: CommitAuditRecord[] = [];
    for (const file of files) {
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          records.push(JSON.parse(line) as CommitAuditRecord);
        } catch {
          // A truncated last line (crash mid-append) is evidence of an interrupted write,
          // not of corruption of earlier records; skip it rather than fail the read.
        }
      }
    }
    return records.sort((left, right) => left.ts.localeCompare(right.ts));
  }

  private fileFor(documentId: string): string {
    return join(this.directory, `${encodeURIComponent(documentId)}.jsonl`);
  }

  private allFiles(): string[] {
    try {
      return readdirSync(this.directory).map((name) => join(this.directory, name));
    } catch {
      return [];
    }
  }
}

/** Env-var driven ledger selection for the serve/CLI surfaces; undefined = no ledger. */
export function auditLedgerFromEnv(directory?: string): AuditLedger | undefined {
  const dir = (directory ?? process.env.OtterPatch_AUDIT_DIR ?? '').trim();
  return dir ? new FileAuditLedger(dir) : undefined;
}
