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
  /** Existing package parts that must be removed as part of this patch. */
  removedParts?: string[];
  report?: OoxmlPatchReport;
}

/** Compiles a ChangeSet into "part → new bytes" (optionally with a per-edit report); supplied by format adapters. */
export type OoxmlPatchCompiler = (
  cs: ChangeSet,
  original: Uint8Array,
) => Promise<OoxmlParts | OoxmlPatchResult>;

export interface OoxmlSemanticOutcome {
  verifiedEdits: EditId[];
  unverifiableEdits: EditId[];
  failedEdits: Array<{ editId: EditId; reason: string }>;
}

interface OoxmlOutputExpectation {
  intendedParts: string[];
  semantic: OoxmlSemanticOutcome;
  warnings: string[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Build one comparable report: score is locality only; package, semantics, and compatibility stay separate. */
export function ooxmlFidelityReport(
  before: Uint8Array,
  after: Uint8Array,
  intendedPartNames: readonly string[],
  semantic: OoxmlSemanticOutcome,
  compatibilityWarnings: readonly string[] = [],
): FidelityReport {
  const intendedParts = unique(intendedPartNames);
  try {
    const integrity = comparePartsIntegrity(before, after);
    const intended = new Set(intendedParts);
    const unexpectedChanges = integrity.changed.filter((change) => !intended.has(change.slice(1)));
    const unexpectedParts = unexpectedChanges.map((change) => change.slice(1));
    const outsideTotal = Math.max(0, integrity.total - intended.size);
    const unchangedOutside = Math.max(0, outsideTotal - unexpectedChanges.length);
    const unchangedPartRatio = outsideTotal === 0 ? 1 : unchangedOutside / outsideTotal;
    return {
      score: unchangedPartRatio,
      drift: unexpectedChanges.map((change) => ({ part: change.slice(1), kind: 'content', note: `unexpected: ${change}` })),
      verification: {
        packageValid: true,
        locality: { intendedParts, unexpectedParts, unchangedPartRatio },
        semantic,
        compatibility: { warnings: unique(compatibilityWarnings) },
      },
    };
  } catch (error) {
    const reason = `OOXML package verification failed: ${error instanceof Error ? error.message : String(error)}`;
    const editIds = unique([
      ...semantic.verifiedEdits,
      ...semantic.unverifiableEdits,
      ...semantic.failedEdits.map((failure) => failure.editId),
    ]);
    return {
      score: 0,
      drift: [{ part: 'package', kind: 'content', note: reason }],
      verification: {
        packageValid: false,
        locality: { intendedParts, unexpectedParts: ['package'], unchangedPartRatio: 0 },
        semantic: { verifiedEdits: [], unverifiableEdits: [], failedEdits: editIds.map((editId) => ({ editId, reason })) },
        compatibility: { warnings: unique([...compatibilityWarnings, reason]) },
      },
    };
  }
}

/** Distinguishes rich result (OoxmlPatchResult) from bare OoxmlParts: the former has a non-Uint8Array .parts. */
function asPatchResult(r: OoxmlParts | OoxmlPatchResult): OoxmlPatchResult {
  if ('parts' in r && !(r.parts instanceof Uint8Array)) return r as OoxmlPatchResult;
  return { parts: r as OoxmlParts };
}

export class SurgicalOoxmlWriteback implements WritebackBackend {
  readonly id = 'surgical-ooxml' as WritebackId;
  readonly strategy: WritebackKind = 'surgical-ooxml';
  private readonly expectationsByOutput = new WeakMap<Uint8Array, OoxmlOutputExpectation>();

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
    const { parts: patches, removedParts = [], report } = asPatchResult(await this.compile(cs, original));
    const touchedParts = [...Object.keys(patches), ...removedParts];
    const expected = new Set(touchedParts);
    if (expected.size !== touchedParts.length) throw new Error('OOXML patch contains duplicate touched part paths');
    const bytes = repackOoxml(original, patches, {}, removedParts);
    // Honest writeback: any dropped edit ⇒ ok=false; never report success while changes were lost.
    const dropped = report?.dropped ?? [];
    const applied = report?.applied ?? cs.edits.map((e) => e.id);
    const expectation: OoxmlOutputExpectation = {
      intendedParts: touchedParts,
      semantic: { verifiedEdits: [], unverifiableEdits: applied, failedEdits: dropped },
      warnings: applied.length ? ['generic OOXML writeback does not perform format-specific semantic readback'] : [],
    };
    this.expectationsByOutput.set(bytes, expectation);
    const fidelity = ooxmlFidelityReport(original, bytes, expectation.intendedParts, expectation.semantic, expectation.warnings);
    return {
      ok: fidelity.verification.packageValid && fidelity.drift.length === 0 && dropped.length === 0,
      bytes,
      touchedParts,
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
    const expectation = this.expectationsByOutput.get(after.bytes);
    if (!expectation) throw new Error('SurgicalOoxmlWriteback.verify: output was not produced by this backend instance');
    return ooxmlFidelityReport(before.bytes, after.bytes, expectation.intendedParts, expectation.semantic, expectation.warnings);
  }
}

export { comparePartsIntegrity, readOoxmlParts, repackOoxml } from './ooxml.js';
export type { OoxmlParts, PartsIntegrity } from './ooxml.js';
