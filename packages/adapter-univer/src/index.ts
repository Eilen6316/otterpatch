/**
 * UniverAdapter — Excel control-plane adapter.
 *
 * Owns the Excel capability manifest, deterministic grid validation/shadow preview, proposal
 * verifier, and surgical writeback candidates. Live Univer selection/overlay integration is a
 * separate optional capability and is intentionally absent from this headless adapter.
 *
 * See .work/abstraction-layer.md §5 and §9 (MVP minimal subset).
 */
import {
  assertChangeSet,
  assertManifestCapabilities,
  capabilityManifestFor,
  capabilitySetFromManifest,
  type AdapterExecutionInput,
  type AdapterPreviewResult,
  type AdapterRegistration,
  type CapabilitySet,
  type CapabilityStage,
  type ChangeSet,
  type ChangeSetEngine,
  type FormatCapabilityManifest,
  type HostAdapter,
  type HostMeta,
  type ValidationReport,
  type WritebackBackend,
} from '@otterpatch/core';
import { SurgicalOoxmlWriteback } from '@otterpatch/writeback-surgical';
import { buildXlsxCompiler } from './xlsx-patch.js';
import { GridChangeSetEngine } from './grid-engine.js';
import { buildGridVerifier } from './grid-verify.js';
import { buildExcelAdapterPreview, sheetSnapshotFromAdapterInput } from './adapter-preview.js';

const manifest = (): FormatCapabilityManifest => {
  const value = capabilityManifestFor('excel');
  if (!value) throw new Error('Excel capability manifest is not registered');
  return value;
};

export class UniverAdapter implements HostAdapter {
  readonly hostId: string;
  readonly meta: HostMeta = { format: 'excel', engine: 'univer', headless: true };

  constructor(hostId: string) {
    this.hostId = hostId;
  }

  manifest(): FormatCapabilityManifest {
    return manifest();
  }
  capabilities(): CapabilitySet {
    return capabilitySetFromManifest(this.manifest(), {
      anchorKinds: ['grid'],
      features: { shadowApply: true, formulaRecalc: true, headless: true },
    });
  }
  changes(): ChangeSetEngine {
    return new GridChangeSetEngine();
  }
  validate(cs: ChangeSet, stage: CapabilityStage): ValidationReport {
    try {
      assertChangeSet(cs);
      assertManifestCapabilities(this.manifest(), cs, stage);
    } catch (error) {
      return invalid(cs, error);
    }
    return this.changes().validate(cs, this.capabilities());
  }
  proposalVerifier(input: AdapterExecutionInput): ReturnType<typeof buildGridVerifier> | undefined {
    const sheet = sheetSnapshotFromAdapterInput(input);
    return sheet ? buildGridVerifier(sheet) : undefined;
  }
  preview(cs: ChangeSet, input: AdapterExecutionInput): Promise<AdapterPreviewResult> {
    return buildExcelAdapterPreview(cs, input);
  }
  writebacks(): readonly WritebackBackend[] {
    // Real write-back: surgical OOXML patch + the xlsx ChangeSet→part compiler.
    return [new SurgicalOoxmlWriteback(buildXlsxCompiler())];
  }
  dispose(): void {
    /* no-op */
  }
  // Optional live-host capabilities are intentionally absent rather than represented by throw-only methods.
}

/** Registration entry: plugs Excel (Univer) into the AdapterRegistry. Call registry.register(univerAdapterRegistration) at app startup. */
export const univerAdapterRegistration: AdapterRegistration = {
  format: 'excel',
  aliases: ['xlsx'],
  engines: ['univer'],
  manifest: manifest(),
  create: (hostId) => new UniverAdapter(hostId),
};

export { buildXlsxCompiler } from './xlsx-patch.js';
export {
  GridChangeSetEngine,
  GridSimulationError,
  expandGridRange,
  gridEngineSupports,
  gridShadow,
  type GridCell,
  type GridShadow,
  type GridSimulationCode,
} from './grid-engine.js';
export {
  buildGridVerifier,
  assertGridSnapshotBudget,
  gridShadowFromSnapshot,
  sheetSnapshotContains,
  sheetSnapshotHasCompleteFormulaState,
  sheetSnapshotHasStyleAt,
  type SheetSnapshot,
} from './grid-verify.js';
export { buildExcelAdapterPreview, sheetSnapshotFromAdapterInput } from './adapter-preview.js';

function invalid(cs: ChangeSet, error: unknown): ValidationReport {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    issues: [{ editId: cs.edits[0]?.id ?? '', code: /capability|support/i.test(message) ? 'unsupported' : 'schema', message }],
  };
}
