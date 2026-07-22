import type { ChangeSet, Edit, EditId, EditOp, EditOpKind } from './changeset.js';
import { a1RangeCellCount } from './limits.js';

export type RiskLevel = 'safe' | 'caution' | 'destructive';
export type RiskScope = 'cell' | 'range' | 'sheet' | 'document' | 'object' | 'field' | 'slide';

const ORDER: Record<RiskLevel, number> = { safe: 0, caution: 1, destructive: 2 };
const SCOPE_ORDER: Record<RiskScope, number> = { cell: 0, field: 0, object: 0, range: 1, slide: 2, sheet: 3, document: 4 };

// Conservative defaults. Context may prove a formula, move, or property edit safe;
// destructive operations can never be downgraded.
const RISK_BY_KIND: Record<EditOpKind, RiskLevel> = {
  setValue: 'safe',
  setFormula: 'caution',
  replaceText: 'safe',
  insertText: 'safe',
  setStyle: 'safe',
  setNumberFormat: 'safe',
  setMark: 'safe',
  setParagraphStyle: 'safe',
  moveObject: 'caution',
  setObjectProps: 'caution',
  insertRows: 'caution',
  insertCols: 'caution',
  sortRange: 'caution',
  mergeCells: 'caution',
  unmergeCells: 'caution',
  freezePanes: 'safe',
  autoFilter: 'safe',
  addSheet: 'caution',
  copyRange: 'caution',
  conditionalFormat: 'safe',
  dataValidation: 'safe',
  insertChart: 'caution',
  insertTable: 'caution',
  addObject: 'caution',
  deleteRange: 'destructive',
  deleteRows: 'destructive',
  deleteCols: 'destructive',
  deleteObject: 'destructive',
  rawHost: 'destructive',
};

export interface RiskContext {
  format?: string;
  resolvedScope?: RiskScope;
  affectedObjectCount?: number;
  beforeState?: unknown;
  destinationOccupied?: boolean;
  formulaDependencies?: number | readonly string[];
  protectedRegion?: boolean;
  documentWide?: boolean;
  externalReferences?: boolean;
  canvasBounds?: { left: number; top: number; width: number; height: number };
}

export interface ChangeSetRiskContext extends RiskContext {
  byEdit?: Partial<Record<EditId, RiskContext>>;
}

export interface EditRisk {
  editId?: EditId;
  level: RiskLevel;
  reasons: string[];
}

