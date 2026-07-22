/**
 * ChangeSet + EditOp — the sole "edit" currency.
 * Every source (agent/skill/demonstration/human) produces only ChangeSets; addressed via AnchorId.
 * See .work/abstraction-layer.md §2.
 */
import type { AnchorId, DocRev, LogicalAnchor, MutationLog } from './anchor.js';
import type { DiffView } from './diff.js';
import type { CapabilitySet } from './adapter.js';

export type ChangeSetId = string;
export type EditId = string;
export type CellValue = string | number | boolean | null;
export type StyleScope = 'selection' | 'paragraph' | 'section' | 'document';

export type ChangeOrigin =
  | { by: 'human' }
  | { by: 'agent'; sessionId: string }
  | { by: 'skill'; skill: string; version: string }
  | { by: 'demonstration'; ref: string };

export interface ChangeMeta {
  intent: string;
  planSummary?: string;
  risk?: 'low' | 'medium' | 'high';
}

export interface MarkSpec {
  type: 'bold' | 'italic' | 'comment' | 'highlight';
  value?: unknown;
}
export interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
}
export interface AbstractStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  bgColor?: string;
  font?: string; // font name (e.g. 宋体 / Arial)
  size?: number; // font size in points
  align?: 'left' | 'center' | 'right' | 'justify';
  numberFormat?: string;
  /** Word paragraph-level: line-spacing multiplier (1 / 1.5 / 2 …). Ignored by Excel. */
  lineSpacing?: number;
  /** Word paragraph-level: block style (heading/body/quote). Ignored by Excel. */
  block?: 'h1' | 'h2' | 'h3' | 'p' | 'blockquote';
  /** Word page-level (requires section/document scope): column count 1/2/3. */
  columns?: number;
  /** Word page-level (requires section/document scope): margin preset. */
  margin?: 'narrow' | 'normal' | 'moderate' | 'wide';
  /** Word page-level (requires section/document scope): paper orientation. */
  orient?: 'portrait' | 'landscape';
  /** High-level intents like conditional formatting; adapter decides native vs degraded emulation. */
  conditional?: { rule: string; format: AbstractStyle };
}

/** family (coarse, stable) = capability negotiation + diff grouping; kind (fine) = binding to the real host API. */
export type OpFamily = 'value' | 'text' | 'style' | 'structure' | 'object' | 'raw';

export type EditOp =
  // Format-agnostic core
  | { family: 'value'; kind: 'setValue'; value: CellValue }
  | { family: 'text'; kind: 'replaceText'; text: string }
  | { family: 'text'; kind: 'insertText'; text: string; at: 'start' | 'end' }
  | { family: 'value'; kind: 'deleteRange' }
  | { family: 'style'; kind: 'setStyle'; scope: StyleScope; style: AbstractStyle }
  // Excel (grid) extensions
  | { family: 'value'; kind: 'setFormula'; formula: string }
  | { family: 'style'; kind: 'setNumberFormat'; pattern: string }
  | { family: 'structure'; kind: 'insertRows'; count: number; before: boolean }
  | { family: 'structure'; kind: 'deleteRows'; count?: number }
  | { family: 'structure'; kind: 'sortRange'; by: number; asc: boolean }
  | { family: 'structure'; kind: 'insertCols'; count: number; before: boolean }
  | { family: 'structure'; kind: 'deleteCols'; count?: number }
  | { family: 'structure'; kind: 'mergeCells' }
  | { family: 'structure'; kind: 'unmergeCells' }
  | { family: 'structure'; kind: 'freezePanes'; rows: number; cols: number }
  | { family: 'structure'; kind: 'autoFilter' }
  | { family: 'structure'; kind: 'addSheet'; name: string }
  | { family: 'structure'; kind: 'copyRange'; to: string }
  | { family: 'object'; kind: 'insertChart'; chartType: 'bar' | 'line' | 'pie'; title: string; range?: string; categories?: string[]; series?: { name: string; data: number[] }[]; anchor?: string }
  | { family: 'style'; kind: 'conditionalFormat'; when: string; v1?: number | string; v2?: number; style: AbstractStyle }
  | { family: 'style'; kind: 'dataValidation'; rule: 'list' | 'numberBetween' | 'numberGreaterThan' | 'checkbox' | 'dateBetween'; list?: string[]; min?: number; max?: number; v?: number }
  // Word (flow) extensions
  | { family: 'structure'; kind: 'insertTable'; rows: string[][]; headerRows: number; at: 'before' | 'after' | 'end' }
  | { family: 'style'; kind: 'setMark'; mark: MarkSpec }
  | { family: 'style'; kind: 'setParagraphStyle'; styleName: string }
  // PPT (object) extensions (future)
  | { family: 'object'; kind: 'moveObject'; box: Partial<BoxRect> }
  | { family: 'object'; kind: 'setObjectProps'; props: Record<string, unknown> }
  // Add/remove objects (drawio/PPT): for addObject, target = parent/container anchor; payload is adapter-interpreted (e.g. drawio's mxCell);
  // for deleteObject, target anchor points at the object being deleted (drawio cascades edge deletion).
  | { family: 'object'; kind: 'addObject'; payload: unknown }
  | { family: 'object'; kind: 'deleteObject' }
  // Escape hatch: carries a host-native op; must be explicitly allowed by CapabilitySet + inverse is mandatory
  | { family: 'raw'; kind: 'rawHost'; hostId: string; payload: unknown };

