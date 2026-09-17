/**
 * XlsxSurgicalWriteback — surgical OOXML write-back for Excel with a deterministic
 * post-commit semantic read-back.
 *
 * The generic SurgicalOoxmlWriteback.commit() is reused verbatim (same compiler, same
 * honest apply/drop reporting). Only verify() is upgraded: after the package/locality
 * checks, the written workbook is re-opened and every applied edit's intended effect is
 * checked against the bytes on disk (see xlsx-readback.ts). A read-back failure fails the
 * edit — the runtime never accepts an allegedly successful write it cannot observe.
 */
import type { ChangeSet, DocHandle, EditId, FidelityReport } from '@otterpatch/core';
import { SurgicalOoxmlWriteback } from '@otterpatch/writeback-surgical';
import { buildXlsxCompiler } from './xlsx-patch.js';
import { verifyXlsxReadback } from './xlsx-readback.js';

export class XlsxSurgicalWriteback extends SurgicalOoxmlWriteback {
  constructor() {
    super(buildXlsxCompiler());
  }

  async verify(before: DocHandle, after: DocHandle, cs: ChangeSet): Promise<FidelityReport> {
    const base = await super.verify(before, after, cs);
    const verification = base.verification;
    if (!verification.packageValid || !after.bytes) return base;

    const applied: EditId[] = [
      ...verification.semantic.verifiedEdits,
      ...verification.semantic.unverifiableEdits,
    ];
    const baselineFailures = verification.semantic.failedEdits;

    let readback;
    try {
      readback = verifyXlsxReadback(after.bytes, cs, new Set(applied));
    } catch (error) {
      const reason = `xlsx semantic read-back could not parse the written workbook: ${error instanceof Error ? error.message : String(error)}`;
      return {
        ...base,
        verification: {
          ...verification,
          semantic: {
            verifiedEdits: [],
            unverifiableEdits: [],
            failedEdits: [
              ...baselineFailures,
              ...applied.map((editId) => ({ editId, reason })),
            ],
          },
        },
      };
    }

    return {
      ...base,
      verification: {
        ...verification,
        semantic: {
          verifiedEdits: readback.verifiedEdits,
          unverifiableEdits: readback.unverifiableEdits,
          failedEdits: [...baselineFailures, ...readback.failedEdits],
        },
        compatibility: {
          warnings: [...new Set([...verification.compatibility.warnings, ...readback.warnings])],
        },
      },
    };
  }
}
