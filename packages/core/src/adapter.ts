/**
 * 适配器契约 + 能力协商 —— 唯一"窄腰"。
 * 新增底座/格式 = 只实现一个 HostAdapter。能力协商前置到 list()/validate(总闸门)。
 * 详见 ../../../abstraction-layer.md §5。
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
} from './changeset.js';
import type { DiffLevel } from './diff.js';
import type { WritebackBackend } from './writeback.js';

export interface HostMeta {
  format: 'excel' | 'word' | 'ppt' | 'csv' | 'db' | (string & {});
  engine: 'univer' | 'onlyoffice' | 'prosemirror' | 'pptist' | (string & {});
  headless: boolean;
}
export interface PartRef {
  hostId: string;
  sub?: string;
} // sheet / slide;Word 恒单文档流
export type ProjectionQuery = unknown;
export type DocProjection = unknown;
export interface OverlayPort {
  mount(d: unknown): { dispose(): void };
}

export interface OpCapability {
  level: 'native' | 'downgrade' | 'unsupported';
  downgradeTo?: EditOpKind; // 如 setFormula→setValue
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
  readonly ops: Readonly<Record<EditOpKind, OpCapability>>;
  readonly features: {
    shadowApply: boolean; // Univer headless:true;OnlyOffice 免费:false
    nativeUndo: boolean;
    antiDrift: 'auto' | 'reanchor' | 'none'; // Univer RefRange/PM RelPos=auto
    formulaRecalc: boolean;
    headless: boolean;
  };
  supports(q: CapabilityQuery): CapabilityVerdict;
}

/** validate 阶段把抽象 ChangeSet 投影到目标底座,产可执行子集 + 降级 + 拒绝。 */
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

/** 每个底座实现一个。这是抽象层与底座之间唯一的接口。 */
export interface HostAdapter {
  readonly hostId: string;
  readonly meta: HostMeta;
  capabilities(): CapabilitySet;
  anchors(): AnchorService;
  changes(): ChangeSetEngine;
  project(q: ProjectionQuery): Promise<DocProjection>;
  writebacks(): readonly WritebackBackend[];
  overlay(): OverlayPort;
  createShadow(scope: PartRef): Promise<ShadowDoc>;
  observeMutations(
    scope: PartRef,
    cb: (log: MutationLog, rev: DocRev) => void,
  ): Unsubscribe;
  rev(scope: PartRef): DocRev;
  onAdvance(cb: (rev: DocRev) => void): Unsubscribe;
  dispose(): void;
}
