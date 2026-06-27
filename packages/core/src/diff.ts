/**
 * Diff —— 三级粒度可审阅结构(batch / block / leaf)。
 * shadowApply 产出 DiffNode 树;每节点可独立接受/拒绝/回滚;接受子集 project() 成新 ChangeSet 再提交。
 * 详见 ../../../abstraction-layer.md §3。
 */
import type { LogicalAnchor } from './anchor.js';
import type {
  BoxRect,
  CellValue,
  ChangeSet,
  ChangeSetId,
  EditId,
  MarkSpec,
} from './changeset.js';
import type { MergeConflict } from './transaction.js';

export type DiffLevel = 'batch' | 'block' | 'leaf';
export type DiffDecision = 'pending' | 'accepted' | 'rejected';
export type DiffNodeId = string & { readonly __brand: 'DiffNodeId' };

export type PreviewValue =
  | { kind: 'cell'; value: CellValue; formula?: string }
  | { kind: 'text'; runs: Array<{ text: string; marks?: MarkSpec[] }> }
  | { kind: 'object'; box: BoxRect; props?: Record<string, unknown> };

export interface DiffRenderHint {
  badge: 'add' | 'remove' | 'modify' | 'move' | 'conflict';
  color?: string;
  label?: string; // 例:"=SUM 公式" / "改为粗体"
  inlineSpans?: Array<{ from: number; to: number; op: 'ins' | 'del' }>; // flow 文本字符级
}

export interface DiffNode {
  readonly id: DiffNodeId;
  readonly level: DiffLevel;
  readonly anchor: LogicalAnchor; // 覆盖层定位高亮 = toPixels(anchor)
  readonly editIds: readonly EditId[];
  readonly before: PreviewValue;
  readonly after: PreviewValue; // 含公式重算/重排结果
  readonly children: readonly DiffNode[];
  readonly render: DiffRenderHint;
  state: DiffDecision; // 可变:用户逐块决策
}

export interface DiffView {
  readonly changeSetId: ChangeSetId;
  readonly hostId: string;
  readonly root: DiffNode;
  readonly conflicts: readonly MergeConflict[];
}

export interface DiffController {
  view(): DiffView;
  /** 向上/下传播:父 reject→子全 reject;子全 accept→父 accept。 */
  setDecision(node: DiffNodeId, d: DiffDecision): void;
  acceptAll(): void;
  rejectAll(): void;
  /** 取已接受叶子的 edits 重组 ChangeSet(再走 validate→shadowApply)。 */
  project(): ChangeSet;
  /** 已提交后单块撤销:用对应 inverse 局部回滚。 */
  rollback(node: DiffNodeId): Promise<void>;
}
