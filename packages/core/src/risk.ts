/**
 * Tiered approval — decouples "what counts as dangerous" (riskOf, mechanically determined per EditOp)
 * from "what to do about it" (ApprovalPolicy). Modeled on codex's tiered approval policy layer
 * (decoupled from the execution loop), adapted to OtterPatch's document-operation domain: no shell is
 * run, so what gets tiered are "destructive document operations" (delete rows/ranges/objects, and
 * escape-hatch raw host ops). Safe edits auto-pass; destructive ops require human approval by default.
 */
import type { ChangeSet, Edit, EditId, EditOp, EditOpKind } from './changeset.js';

export type RiskLevel = 'safe' | 'caution' | 'destructive';

const ORDER: Record<RiskLevel, number> = { safe: 0, caution: 1, destructive: 2 };

// Covers every kind (Record enforces exhaustiveness: adding an EditOpKind forces you to classify it at compile time).
const RISK_BY_KIND: Record<EditOpKind, RiskLevel> = {
  // Safe: small scope, reversible (carries an inverse), non-structural
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
  // Caution: structural insertion/reordering — affects references but deletes no data
  insertRows: 'caution',
  insertCols: 'caution',
  sortRange: 'caution',
  mergeCells: 'caution',
  unmergeCells: 'caution',
  freezePanes: 'safe',
  autoFilter: 'safe',
  addSheet: 'safe',
  copyRange: 'safe',
  conditionalFormat: 'safe',
  dataValidation: 'safe',
  insertChart: 'caution',
  addObject: 'caution',
  // Destructive: deletes data / cascades / opaque raw host ops
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
  level: RiskLevel; // Highest risk across the whole ChangeSet
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

/** Approval policy: listed risk levels auto-pass; everything else needs human approval (configurable → decoupled from the execution loop). */
export interface ApprovalPolicy {
  autoApprove: RiskLevel[];
}
export const DEFAULT_POLICY: ApprovalPolicy = { autoApprove: ['safe', 'caution'] }; // Destructive requires human approval
export const STRICT_POLICY: ApprovalPolicy = { autoApprove: ['safe'] }; // Only safe auto-passes
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
