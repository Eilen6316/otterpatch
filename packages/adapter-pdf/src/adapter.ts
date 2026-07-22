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
  type FormatCapabilityManifest,
  type HostAdapter,
  type HostMeta,
  type ValidationReport,
  type WritebackBackend,
} from '@otterpatch/core';
import { PdfFormWriteback } from './writeback.js';

function pdfManifest(): FormatCapabilityManifest {
  const manifest = capabilityManifestFor('pdf');
  if (!manifest) throw new Error('PDF capability manifest is not registered');
  return manifest;
}

export class PdfAdapter implements HostAdapter {
  readonly meta: HostMeta = { format: 'pdf', engine: 'pdf-lib', headless: true };

  constructor(readonly hostId: string) {}

  manifest(): FormatCapabilityManifest {
    return pdfManifest();
  }

  capabilities(): CapabilitySet {
    return capabilitySetFromManifest(this.manifest(), { anchorKinds: ['object'], features: { headless: true } });
  }

  validate(cs: ChangeSet, stage: CapabilityStage): ValidationReport {
    try {
      assertChangeSet(cs);
      assertManifestCapabilities(this.manifest(), cs, stage);
      return { ok: true, issues: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, issues: [{ editId: cs.edits[0]?.id ?? '', code: /capability|support/i.test(message) ? 'unsupported' : 'schema', message }] };
    }
  }

  proposalVerifier(_input: AdapterExecutionInput): undefined {
    return undefined;
  }

  async preview(cs: ChangeSet, _input: AdapterExecutionInput): Promise<AdapterPreviewResult> {
    return {
      supportByEdit: Object.fromEntries(cs.edits.map((edit) => [
        edit.id,
        this.manifest().operations.some((capability) => capability.op === edit.op.kind && capability.writeback)
          ? 'partial' as const
          : 'unsupported' as const,
      ])),
      expectedTouchedPartsByEdit: Object.fromEntries(cs.edits.map((edit) => [edit.id, ['pdf/AcroForm']])),
      unavailableReason: 'PDF form fill has no byte-local shadow preview; final semantic checks run after serialization.',
    };
  }

  writebacks(): readonly WritebackBackend[] {
    return [new PdfFormWriteback()];
  }

  dispose(): void {
    /* stateless */
  }
}

export const pdfAdapterRegistration: AdapterRegistration = {
  format: 'pdf',
  engines: ['pdf-lib'],
  manifest: pdfManifest(),
  create: (hostId) => new PdfAdapter(hostId),
};
