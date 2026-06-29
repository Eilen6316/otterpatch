/**
 * 分级审批 —— 把"什么算危险"(riskOf,按 EditOp 机械判定)与"危险了怎么办"(ApprovalPolicy)解耦。
 * 借鉴 codex 的分级审批策略层(与执行循环解耦),按 OtterPatch 文档操作域改写:不跑 shell,故分级的是
 * "破坏性文档操作"(删行/删区/删对象/逃生舱原生 op)。安全编辑自动放行,破坏性操作默认需人工批准。
 */
import type { ChangeSet, Edit, EditId, EditOp, EditOpKind } from './changeset.js';

export type RiskLevel = 'safe' | 'caution' | 'destructive';

const ORDER: Record<RiskLevel, number> = { safe: 0, caution: 1, destructive: 2 };

// 全 kind 覆盖(Record 强制穷举:新增 EditOpKind 时编译期逼你分级)。
const RISK_BY_KIND: Record<EditOpKind, RiskLevel> = {
  // 安全:作用域小、可逆(随附 inverse)、非结构性
  setValue: 'safe',
  setFormula: 'safe',
  replaceText: 'safe',
  insertText: 'safe',
  setStyle: 'safe',
  setNumberFormat: 'safe',
  setMark: 'safe',
  setParagraphStyle: 'safe',
  moveObject: 'safe',
  setObjectProps: 'safe',
  // 谨慎:结构性新增 / 重排,影响引用但不删数据
  insertRows: 'caution',
  insertCols: 'caution',
  sortRange: 'caution',
  mergeCells: 'caution',
  unmergeCells: 'caution',
  freezePanes: 'safe',
  conditionalFormat: 'safe',
  dataValidation: 'safe',
  addObject: 'caution',
  // 破坏性:删除数据 / 级联 / 不透明原生 op
  deleteRange: 'destructive',
  deleteRows: 'destructive',
  deleteCols: 'destructive',
  deleteObject: 'destructive',
  rawHost: 'destructive',
};

export function riskOf(op: EditOp): RiskLevel {
  return RISK_BY_KIND[op.kind] ?? 'caution';
}

const maxLevel = (a: RiskLevel, b: RiskLevel): RiskLevel => (ORDER[b] > ORDER[a] ? b : a);

export interface ChangeSetRisk {
  level: RiskLevel; // 整个 ChangeSet 的最高风险
  counts: Record<RiskLevel, number>;
  byEdit: Array<{ editId: EditId; level: RiskLevel }>;
  destructive: EditId[];
}

export function assessChangeSet(cs: ChangeSet): ChangeSetRisk {
  const counts: Record<RiskLevel, number> = { safe: 0, caution: 0, destructive: 0 };
  const byEdit: Array<{ editId: EditId; level: RiskLevel }> = [];
  const destructive: EditId[] = [];
  let level: RiskLevel = 'safe';
  for (const e of cs.edits as readonly Edit[]) {
    const lv = riskOf(e.op);
    counts[lv]++;
    byEdit.push({ editId: e.id, level: lv });
    if (lv === 'destructive') destructive.push(e.id);
    level = maxLevel(level, lv);
  }
  return { level, counts, byEdit, destructive };
}

/** 审批策略:列出的风险级别自动放行,其余需人工批准(可配置 → 与执行循环解耦)。 */
export interface ApprovalPolicy {
  autoApprove: RiskLevel[];
}
export const DEFAULT_POLICY: ApprovalPolicy = { autoApprove: ['safe', 'caution'] }; // 破坏性需人工
export const STRICT_POLICY: ApprovalPolicy = { autoApprove: ['safe'] }; // 仅安全自动
export const TRUSTED_POLICY: ApprovalPolicy = { autoApprove: ['safe', 'caution', 'destructive'] };

export interface ApprovalDecision {
  level: RiskLevel;
  auto: EditId[];
  needsApproval: EditId[];
}

export function decideApproval(cs: ChangeSet, policy: ApprovalPolicy = DEFAULT_POLICY): ApprovalDecision {
  const auto: EditId[] = [];
  const needsApproval: EditId[] = [];
  let level: RiskLevel = 'safe';
  for (const e of cs.edits as readonly Edit[]) {
    const lv = riskOf(e.op);
    level = maxLevel(level, lv);
    if (policy.autoApprove.includes(lv)) auto.push(e.id);
    else needsApproval.push(e.id);
  }
  return { level, auto, needsApproval };
}