export function assessEditRisk(subject: Edit | EditOp, context: RiskContext = {}): EditRisk {
  const edit = isEdit(subject) ? subject : undefined;
  const op = edit?.op ?? subject as EditOp;
  let level = RISK_BY_KIND[op.kind] ?? 'caution';
  const reasons = [`${op.kind} defaults to ${level}`];
  const raise = (next: RiskLevel, reason: string): void => {
    if (ORDER[next] > ORDER[level]) level = next;
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const setKnownSafe = (reason: string): void => {
    if (level !== 'destructive') level = 'safe';
    reasons.push(reason);
  };

  const affected = positiveCount(context.affectedObjectCount);
  const dependencyCount = countDependencies(context.formulaDependencies);
  const before = asRecord(context.beforeState);
  const beforeHasFormula = typeof before?.formula === 'string' && before.formula.length > 0;

  if (op.kind === 'setStyle' && hasDocumentStyle(op.style)) raise('caution', 'document page style changes layout');

  if (op.kind === 'setFormula') {
    const singleEmptyCell = context.destinationOccupied === false && (affected === undefined || affected === 1);
    if (singleEmptyCell && !context.protectedRegion && !context.externalReferences && dependencyCount === 0) {
      setKnownSafe('formula targets one confirmed empty cell');
    }
    if (context.destinationOccupied === true && (beforeHasFormula || dependencyCount > 0)) {
      raise('destructive', 'formula overwrites a formula or depended-on cell');
    }
  }

  if (op.kind === 'copyRange') {
    if (context.destinationOccupied === true) raise('destructive', 'copy destination is occupied');
    else if (context.destinationOccupied === false) reasons.push('copy destination is confirmed empty');
    else raise('destructive', 'copy destination occupancy is unknown');
  }

  if (op.kind === 'moveObject') {
    const movement = classifyMovement(op.box, before, context.canvasBounds);
    if (movement === 'small') setKnownSafe('object movement is at most 3px and remains in bounds');
    else if (movement === 'outside') raise('caution', 'object would move outside the canvas');
    else reasons.push('object movement lacks a safe before-state comparison');
  }

  if (op.kind === 'setObjectProps') {
    const keys = Object.keys(op.props);
    if (keys.some((key) => ['id', 'parent', 'source', 'target'].includes(key))) {
      raise('destructive', 'object identity or relationship changes');
    } else if (op.props.imgAction === 'remove') {
      raise('destructive', 'object property edit removes an image');
    } else if (keys.every((key) => ['value', 'style'].includes(key))) {
      setKnownSafe('object property edit changes display content only');
    }
  }

  if (context.destinationOccupied === true && op.kind === 'addObject') raise('destructive', 'new object collides with an occupied destination');
  if (context.destinationOccupied === true && op.kind === 'setValue' && beforeHasFormula) raise('destructive', 'value edit replaces an existing formula');

  if (context.documentWide || context.resolvedScope === 'document' || context.resolvedScope === 'sheet') {
    raise('caution', 'edit affects a document-wide or sheet-wide scope');
  }
  if (affected !== undefined && affected > 1) raise('caution', `edit affects ${affected} targets`);
  if (affected !== undefined && affected > 1_000 && !isPresentationOnly(op.kind)) {
    raise('destructive', `edit affects more than 1000 targets`);
  }
  if (dependencyCount > 0 && (op.kind === 'copyRange' || op.kind === 'setFormula' || op.family === 'structure')) {
    raise('destructive', `edit intersects ${dependencyCount} formula dependencies`);
  }
  if (context.externalReferences) {
    if (op.kind === 'setFormula' || op.kind === 'copyRange' || op.family === 'structure') raise('destructive', 'edit affects external references');
    else raise('caution', 'edit is connected to external references');
  }
  if (context.protectedRegion) raise('destructive', 'edit targets a protected region');

  return { ...(edit ? { editId: edit.id } : {}), level, reasons };
}

export function riskOf(subject: Edit | EditOp, context: RiskContext = {}): RiskLevel {
  return assessEditRisk(subject, context).level;
}

export interface ChangeSetRisk {
  level: RiskLevel;
  counts: Record<RiskLevel, number>;
  byEdit: Array<{ editId: EditId; level: RiskLevel; reasons: string[] }>;
  destructive: EditId[];
}

export function assessChangeSet(cs: ChangeSet, context: ChangeSetRiskContext = {}): ChangeSetRisk {
  const counts: Record<RiskLevel, number> = { safe: 0, caution: 0, destructive: 0 };
  const byEdit: ChangeSetRisk['byEdit'] = [];
  const destructive: EditId[] = [];
  let level: RiskLevel = 'safe';
  for (const edit of cs.edits as readonly Edit[]) {
    const assessment = assessEditRisk(edit, contextForEdit(cs, edit, context));
    counts[assessment.level]++;
    byEdit.push({ editId: edit.id, level: assessment.level, reasons: assessment.reasons });
    if (assessment.level === 'destructive') destructive.push(edit.id);
    level = maxLevel(level, assessment.level);
  }
  return { level, counts, byEdit, destructive };
}

export interface ApprovalPolicy {
  autoApprove: RiskLevel[];
}
export const DEFAULT_POLICY: ApprovalPolicy = { autoApprove: ['safe', 'caution'] };
export const STRICT_POLICY: ApprovalPolicy = { autoApprove: ['safe'] };
export const TRUSTED_POLICY: ApprovalPolicy = { autoApprove: ['safe', 'caution', 'destructive'] };

export interface ApprovalDecision {
  level: RiskLevel;
  auto: EditId[];
  needsApproval: EditId[];
  byEdit: ChangeSetRisk['byEdit'];
}

export function decideApproval(
  cs: ChangeSet,
  policy: ApprovalPolicy = DEFAULT_POLICY,
  context: ChangeSetRiskContext = {},
): ApprovalDecision {
  const assessment = assessChangeSet(cs, context);
  const auto: EditId[] = [];
  const needsApproval: EditId[] = [];
  for (const edit of assessment.byEdit) {
    if (policy.autoApprove.includes(edit.level)) auto.push(edit.editId);
    else needsApproval.push(edit.editId);
  }
  return { level: assessment.level, auto, needsApproval, byEdit: assessment.byEdit };
}

function contextForEdit(cs: ChangeSet, edit: Edit, context: ChangeSetRiskContext): RiskContext {
  const { byEdit, ...global } = context;
  const specific = byEdit?.[edit.id] ?? {};
  const anchor = cs.anchors[edit.target];
  const derived: RiskContext = {};
  if (anchor?.portable.kind === 'grid') {
    const cells = a1RangeCellCount(anchor.portable.a1);
    if (cells !== null) derived.affectedObjectCount = cells;
    derived.resolvedScope = cells === 1 ? 'cell' : 'range';
  } else if (anchor?.portable.kind === 'flow') {
    const emptyDocumentAnchor = anchor.portable.path.length === 0 && anchor.portable.quote.text.length === 0;
    derived.documentWide = emptyDocumentAnchor && (edit.op.kind === 'setStyle' || edit.op.kind === 'insertTable');
    derived.resolvedScope = derived.documentWide ? 'document' : 'range';
    derived.affectedObjectCount = 1;
  } else if (anchor?.portable.kind === 'object') {
    derived.resolvedScope = 'object';
    derived.affectedObjectCount = 1;
  } else if (anchor?.portable.kind === 'composite') {
    derived.resolvedScope = 'range';
    derived.affectedObjectCount = anchor.portable.parts.length;
  }
  if (edit.op.kind === 'setStyle' && hasDocumentStyle(edit.op.style)) derived.documentWide = true;

  return {
    ...derived,
    ...global,
    ...specific,
    resolvedScope: widestScope(derived.resolvedScope, global.resolvedScope, specific.resolvedScope),
    affectedObjectCount: maxDefinedCount(derived.affectedObjectCount, global.affectedObjectCount, specific.affectedObjectCount),
    documentWide: Boolean(derived.documentWide || global.documentWide || specific.documentWide),
    protectedRegion: Boolean(global.protectedRegion || specific.protectedRegion),
    externalReferences: Boolean(global.externalReferences || specific.externalReferences),
  };
}

function isEdit(value: Edit | EditOp): value is Edit {
  return 'op' in value && !!value.op && typeof value.op === 'object';
}

function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER[b] > ORDER[a] ? b : a;
}

