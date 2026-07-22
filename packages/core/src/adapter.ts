/**
 * Adapter contract + capability negotiation — the single "narrow waist".
 * Adding a host/format = implementing one HostAdapter. Capability negotiation is
 * front-loaded into list()/validate (the master gate).
 * See .work/abstraction-layer.md §5.
 */
import type {
  AnchorKind,
  AnchorService,
  DocRev,
  MutationLog,
  Unsubscribe,
} from './anchor.js';
import type {
  ChangeSet,
  ChangeSetEngine,
  EditId,
  EditOpKind,
  ShadowDoc,
  ShadowResult,
  ValidationReport,
  VerifyReport,
} from './changeset.js';
import type { DiffLevel, PreviewValue } from './diff.js';
import type { CapabilityStage, FormatCapabilityManifest } from './capabilities.js';
import type { WritebackBackend } from './writeback.js';

export interface HostMeta {
  format: 'excel' | 'word' | 'ppt' | 'csv' | 'db' | (string & {});
  engine: 'univer' | 'onlyoffice' | 'prosemirror' | 'pptist' | (string & {});
  headless: boolean;
}
export interface PartRef {
  hostId: string;
  sub?: string;
} // sheet / slide; Word is always a single document flow

/** Read-only structured projection request. The envelope is the cross-adapter contract;
 *  `args` carries host-specific parameters (kept opaque on purpose — payloads differ per host). */
export interface ProjectionQuery {
  kind: string; // e.g. 'outline' | 'style-usage' | 'grid-window'
  scope?: PartRef;
  args?: Readonly<Record<string, unknown>>;
}
/** Projection result envelope: typed identity + revision, host-shaped payload. */
export interface DocProjection {
  kind: string;
  rev?: DocRev;
  data: unknown; // host-shaped payload, matched to `kind` by the caller
}
export interface OverlayPort {
  mount(d: unknown): { dispose(): void };
}

export interface OpCapability {
  level: 'native' | 'downgrade' | 'unsupported';
  downgradeTo?: EditOpKind; // e.g. setFormula→setValue
  limits?: { maxCells?: number; maxTextLen?: number; maxBatchEdits?: number };
}
export type CapabilityQuery =
  | { op: EditOpKind }
  | { feature: keyof CapabilitySet['features'] }
  | { anchorKind: AnchorKind };
export type CapabilityVerdict =
  | { ok: true }
  | { ok: false; downgrade: EditOpKind; reason: string }
  | { ok: false; reason: string };

export interface CapabilitySet {
  readonly anchorKinds: readonly AnchorKind[];
  readonly diffGranularity: readonly DiffLevel[];
  readonly ops: Readonly<Partial<Record<EditOpKind, OpCapability>>>;
  readonly features: {
    shadowApply: boolean; // Univer headless: true; OnlyOffice free tier: false
    nativeUndo: boolean;
    antiDrift: 'auto' | 'reanchor' | 'none'; // Univer RefRange/PM RelPos=auto
    formulaRecalc: boolean;
    headless: boolean;
  };
  supports(q: CapabilityQuery): CapabilityVerdict;
}

/** At the validate stage, projects the abstract ChangeSet onto the target host, yielding a runnable subset + downgrades + rejections. */
export interface CapabilityNegotiator {
  negotiate(
    cs: ChangeSet,
    caps: CapabilitySet,
  ): {
    runnable: ChangeSet;
    downgraded: Array<{ editId: EditId; from: EditOpKind; to: EditOpKind; reason: string }>;
    rejected: Array<{ editId: EditId; reason: string }>;
  };
}

export interface CapabilitySetOptions {
  anchorKinds: readonly AnchorKind[];
  diffGranularity?: readonly DiffLevel[];
  features?: Partial<CapabilitySet['features']>;
}

