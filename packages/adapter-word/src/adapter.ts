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
import { WordRedlineWriteback } from './writeback.js';
import { buildDocVerifier, type WordVerificationSnapshot } from './verify.js';

function wordManifest(): FormatCapabilityManifest {
  const manifest = capabilityManifestFor('word');
  if (!manifest) throw new Error('Word capability manifest is not registered');
  return manifest;
}

export class WordAdapter implements HostAdapter {
  readonly meta: HostMeta = { format: 'word', engine: 'prosemirror', headless: true };

  constructor(readonly hostId: string) {}

  manifest(): FormatCapabilityManifest {
    return wordManifest();
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

  proposalVerifier(input: AdapterExecutionInput): AdapterProposalVerifier | undefined {
    const request = objectRecord(input.snapshot);
    const doc = request?.doc;
    if (isWordSnapshot(doc)) return buildDocVerifier(doc);
    return input.context?.trim() ? buildDocVerifier(input.context) : undefined;
  }

  async preview(cs: ChangeSet, _input: AdapterExecutionInput): Promise<AdapterPreviewResult> {
    return unavailablePreview(cs, this.manifest(), 'Word redline preview is rendered by the document host; no headless Word shadow is registered.');
  }

  writebacks(): readonly WritebackBackend[] {
    return [new WordRedlineWriteback()];
  }

  dispose(): void {
    /* stateless */
  }
}

export const wordAdapterRegistration: AdapterRegistration = {
  format: 'word',
  aliases: ['docx'],
  engines: ['prosemirror'],
  manifest: wordManifest(),
  create: (hostId) => new WordAdapter(hostId),
};

function isWordSnapshot(value: unknown): value is WordVerificationSnapshot {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as { blocks?: unknown }).blocks);
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unavailablePreview(cs: ChangeSet, manifest: FormatCapabilityManifest, reason: string): AdapterPreviewResult {
  const supportByEdit = Object.fromEntries(cs.edits.map((edit) => {
    const capability = manifest.operations.find((candidate) => candidate.op === edit.op.kind);
    return [edit.id, capability?.writeback ? 'partial' as const : 'unsupported' as const];
  }));
  return {
    supportByEdit,
    expectedTouchedPartsByEdit: Object.fromEntries(cs.edits.map((edit) => [edit.id, ['word/document.xml']])),
    unavailableReason: reason,
  };
}

function invalid(cs: ChangeSet, error: unknown): ValidationReport {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    issues: [{ editId: cs.edits[0]?.id ?? '', code: /capability|support/i.test(message) ? 'unsupported' : 'schema', message }],
  };
}
