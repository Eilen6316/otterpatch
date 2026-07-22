/**
 * SurgicalOoxmlWriteback — surgical writeback (preferred backend).
 * Rewrites only the parts hit by edits; all other bytes pass through untouched. Algorithm
 * validated against a real .docx (30/31 parts byte-identical).
 *
 * Division of labor:
 *  - This module owns the [verified repack + integrity verify] (format-agnostic);
 *  - Knowledge of "ChangeSet → which parts, what new XML" is injected by format adapters
 *    as an OoxmlPatchCompiler (Univer knows which cell in xl/worksheets/sheetN.xml a
 *    setValue lands on; the Word adapter knows how to rewrite a run).
 *
 * See .work/abstraction-layer.md §7.
 */
import type {
  ChangeSet,
  DocHandle,
  EditId,
  EditOpKind,
  FidelityReport,
  OoxmlPart,
  WritebackBackend,
  WritebackId,
  WritebackKind,
  WritebackResult,
} from '@otterpatch/core';
import { comparePartsIntegrity, repackOoxml, type OoxmlParts } from './ooxml.js';

/** Per-edit writeback outcome: which edits actually landed on disk vs. were dropped (honest writeback). */
export interface OoxmlPatchReport {
  applied: EditId[];
  dropped: Array<{ editId: EditId; reason: string }>;
}
/** Rich compiler result: part patches + per-edit report. Bare OoxmlParts is also allowed (legacy compilers; treated as all-applied). */
export interface OoxmlPatchResult {
  parts: OoxmlParts;
  report?: OoxmlPatchReport;
}

/** Compiles a ChangeSet into "part → new bytes" (optionally with a per-edit report); supplied by format adapters. */
export type OoxmlPatchCompiler = (
  cs: ChangeSet,
  original: Uint8Array,
) => Promise<OoxmlParts | OoxmlPatchResult>;

/** Distinguishes rich result (OoxmlPatchResult) from bare OoxmlParts: the former has a non-Uint8Array .parts. */
function asPatchResult(r: OoxmlParts | OoxmlPatchResult): OoxmlPatchResult {
  if ('parts' in r && !(r.parts instanceof Uint8Array)) return r as OoxmlPatchResult;
  return { parts: r as OoxmlParts };
}

export class SurgicalOoxmlWriteback implements WritebackBackend {
  readonly id = 'surgical-ooxml' as WritebackId;
  readonly strategy: WritebackKind = 'surgical-ooxml';
  private readonly expectedPartsByOutput = new WeakMap<Uint8Array, ReadonlySet<string>>();

  constructor(private readonly compile: OoxmlPatchCompiler) {}

  /** Cross-part structural reflow (row insert rippling into formula refs / chart data sources / pivot caches) exceeds surgical patching → let the router downgrade. */
  canHandle(cs: ChangeSet): { ok: boolean; reason?: string } {
    const structural = cs.edits.some((e) => e.op.family === 'structure');
    if (structural) {
      return { ok: false, reason: 'structural reflow needs model-roundtrip / libreoffice-headless' };
    }
    return { ok: true };
  }

  supports(_op: EditOpKind, _part: OoxmlPart): boolean {
    return true; // permissive for MVP; fine-grained decisions belong to the compiler
  }

  /** Rewrite only the targeted parts, keep all other bytes as-is, repack, and self-check integrity. */
  async commit(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult> {
    const original = doc.bytes;
    if (!original) throw new Error('SurgicalOoxmlWriteback.commit: DocHandle.bytes required');
    const { parts: patches, report } = asPatchResult(await this.compile(cs, original));
    const bytes = repackOoxml(original, patches);
    this.expectedPartsByOutput.set(bytes, new Set(Object.keys(patches)));

    const integrity = comparePartsIntegrity(original, bytes);
    const expected = new Set(Object.keys(patches));
    const drift = integrity.changed
      .filter((c) => !((c.startsWith('~') || c.startsWith('+')) && expected.has(c.slice(1)))) // expected changes/additions don't count as drift
      .map((c) => ({ part: c.slice(1), kind: 'content' as const, note: `unexpected: ${c}` }));

    const fidelity: FidelityReport = {
      score: integrity.total === 0 ? 1 : integrity.identical / integrity.total,
      drift,
    };
    // Honest writeback: any dropped edit ⇒ ok=false; never report success while changes were lost.
    const dropped = report?.dropped ?? [];
    const applied = report?.applied ?? cs.edits.map((e) => e.id);
    return {
      ok: drift.length === 0 && dropped.length === 0,
      bytes,
      touchedParts: Object.keys(patches),
      fidelity,
      appliedEditIds: applied,
      droppedEdits: dropped,
    };
  }

  /** Read-back comparison (guards against document corruption); if verification fails, the transaction never reaches committed. */
  async verify(before: DocHandle, after: DocHandle, _cs: ChangeSet): Promise<FidelityReport> {
    if (!before.bytes || !after.bytes) {
      throw new Error('SurgicalOoxmlWriteback.verify: before/after bytes required');
    }
    const expectedParts = this.expectedPartsByOutput.get(after.bytes);
    if (!expectedParts) throw new Error('SurgicalOoxmlWriteback.verify: output was not produced by this backend instance');
    const integrity = comparePartsIntegrity(before.bytes, after.bytes);
    const drift = integrity.changed
      .filter((change) => !expectedParts.has(change.slice(1)))
      .map((change) => ({ part: change.slice(1), kind: 'content' as const, note: `unexpected: ${change}` }));
    return {
      score: integrity.total === 0 ? 1 : integrity.identical / integrity.total,
      drift,
    };
  }
}

export { comparePartsIntegrity, readOoxmlParts, repackOoxml } from './ooxml.js';
export type { OoxmlParts, PartsIntegrity } from './ooxml.js';
