/**
 * DrawioAdapter — drawio control-plane adapter.
 *
 * Owns the drawio capability manifest, exact-id topology verifier, structured board shadow,
 * ChangeSet engine, and diagram-level surgical writeback. Live canvas selections remain an
 * optional UI capability; portable object anchors use diagram index + mxCell id.
 *
 * See .work/references.md (high-star repo survey: drawio integration approach).
 */
import {
  assertChangeSet,
  assertManifestCapabilities,
  capabilityManifestFor,
  capabilitySetFromManifest,
  type AdapterExecutionInput,
  type AdapterPreviewResult,
  type AdapterProposalVerifier,
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
import { DrawioSurgicalWriteback } from './writeback.js';
import { DrawioChangeSetEngine, DrawioSimulationError, drawioShadowFromSnapshot } from './change-engine.js';
import { buildDrawioVerifier, type DrawioVerificationSnapshot } from './verify.js';

function drawioManifest(): FormatCapabilityManifest {
  const manifest = capabilityManifestFor('drawio');
  if (!manifest) throw new Error('Drawio capability manifest is not registered');
  return manifest;
}

export class DrawioAdapter implements HostAdapter {
  readonly hostId: string;
  readonly meta: HostMeta = { format: 'drawio', engine: 'drawio', headless: true };

  constructor(hostId: string) {
    this.hostId = hostId;
  }

  manifest(): FormatCapabilityManifest {
    return drawioManifest();
  }
  capabilities(): CapabilitySet {
    return capabilitySetFromManifest(this.manifest(), {
      anchorKinds: ['object'],
      features: { shadowApply: true, headless: true },
    });
  }
  changes(): ChangeSetEngine {
    return new DrawioChangeSetEngine();
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
  proposalVerifier(input: AdapterExecutionInput): AdapterProposalVerifier | undefined {
    const request = record(input.snapshot);
    const board = request.board;
    if (isDrawioSnapshot(board)) return buildDrawioVerifier(board);
    return input.context?.trim() ? buildDrawioVerifier(input.context) : undefined;
  }
  async preview(cs: ChangeSet, input: AdapterExecutionInput): Promise<AdapterPreviewResult> {
    const request = record(input.snapshot);
    const board = request.board;
    const expectedTouchedPartsByEdit = Object.fromEntries(cs.edits.map((edit) => {
      const anchor = cs.anchors[edit.target];
      const slide = anchor?.portable.kind === 'object' ? anchor.portable.slide : undefined;
      return [edit.id, [slide === undefined ? 'drawio/diagram' : `drawio/diagram[${slide}]`]];
    }));
    const supportByEdit = Object.fromEntries(cs.edits.map((edit) => [
      edit.id,
      this.manifest().operations.some((capability) => capability.op === edit.op.kind && capability.preview)
        ? (edit.op.kind === 'setValue' || edit.op.kind === 'setObjectProps' ? 'partial' as const : 'verified' as const)
        : 'unsupported' as const,
    ]));
    if (!isDrawioSnapshot(board)) {
      return { supportByEdit, expectedTouchedPartsByEdit, unavailableReason: 'Drawio diff requires a structured board snapshot.' };
    }
    if (request.board && record(request.board).sourceEncoding === 'compressed') {
      return { supportByEdit, expectedTouchedPartsByEdit, unavailableReason: 'Compressed drawio sources cannot be shadow-applied.' };
    }
    const verification = buildDrawioVerifier(board)(cs);
    if (!verification.ok) {
      return {
        supportByEdit: downgradeVerified(supportByEdit),
        expectedTouchedPartsByEdit,
        unavailableReason: `Drawio simulation failed: ${verification.code ?? 'VERIFIER_SIMULATION_FAILED'}: ${verification.report}`,
      };
    }
    try {
      const shadow = await new DrawioChangeSetEngine().shadowApply(cs, drawioShadowFromSnapshot(board));
      return { shadow, supportByEdit, expectedTouchedPartsByEdit };
    } catch (error) {
      return {
        supportByEdit: downgradeVerified(supportByEdit),
        expectedTouchedPartsByEdit,
        unavailableReason: `Drawio simulation failed: ${error instanceof DrawioSimulationError ? error.code + ': ' : ''}${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  writebacks(): readonly WritebackBackend[] {
    return [new DrawioSurgicalWriteback()];
  }
  dispose(): void {
    /* no-op */
  }
  // Optional live-canvas capabilities are intentionally absent rather than represented by throw-only methods.
}

/** Registration entry: wires drawio into AdapterRegistry. App calls registry.register(drawioAdapterRegistration) at startup. */
export const drawioAdapterRegistration: AdapterRegistration = {
  format: 'drawio',
  engines: ['drawio'],
  manifest: drawioManifest(),
  create: (hostId) => new DrawioAdapter(hostId),
};

export { DrawioSurgicalWriteback } from './writeback.js';
export * from './mxgraph.js';
export * from './verify.js';
export * from './change-engine.js';

function isDrawioSnapshot(value: unknown): value is DrawioVerificationSnapshot {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray((value as { nodes?: unknown }).nodes)
    && Array.isArray((value as { edges?: unknown }).edges);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function downgradeVerified(values: Readonly<Record<string, 'verified' | 'partial' | 'unsupported'>>): Record<string, 'partial' | 'unsupported'> {
  return Object.fromEntries(Object.entries(values).map(([id, support]) => [id, support === 'verified' ? 'partial' : support]));
}

function invalid(cs: ChangeSet, error: unknown): ValidationReport {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, issues: [{ editId: cs.edits[0]?.id ?? '', code: /capability|support/i.test(message) ? 'unsupported' : 'schema', message }] };
}
