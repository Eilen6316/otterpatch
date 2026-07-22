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
  type FormatCapabilityManifest,
  type HostAdapter,
  type HostMeta,
  type ValidationReport,
  type WritebackBackend,
} from '@otterpatch/core';
import { SurgicalOoxmlWriteback } from '@otterpatch/writeback-surgical';
import { buildPptxCompiler } from './pptx-patch.js';
import { buildPptxVerifier, type PptxTextSnapshot } from './pptx-text.js';

function pptxManifest(): FormatCapabilityManifest {
  const manifest = capabilityManifestFor('ppt');
  if (!manifest) throw new Error('PowerPoint capability manifest is not registered');
  return manifest;
}

export class PptxAdapter implements HostAdapter {
  readonly meta: HostMeta = { format: 'ppt', engine: 'pptist', headless: true };

  constructor(readonly hostId: string) {}

  manifest(): FormatCapabilityManifest {
    return pptxManifest();
  }

  capabilities(): CapabilitySet {
    return capabilitySetFromManifest(this.manifest(), { anchorKinds: ['flow'], features: { headless: true } });
  }

  validate(cs: ChangeSet, stage: CapabilityStage): ValidationReport {
    try {
      assertChangeSet(cs);
      assertManifestCapabilities(this.manifest(), cs, stage);
      return { ok: true, issues: [] };
    } catch (error) {
      return invalid(cs, error);
    }
  }

  proposalVerifier(input: AdapterExecutionInput): AdapterProposalVerifier {
    const request = record(input.snapshot);
    const snapshot = (request?.ppt ?? input.snapshot) as PptxTextSnapshot | undefined;
    return buildPptxVerifier(snapshot);
  }

  async preview(cs: ChangeSet, _input: AdapterExecutionInput): Promise<AdapterPreviewResult> {
    const supportByEdit = Object.fromEntries(cs.edits.map((edit) => [
      edit.id,
      this.manifest().operations.some((capability) => capability.op === edit.op.kind && capability.writeback)
        ? 'partial' as const
        : 'unsupported' as const,
    ]));
    const expectedTouchedPartsByEdit = Object.fromEntries(cs.edits.map((edit) => {
      const anchor = cs.anchors[edit.target];
      const slide = anchor?.portable.kind === 'flow' ? anchor.portable.path[0] : undefined;
      return [edit.id, [slide === undefined ? 'ppt/slides' : `ppt/slides/slide${slide + 1}.xml`]];
    }));
    return {
      supportByEdit,
      expectedTouchedPartsByEdit,
      unavailableReason: 'PowerPoint preview is target lint only; no headless slide-render shadow is registered.',
    };
  }

  writebacks(): readonly WritebackBackend[] {
    return [new SurgicalOoxmlWriteback(buildPptxCompiler())];
  }

  dispose(): void {
    /* stateless */
  }
}

export const pptxAdapterRegistration: AdapterRegistration = {
  format: 'ppt',
  aliases: ['pptx'],
  engines: ['pptist'],
  manifest: pptxManifest(),
  create: (hostId) => new PptxAdapter(hostId),
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function invalid(cs: ChangeSet, error: unknown): ValidationReport {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, issues: [{ editId: cs.edits[0]?.id ?? '', code: /capability|support/i.test(message) ? 'unsupported' : 'schema', message }] };
}
