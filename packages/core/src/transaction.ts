/**
 * 并发内核 —— SuggestionTransaction 状态机 + Git 三路 rebase + 单写者提交队列。
 * 人↔Agent 协作不可降级为"最后写赢"。复用统一的 AnchorService.rebase。
 * 详见 ../../../abstraction-layer.md §6。
 */
import type { AnchorId, DocRev, MutationLog } from './anchor.js';
import type { ChangeOrigin, ChangeSet, Edit, ShadowResult } from './changeset.js';
import type { DiffDecision, DiffNodeId, DiffView, PreviewValue } from './diff.js';

export type TxId = string & { readonly __brand: 'TxId' };

export type TxState =
  | 'draft' // Agent 报计划阶段,未影子
  | 'proposed' // 已 shadowApply + diff 就绪,待审
  | 'partiallyAccepted'
  | 'staged' // 投影子集已在当前 rev 重校验通过,待提交
  | 'committing'
  | 'committed'
  | 'rejected'
  | 'rolledBack'
  | 'stale' // base 落后,需 rebase
  | 'rebasing'
  | 'conflicted'
  | 'abandoned';

export interface SuggestionTransaction {
  readonly id: TxId;
  readonly state: TxState;
  readonly changeSet: ChangeSet; // rebase 后被迁移版替换
  readonly baseRev: DocRev;
  readonly shadow?: ShadowResult;
  readonly diff?: DiffView;
  readonly decisions: ReadonlyMap<DiffNodeId, DiffDecision>;
  readonly origin: ChangeOrigin;
  readonly dependsOn?: readonly TxId[]; // 建议间依赖(B 锚定区依赖 A)
  readonly history: readonly { at: number; kind: string; detail?: unknown }[];
}

export interface MergeConflict {
  anchor: AnchorId;
  reason: 'detached' | 'overlap';
  base?: PreviewValue;
  ours?: PreviewValue;
  theirs?: PreviewValue;
  resolution?: 'ours' | 'theirs' | 'manual';
  otherTxn?: TxId;
}
export interface MergePlan {
  overlaps: Array<{ node: DiffNodeId; choices: ('ours' | 'theirs' | 'both' | 'none')[] }>;
}
export type RebaseOutcome =
  | { ok: true; tx: SuggestionTransaction }
  | { ok: false; tx: SuggestionTransaction; conflicts: MergeConflict[] };

export interface TransactionManager {
  begin(origin: ChangeOrigin, baseRev: DocRev): SuggestionTransaction;
  appendOps(tx: TxId, edits: Edit[]): SuggestionTransaction;
  propose(tx: TxId): Promise<SuggestionTransaction>; // → proposed:shadowApply + diff
  decide(tx: TxId, node: DiffNodeId, d: 'accepted' | 'rejected'): SuggestionTransaction;
  stage(tx: TxId): Promise<SuggestionTransaction>; // → staged:project + 当前 rev 重校验
  commit(tx: TxId): Promise<{ rev: DocRev }>; // 经单写者队列串行化
  reject(tx: TxId): SuggestionTransaction;
  rollback(tx: TxId): Promise<SuggestionTransaction>;
  onDocumentAdvanced(from: DocRev, to: DocRev, incoming: MutationLog): TxId[];
  rebase(tx: TxId, onto: DocRev, incoming: MutationLog): RebaseOutcome;
  rebaseOnto(txB: TxId, txA: TxId): RebaseOutcome; // 建议间
  merge(a: TxId, b: TxId): MergePlan;
}