/** Build the legacy query surface from the same manifest consumed by the runtime control plane. */
export function capabilitySetFromManifest(manifest: FormatCapabilityManifest, options: CapabilitySetOptions): CapabilitySet {
  const features: CapabilitySet['features'] = {
    shadowApply: false,
    nativeUndo: false,
    antiDrift: 'none',
    formulaRecalc: false,
    headless: true,
    ...(options.features ?? {}),
  };
  const ops = Object.fromEntries(manifest.operations.map((operation) => [
    operation.op,
    { level: operation.propose || operation.writeback ? 'native' as const : 'unsupported' as const },
  ])) as Readonly<Partial<Record<EditOpKind, OpCapability>>>;
  return {
    anchorKinds: options.anchorKinds,
    diffGranularity: options.diffGranularity ?? ['batch', 'block', 'leaf'],
    ops,
    features,
    supports: (query) => {
      if ('op' in query) {
        const capability = manifest.operations.find((candidate) => candidate.op === query.op);
        return capability && (capability.propose || capability.writeback)
          ? { ok: true }
          : { ok: false, reason: `${manifest.format} does not support ${query.op}` };
      }
      if ('anchorKind' in query) {
        return options.anchorKinds.includes(query.anchorKind)
          ? { ok: true }
          : { ok: false, reason: `${manifest.format} does not support ${query.anchorKind} anchors` };
      }
      const value = features[query.feature];
      const supported = typeof value === 'boolean' ? value : value !== 'none';
      return supported
        ? { ok: true }
        : { ok: false, reason: `${manifest.format} does not support ${query.feature}` };
    },
  };
}

export type AdapterPreviewSupport = 'verified' | 'partial' | 'unsupported';

/** Opaque envelope: each adapter validates and narrows `snapshot` to its own request/diff input. */
export interface AdapterExecutionInput {
  context?: string;
  snapshot?: unknown;
}

export interface AdapterPreviewEffect {
  target: string;
  kind: 'direct' | 'formula-recalculation' | 'reflow';
  summary: string;
  before?: PreviewValue;
  after?: PreviewValue;
  editIds?: string[];
}

export interface AdapterPreviewResult {
  shadow?: ShadowResult;
  supportByEdit: Readonly<Record<EditId, AdapterPreviewSupport>>;
  indirectEffects?: readonly AdapterPreviewEffect[];
  unavailableReason?: string;
  expectedTouchedPartsByEdit: Readonly<Record<EditId, readonly string[]>>;
}

export type AdapterProposalVerifier = (cs: ChangeSet) => VerifyReport | Promise<VerifyReport>;

/**
 * Required adapter control plane. Live-document anchors and generic change engines are optional
 * capabilities below; headless/writeback-only formats must not ship throwing placeholder methods.
 */
export interface HostAdapter {
  readonly hostId: string;
  readonly meta: HostMeta;
  manifest(): FormatCapabilityManifest | undefined;
  capabilities(): CapabilitySet;
  validate(cs: ChangeSet, stage: CapabilityStage): ValidationReport;
  proposalVerifier(input: AdapterExecutionInput): AdapterProposalVerifier | undefined;
  preview(cs: ChangeSet, input: AdapterExecutionInput): Promise<AdapterPreviewResult>;
  writebacks(): readonly WritebackBackend[];
  dispose(): void;
}

/** Optional: live selection/anchor lifecycle integration. */
export interface AnchorCapability {
  anchors(): AnchorService;
}

/** Optional: reusable format change engine for callers that own a compatible shadow snapshot. */
export interface ChangeEngineCapability {
  changes(): ChangeSetEngine;
}

/** Optional: read-only structured projections of the document (outlines, style usage, windows). */
export interface ProjectionCapability {
  project(q: ProjectionQuery): Promise<DocProjection>;
}
/** Optional: fork a shadow snapshot for verify/preview without touching the live document. */
export interface ShadowCapability {
  createShadow(scope: PartRef): Promise<ShadowDoc>;
}
/** Optional: live-document integration — revision tracking + mutation feed for anchor rebase. */
export interface LiveDocCapability {
  rev(scope: PartRef): DocRev;
  onAdvance(cb: (rev: DocRev) => void): Unsubscribe;
  observeMutations(scope: PartRef, cb: (log: MutationLog, rev: DocRev) => void): Unsubscribe;
}
/** Optional: pixel overlay port (selection lasso / diff highlights) over the host's canvas. */
export interface OverlayCapability {
  overlay(): OverlayPort;
}

export const hasAnchors = (a: HostAdapter): a is HostAdapter & AnchorCapability => 'anchors' in a;
export const hasChangeEngine = (a: HostAdapter): a is HostAdapter & ChangeEngineCapability => 'changes' in a;
export const hasProjection = (a: HostAdapter): a is HostAdapter & ProjectionCapability => 'project' in a;
export const hasShadow = (a: HostAdapter): a is HostAdapter & ShadowCapability => 'createShadow' in a;
export const hasLiveDoc = (a: HostAdapter): a is HostAdapter & LiveDocCapability => 'observeMutations' in a;
export const hasOverlay = (a: HostAdapter): a is HostAdapter & OverlayCapability => 'overlay' in a;