export type EditOpKind = EditOp['kind'];

export interface Edit {
  readonly id: EditId;
  readonly target: AnchorId; // all edits are addressed via anchors
  readonly op: EditOp;
  readonly inverse?: EditOp; // pre-filled by agent or auto-captured during shadowApply → enables per-block undo
}

export interface ChangeSet {
  readonly id: ChangeSetId;
  readonly hostId: string;
  readonly baseRev: DocRev; // on commit, if live != baseRev a rebase is required first
  readonly anchors: Record<AnchorId, LogicalAnchor>; // anchor table: rebase migrates once, N ops follow
  readonly origin: ChangeOrigin;
  readonly meta: ChangeMeta;
  readonly edits: Edit[];
}

export interface ValidationReport {
  ok: boolean;
  issues: Array<{
    editId: EditId;
    code: 'schema' | 'unsupported' | 'anchor-broken';
    downgrade?: EditOp;
  }>;
}

/** Result from a declared lint, simulation, or output-verification pass. The report can
 * be fed back to the model in a propose→observe→repair loop. */
export interface VerifyReport {
  ok: boolean;
  report: string;
  /** What was actually performed; callers must not present lint as simulation or verification. */
  level?: 'lint' | 'simulation' | 'verification';
  /** Stable machine-readable failure category for repair loops and clients. */
  code?: string;
  details?: unknown;
}
export interface EffectPreview {
  recalculated?: CellValue[][];
  reflowed?: boolean;
}
export interface ShadowResult {
  afterRev: DocRev;
  diff: DiffView;
  capturedInverse: Record<EditId, EditOp>;
  effects: EffectPreview;
}
/** Host-specific shadow snapshot the engine applies edits to. Opaque to core BY DESIGN —
 *  adapters narrow it through the `ChangeSetEngine<TShadow>` generic (e.g. `GridShadow` for
 *  spreadsheets) instead of casting from a bare unknown at every use site. */
export type ShadowDoc = unknown;

/** Implemented per adapter — validate / shadow-apply / invert / rebase. Never touches the live doc.
 *  `TShadow` is the adapter's own snapshot type; it defaults to the opaque `ShadowDoc`. */
export interface ChangeSetEngine<TShadow = ShadowDoc> {
  validate(cs: ChangeSet, caps: CapabilitySet): ValidationReport;
  shadowApply(cs: ChangeSet, shadow: TShadow): Promise<ShadowResult>;
  invert(cs: ChangeSet, applied: ShadowResult): ChangeSet;
  rebase(
    cs: ChangeSet,
    log: MutationLog,
    target: DocRev,
  ): { cs: ChangeSet; broken: EditId[] };
}
