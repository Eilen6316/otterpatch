import {
  AdapterRegistry,
  assertChangeSet,
  type AdapterExecutionInput,
  type AdapterPreviewResult,
  type AdapterProposalVerifier,
  type AdapterRegistration,
  type CapabilitySet,
  type CapabilityStage,
  type ChangeSet,
  type EditOpKind,
  type HostAdapter,
  type HostMeta,
  type ValidationReport,
  type WritebackBackend,
} from '@otterpatch/core';
import { univerAdapterRegistration } from '@otterpatch/adapter-univer';
import { drawioAdapterRegistration } from '@otterpatch/adapter-drawio';
import { wordAdapterRegistration } from '@otterpatch/adapter-word';
import { pdfAdapterRegistration } from '@otterpatch/adapter-pdf';
import { pptxAdapterRegistration } from '@otterpatch/adapter-pptx';

const BUILTINS: readonly AdapterRegistration[] = [
  univerAdapterRegistration,
  wordAdapterRegistration,
  drawioAdapterRegistration,
  pdfAdapterRegistration,
  pptxAdapterRegistration,
];

export function createBuiltinAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  for (const registration of BUILTINS) registry.register(registration);
  return registry;
}

interface AdapterOverrides {
  proposalVerifier?: (input: AdapterExecutionInput) => AdapterProposalVerifier | undefined;
  writebacks?: (base: readonly WritebackBackend[]) => readonly WritebackBackend[];
}

/** Compatibility APIs decorate the selected registration instead of creating side routing tables. */
export function decorateAdapter(
  registry: AdapterRegistry,
  format: string,
  overrides: AdapterOverrides,
): void {
  const baseRegistration = registry.resolve(format);
  registry.register({
    format,
    priority: (baseRegistration?.priority ?? 0) + 1,
    ...(baseRegistration?.manifest ? { manifest: baseRegistration.manifest } : {}),
    create: (hostId) => new AdapterDecorator(
      baseRegistration?.create(hostId) ?? new ExtensionAdapter(hostId, format),
      overrides,
    ),
  });
}

class AdapterDecorator implements HostAdapter {
  readonly hostId: string;
  readonly meta: HostMeta;

  constructor(private readonly base: HostAdapter, private readonly overrides: AdapterOverrides) {
    this.hostId = base.hostId;
    this.meta = base.meta;
  }

  manifest(): ReturnType<HostAdapter['manifest']> {
    return this.base.manifest();
  }

  capabilities(): CapabilitySet {
    return this.base.capabilities();
  }

  validate(cs: ChangeSet, stage: CapabilityStage): ValidationReport {
    return this.base.validate(cs, stage);
  }

  proposalVerifier(input: AdapterExecutionInput): AdapterProposalVerifier | undefined {
    return this.overrides.proposalVerifier ? this.overrides.proposalVerifier(input) : this.base.proposalVerifier(input);
  }

  preview(cs: ChangeSet, input: AdapterExecutionInput): Promise<AdapterPreviewResult> {
    return this.base.preview(cs, input);
  }

  writebacks(): readonly WritebackBackend[] {
    const base = this.base.writebacks();
    return this.overrides.writebacks ? this.overrides.writebacks(base) : base;
  }

  dispose(): void {
    this.base.dispose();
  }
}

class ExtensionAdapter implements HostAdapter {
  readonly meta: HostMeta;

  constructor(readonly hostId: string, format: string) {
    this.meta = { format, engine: 'runtime-extension', headless: true };
  }

  manifest(): undefined {
    return undefined;
  }

  capabilities(): CapabilitySet {
    const ops = {} as Readonly<Partial<Record<EditOpKind, { level: 'native' }>>>;
    return {
      anchorKinds: ['grid', 'flow', 'object', 'composite'],
      diffGranularity: ['batch', 'block', 'leaf'],
      ops,
      features: { shadowApply: false, nativeUndo: false, antiDrift: 'none', formulaRecalc: false, headless: true },
      supports: () => ({ ok: true }),
    };
  }

  validate(cs: ChangeSet, _stage: CapabilityStage): ValidationReport {
    try {
      assertChangeSet(cs);
      return { ok: true, issues: [] };
    } catch (error) {
      return {
        ok: false,
        issues: [{ editId: cs.edits[0]?.id ?? '', code: 'schema', message: error instanceof Error ? error.message : String(error) }],
      };
    }
  }

  proposalVerifier(_input: AdapterExecutionInput): undefined {
    return undefined;
  }

  async preview(cs: ChangeSet, _input: AdapterExecutionInput): Promise<AdapterPreviewResult> {
    return {
      supportByEdit: Object.fromEntries(cs.edits.map((edit) => [edit.id, 'partial' as const])),
      expectedTouchedPartsByEdit: Object.fromEntries(cs.edits.map((edit) => [edit.id, ['extension-defined']])),
      unavailableReason: `No ${this.meta.format} preview simulation is registered.`,
    };
  }

  writebacks(): readonly WritebackBackend[] {
    return [];
  }

  dispose(): void {
    /* stateless */
  }
}
