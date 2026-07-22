/**
 * Writeback fidelity — pluggable backends + per-edit routing + automatic fallback + verify.
 * Measured: surgical patching (surgical-ooxml) keeps 30/31 parts byte-identical on real .docx; model roundtrip rewrites 11/31.
 * See .work/abstraction-layer.md §7 and .work/kill-experiments.md.
 */
import type { DocRev } from './anchor.js';
import type { ChangeSet, EditId, EditOpKind } from './changeset.js';

export type WritebackId = string & { readonly __brand: 'WritebackId' };
export type WritebackKind =
  | 'surgical-ooxml' // Preferred: modify only the target part's XML, leave all other bytes untouched
  | 'surgical-xml' // Single-XML formats (e.g. drawio): modify only the target <diagram>, leave other bytes untouched
  | 'model-roundtrip'
  | 'libreoffice-headless'
  | 'native-command';

export interface OoxmlPart {
  path: string; // e.g. xl/worksheets/sheet1.xml, word/document.xml, ppt/slides/slideN.xml
  xpath?: string;
}

export interface VerificationMetrics {
  packageValid: boolean;
  locality: {
    intendedParts: string[];
    unexpectedParts: string[];
    /** Byte-identical ratio among parts outside intendedParts. */
    unchangedPartRatio: number;
  };
  semantic: {
    verifiedEdits: EditId[];
    unverifiableEdits: EditId[];
    failedEdits: Array<{ editId: EditId; reason: string }>;
  };
  compatibility: {
    warnings: string[];
  };
}

export interface FidelityReport {
  /** Legacy compatibility field. When verification is present, this mirrors locality.unchangedPartRatio. */
  score: number;
  drift: Array<{
    part: string;
    kind: 'style' | 'layout' | 'content' | 'formula';
    note: string;
  }>;
  verification?: VerificationMetrics;
}
export interface DocHandle {
  readonly hostId: string;
  readonly bytes?: Uint8Array;
  readonly rev: DocRev;
}
export interface WritebackResult {
  ok: boolean;
  bytes: Uint8Array;
  touchedParts: string[];
  fidelity: FidelityReport;
  fallbackUsed?: WritebackKind;
  /** Edits actually persisted (honest writeback: per-edit applied status). Omitted = backend did not report (treat all as applied). */
  appliedEditIds?: EditId[];
  /** Silently dropped edits + reasons (e.g. op unsupported by this backend, target out of range). Non-empty ⇒ ok=false. */
  droppedEdits?: Array<{ editId: EditId; reason: string }>;
}

export interface WritebackBackend {
  readonly id: WritebackId;
  readonly strategy: WritebackKind;
  canHandle(cs: ChangeSet): { ok: boolean; reason?: string }; // surgical returns no for large cross-part restructuring → fall back
  supports(op: EditOpKind, part: OoxmlPart): boolean;
  commit(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult>;
  verify(before: DocHandle, after: DocHandle, cs: ChangeSet): Promise<FidelityReport>;
}

export interface WritebackRouter {
  route(
    cs: ChangeSet,
    backends: readonly WritebackBackend[],
  ): Array<{ editIds: EditId[]; backend: WritebackBackend }>;
  /** route→commit; if verify falls short → automatically fall back to the next backend; if verification fails, the tx never enters committed. */
  commitWithFallback(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult>;
}
