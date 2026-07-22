/**
 * Diff — three-level reviewable structure (batch / block / leaf).
 * shadowApply produces a DiffNode tree; each node can be independently accepted/rejected/rolled back;
 * the accepted subset is project()-ed into a new ChangeSet and committed. See .work/abstraction-layer.md §3.
 */
import type { LogicalAnchor } from './anchor.js';
import type {
  BoxRect,
  AbstractStyle,
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
  | { kind: 'cell'; value: CellValue; formula?: string; style?: AbstractStyle }
  | { kind: 'text'; runs: Array<{ text: string; marks?: MarkSpec[] }> }
  | { kind: 'object'; box: BoxRect; props?: Record<string, unknown> };

export interface DiffRenderHint {
  badge: 'add' | 'remove' | 'modify' | 'move' | 'conflict';
  color?: string;
  label?: string; // e.g. "=SUM formula" / "set to bold"
  inlineSpans?: Array<{ from: number; to: number; op: 'ins' | 'del' }>; // character-level for flow text
}

export interface DiffNode {
  readonly id: DiffNodeId;
  readonly level: DiffLevel;
  readonly anchor: LogicalAnchor; // overlay highlight position = toPixels(anchor)
  readonly editIds: readonly EditId[];
  readonly before: PreviewValue;
  readonly after: PreviewValue; // includes formula recalculation / reflow results
  readonly children: readonly DiffNode[];
  readonly render: DiffRenderHint;
  state: DiffDecision; // mutable: user decides per block
}

export interface DiffView {
  readonly changeSetId: ChangeSetId;
  readonly hostId: string;
  readonly root: DiffNode;
  readonly conflicts: readonly MergeConflict[];
}

export interface DiffController {
  view(): DiffView;
  /** Propagates up/down: parent reject → all children rejected; all children accept → parent accepted. */
  setDecision(node: DiffNodeId, d: DiffDecision): void;
  acceptAll(): void;
  rejectAll(): void;
  /** Reassemble a ChangeSet from the edits of accepted leaves (then re-run validate→shadowApply). */
  project(): ChangeSet;
  /** Undo a single block after commit: partial rollback via its corresponding inverse. */
  rollback(node: DiffNodeId): Promise<void>;
}