function widestScope(...scopes: Array<RiskScope | undefined>): RiskScope | undefined {
  let widest: RiskScope | undefined;
  for (const scope of scopes) if (scope && (!widest || SCOPE_ORDER[scope] > SCOPE_ORDER[widest])) widest = scope;
  return widest;
}

function positiveCount(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function maxDefinedCount(...values: Array<number | undefined>): number | undefined {
  const valid = values.map(positiveCount).filter((value): value is number => value !== undefined);
  return valid.length ? Math.max(...valid) : undefined;
}

function countDependencies(value: RiskContext['formulaDependencies']): number {
  if (Array.isArray(value)) return value.length;
  return positiveCount(value as number | undefined) ?? 0;
}

function hasDocumentStyle(style: Extract<EditOp, { kind: 'setStyle' }>['style']): boolean {
  return style.columns !== undefined || style.margin !== undefined || style.orient !== undefined;
}

function isPresentationOnly(kind: EditOpKind): boolean {
  return kind === 'setStyle' || kind === 'setNumberFormat' || kind === 'conditionalFormat' || kind === 'setMark' || kind === 'setParagraphStyle';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function classifyMovement(
  patch: Extract<EditOp, { kind: 'moveObject' }>['box'],
  beforeState: Record<string, unknown> | undefined,
  canvasBounds: RiskContext['canvasBounds'],
): 'small' | 'outside' | 'unknown' {
  const before = asBox(asRecord(beforeState?.box) ?? beforeState);
  if (!before) return 'unknown';
  const after = {
    left: patch.left ?? before.left,
    top: patch.top ?? before.top,
    width: patch.width ?? before.width,
    height: patch.height ?? before.height,
  };
  const canvas = canvasBounds ?? asBox(asRecord(beforeState?.canvasBounds));
  if (canvas && (after.left < canvas.left || after.top < canvas.top || after.left + after.width > canvas.left + canvas.width || after.top + after.height > canvas.top + canvas.height)) {
    return 'outside';
  }
  const delta = Math.max(
    Math.abs(after.left - before.left),
    Math.abs(after.top - before.top),
    Math.abs(after.width - before.width),
    Math.abs(after.height - before.height),
  );
  return delta <= 3 ? 'small' : 'unknown';
}

function asBox(value: Record<string, unknown> | undefined): { left: number; top: number; width: number; height: number } | undefined {
  if (!value) return undefined;
  const { left, top, width, height } = value;
  if (![left, top, width, height].every((item) => typeof item === 'number' && Number.isFinite(item))) return undefined;
  return { left: left as number, top: top as number, width: width as number, height: height as number };
}
