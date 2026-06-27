/**
 * ChangeSet + EditOp —— 唯一的"编辑"货币。
 * 任何来源(Agent/技能/示范/人工)都只产 ChangeSet;通过 AnchorId 寻址。
 * 详见 ../../../abstraction-layer.md §2。
 */
import type { AnchorId, DocRev, LogicalAnchor, MutationLog } from './anchor.js';
import type { DiffView } from './diff.js';
import type { CapabilitySet } from './adapter.js';

export type ChangeSetId = string;
export type EditId = string;
export type CellValue = string | number | boolean | null;

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
  color?: string;
  bgColor?: string;
  align?: 'left' | 'center' | 'right';
  numberFormat?: string;
  /** 条件格式等高层意图,适配器决定原生 or 降级模拟。 */
  conditional?: { rule: string; format: AbstractStyle };
}

/** family(粗、稳定)= 能力协商 + diff 归类;kind(细)= 真实底座 API 绑定。 */
export type OpFamily = 'value' | 'text' | 'style' | 'structure' | 'object' | 'raw';

export type EditOp =
  // 格式无关核心
  | { family: 'value'; kind: 'setValue'; value: CellValue }
  | { family: 'text'; kind: 'replaceText'; text: string }
  | { family: 'text'; kind: 'insertText'; text: string; at: 'start' | 'end' }
  | { family: 'value'; kind: 'deleteRange' }
  | { family: 'style'; kind: 'setStyle'; style: AbstractStyle }
  // Excel(grid)扩展
  | { family: 'value'; kind: 'setFormula'; formula: string }
  | { family: 'style'; kind: 'setNumberFormat'; pattern: string }
  | { family: 'structure'; kind: 'insertRows'; count: number; before: boolean }
  | { family: 'structure'; kind: 'deleteRows' }
  | { family: 'structure'; kind: 'sortRange'; by: number; asc: boolean }
  // Word(flow)扩展
  | { family: 'style'; kind: 'setMark'; mark: MarkSpec }
  | { family: 'style'; kind: 'setParagraphStyle'; styleName: string }
  // PPT(object)扩展(后续)
  | { family: 'object'; kind: 'moveObject'; box: Partial<BoxRect> }
  | { family: 'object'; kind: 'setObjectProps'; props: Record<string, unknown> }
  // 逃生舱:携带某底座原生 op,必须 CapabilitySet 显式放行 + 强制随附 inverse
  | { family: 'raw'; kind: 'rawHost'; hostId: string; payload: unknown };

export type EditOpKind = EditOp['kind'];

export interface Edit {
  readonly id: EditId;
  readonly target: AnchorId; // 所有编辑都经锚点寻址
  readonly op: EditOp;
  readonly inverse?: EditOp; // Agent 预填或 shadowApply 时自动捕获 → 支撑逐块撤销
}

export interface ChangeSet {
  readonly id: ChangeSetId;
  readonly hostId: string;
  readonly baseRev: DocRev; // 提交时若 live != baseRev 必须先 rebase
  readonly anchors: Record<AnchorId, LogicalAnchor>; // 锚点表:rebase 一处迁移、N op 跟随
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
export type ShadowDoc = unknown;

/** 每个适配器实现 —— 校验/影子/反演/rebase。不直接碰 live 文档。 */
export interface ChangeSetEngine {
  validate(cs: ChangeSet, caps: CapabilitySet): ValidationReport;
  shadowApply(cs: ChangeSet, shadow: ShadowDoc): Promise<ShadowResult>;
  invert(cs: ChangeSet, applied: ShadowResult): ChangeSet;
  rebase(
    cs: ChangeSet,
    log: MutationLog,
    target: DocRev,
  ): { cs: ChangeSet; broken: EditId[] };
}
