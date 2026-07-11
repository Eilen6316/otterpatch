import type { ChangeSet } from './changeset.js';

const OP_FAMILIES: Record<string, string> = {
  setValue: 'value',
  replaceText: 'text',
  insertText: 'text',
  deleteRange: 'value',
  setStyle: 'style',
  setFormula: 'value',
  setNumberFormat: 'style',
  insertRows: 'structure',
  deleteRows: 'structure',
  sortRange: 'structure',
  insertCols: 'structure',
  deleteCols: 'structure',
  mergeCells: 'structure',
  unmergeCells: 'structure',
  freezePanes: 'structure',
  autoFilter: 'structure',
  addSheet: 'structure',
  copyRange: 'structure',
  insertChart: 'object',
  conditionalFormat: 'style',
  dataValidation: 'style',
  insertTable: 'structure',
  setMark: 'style',
  setParagraphStyle: 'style',
  moveObject: 'object',
  setObjectProps: 'object',
  addObject: 'object',
  deleteObject: 'object',
  rawHost: 'raw',
};

const ANCHOR_KINDS = new Set(['grid', 'flow', 'object', 'composite']);
const INSERT_AT = new Set(['start', 'end']);
const MARK_TYPES = new Set(['bold', 'italic', 'comment', 'highlight']);
const CHART_TYPES = new Set(['bar', 'line', 'pie']);
const VALIDATION_RULES = new Set(['list', 'numberBetween', 'numberGreaterThan', 'checkbox', 'dateBetween']);
const TABLE_INSERT_AT = new Set(['before', 'after', 'end']);

export function assertChangeSet(value: unknown): asserts value is ChangeSet {
  if (!isRecord(value)) throw new Error('invalid ChangeSet: expected object');
  const cs = value as Partial<ChangeSet>;
  if (!nonEmpty(cs.id)) throw new Error('invalid ChangeSet: id required');
  if (!nonEmpty(cs.hostId)) throw new Error('invalid ChangeSet: hostId required');
  if (!isSafeNonNegativeInt(cs.baseRev)) throw new Error('invalid ChangeSet: baseRev must be a non-negative integer');
  assertMeta(cs.meta);
  assertOrigin(cs.origin);
  if (!isRecord(cs.anchors)) throw new Error('invalid ChangeSet: anchors object required');
  for (const [id, anchor] of Object.entries(cs.anchors)) assertAnchor(id, anchor, cs.hostId, cs.baseRev);
  if (!Array.isArray(cs.edits)) throw new Error('invalid ChangeSet: edits array required');

  const seen = new Set<string>();
  for (const edit of cs.edits as unknown[]) {
    if (!isRecord(edit)) throw new Error('invalid ChangeSet: edit must be object');
    if (!nonEmpty(edit.id)) throw new Error('invalid ChangeSet: edit id required');
    if (seen.has(edit.id)) throw new Error('invalid ChangeSet: duplicate edit id ' + edit.id);
    seen.add(edit.id);
    if (!nonEmpty(edit.target)) throw new Error('invalid ChangeSet: edit target required');
    if (!(edit.target in cs.anchors)) throw new Error('invalid ChangeSet: missing anchor for edit ' + edit.id);
    const op = edit.op;
    if (!isRecord(op)) throw new Error('invalid ChangeSet: edit op required');
    assertOp(op);
    if (edit.inverse !== undefined) {
      if (!isRecord(edit.inverse)) throw new Error('invalid ChangeSet: inverse op must be object');
      assertOp(edit.inverse);
    }
  }
}

function assertMeta(meta: unknown): void {
  if (!isRecord(meta)) throw new Error('invalid ChangeSet: meta required');
  if (!nonEmpty(meta.intent)) throw new Error('invalid ChangeSet: meta.intent required');
  if (meta.planSummary !== undefined && typeof meta.planSummary !== 'string') throw new Error('invalid ChangeSet: meta.planSummary must be string');
  if (meta.risk !== undefined && !['low', 'medium', 'high'].includes(String(meta.risk))) throw new Error('invalid ChangeSet: meta.risk invalid');
}

function assertOrigin(origin: unknown): void {
  if (!isRecord(origin)) throw new Error('invalid ChangeSet: origin required');
  if (!['human', 'agent', 'skill', 'demonstration'].includes(String(origin.by))) throw new Error('invalid ChangeSet: origin.by invalid');
}

function assertAnchor(id: string, value: unknown, hostId: unknown, baseRev: unknown): void {
  if (!isRecord(value)) throw new Error('invalid ChangeSet: anchor must be object');
  if (value.id !== id) throw new Error('invalid ChangeSet: anchor id mismatch ' + id);
  if (value.hostId !== hostId) throw new Error('invalid ChangeSet: anchor hostId mismatch ' + id);
  if (!ANCHOR_KINDS.has(String(value.kind))) throw new Error('invalid ChangeSet: anchor kind invalid ' + id);
  if (!isSafeNonNegativeInt(value.baseRev) || value.baseRev !== baseRev) throw new Error('invalid ChangeSet: anchor baseRev mismatch ' + id);
  if (!isRecord(value.portable)) throw new Error('invalid ChangeSet: anchor portable required ' + id);
  assertPortable(value.portable, String(value.kind), id);
}

function assertPortable(p: Record<string, unknown>, anchorKind: string, anchorId: string): void {
  if (p.kind !== anchorKind) throw new Error('invalid ChangeSet: anchor portable kind mismatch ' + anchorId);
  switch (p.kind) {
    case 'grid':
      if (!nonEmpty(p.sheet) || !nonEmpty(p.a1)) throw new Error('invalid ChangeSet: grid anchor requires sheet and a1 ' + anchorId);
      break;
    case 'flow':
      if (!Array.isArray(p.path) || !p.path.every(isSafeNonNegativeInt)) throw new Error('invalid ChangeSet: flow anchor path invalid ' + anchorId);
      if (!isRecord(p.quote) || typeof p.quote.prefix !== 'string' || typeof p.quote.text !== 'string' || typeof p.quote.suffix !== 'string') throw new Error('invalid ChangeSet: flow anchor quote invalid ' + anchorId);
      if (p.bias !== 'left' && p.bias !== 'right') throw new Error('invalid ChangeSet: flow anchor bias invalid ' + anchorId);
      break;
    case 'object':
      if (!isSafeNonNegativeInt(p.slide) || !nonEmpty(p.elementId)) throw new Error('invalid ChangeSet: object anchor requires slide and elementId ' + anchorId);
      break;
    case 'composite':
      if (!Array.isArray(p.parts) || !p.parts.length || !p.parts.every(isRecord)) throw new Error('invalid ChangeSet: composite anchor parts invalid ' + anchorId);
      break;
    default:
      throw new Error('invalid ChangeSet: unsupported portable kind ' + String(p.kind));
  }
}

function assertOp(op: Record<string, unknown>): void {
  if (typeof op.family !== 'string' || typeof op.kind !== 'string') throw new Error('invalid ChangeSet: op family/kind required');
  const expectedFamily = OP_FAMILIES[op.kind];
  if (!expectedFamily) throw new Error('invalid ChangeSet: unsupported op kind ' + op.kind);
  if (op.family !== expectedFamily) throw new Error(`invalid ChangeSet: op ${op.kind} must use family ${expectedFamily}`);

  switch (op.kind) {
    case 'setValue':
      if (!isCellValue(op.value)) throw new Error('invalid ChangeSet: setValue.value invalid');
      break;
    case 'replaceText':
      if (typeof op.text !== 'string') throw new Error('invalid ChangeSet: replaceText.text required');
      break;
    case 'insertText':
      if (typeof op.text !== 'string' || !INSERT_AT.has(String(op.at))) throw new Error('invalid ChangeSet: insertText requires text and at');
      break;
    case 'setStyle':
      if (!isRecord(op.style)) throw new Error('invalid ChangeSet: setStyle.style required');
      break;
    case 'setFormula':
      if (!nonEmpty(op.formula)) throw new Error('invalid ChangeSet: setFormula.formula required');
      break;
    case 'setNumberFormat':
      if (!nonEmpty(op.pattern)) throw new Error('invalid ChangeSet: setNumberFormat.pattern required');
      break;
    case 'insertRows':
    case 'insertCols':
      if (!isPositiveInt(op.count) || typeof op.before !== 'boolean') throw new Error('invalid ChangeSet: insert row/col requires count and before');
      break;
    case 'deleteRows':
    case 'deleteCols':
      if (op.count !== undefined && !isPositiveInt(op.count)) throw new Error('invalid ChangeSet: delete row/col count invalid');
      break;
    case 'sortRange':
      if (!isSafeNonNegativeInt(op.by) || typeof op.asc !== 'boolean') throw new Error('invalid ChangeSet: sortRange requires by and asc');
      break;
    case 'freezePanes':
      if (!isSafeNonNegativeInt(op.rows) || !isSafeNonNegativeInt(op.cols)) throw new Error('invalid ChangeSet: freezePanes rows/cols invalid');
      break;
    case 'addSheet':
      if (!nonEmpty(op.name)) throw new Error('invalid ChangeSet: addSheet.name required');
      break;
    case 'copyRange':
      if (!nonEmpty(op.to)) throw new Error('invalid ChangeSet: copyRange.to required');
      break;
    case 'insertChart':
      if (!CHART_TYPES.has(String(op.chartType)) || !nonEmpty(op.title)) throw new Error('invalid ChangeSet: insertChart chartType/title invalid');
      break;
    case 'conditionalFormat':
      if (!nonEmpty(op.when) || !isRecord(op.style)) throw new Error('invalid ChangeSet: conditionalFormat requires when/style');
      break;
    case 'dataValidation':
      if (!VALIDATION_RULES.has(String(op.rule))) throw new Error('invalid ChangeSet: dataValidation.rule invalid');
      break;
    case 'insertTable': {
      if (!Array.isArray(op.rows) || op.rows.length === 0 || op.rows.length > 100) {
        throw new Error('invalid ChangeSet: insertTable.rows must contain 1-100 rows');
      }
      const width = Array.isArray(op.rows[0]) ? op.rows[0].length : 0;
      if (width === 0 || width > 20) throw new Error('invalid ChangeSet: insertTable must contain 1-20 columns');
      for (const row of op.rows) {
        if (!Array.isArray(row) || row.length !== width) throw new Error('invalid ChangeSet: insertTable rows must have equal width');
        if (!row.every((cell) => typeof cell === 'string' && cell.length <= 10_000)) {
          throw new Error('invalid ChangeSet: insertTable cells must be strings up to 10000 characters');
        }
      }
      if (!isSafeNonNegativeInt(op.headerRows) || Number(op.headerRows) > op.rows.length) {
        throw new Error('invalid ChangeSet: insertTable.headerRows invalid');
      }
      if (!TABLE_INSERT_AT.has(String(op.at))) throw new Error('invalid ChangeSet: insertTable.at invalid');
      break;
    }
    case 'setMark':
      if (!isRecord(op.mark) || !MARK_TYPES.has(String(op.mark.type))) throw new Error('invalid ChangeSet: setMark.mark invalid');
      break;
    case 'setParagraphStyle':
      if (!nonEmpty(op.styleName)) throw new Error('invalid ChangeSet: setParagraphStyle.styleName required');
      break;
    case 'moveObject':
      if (!isRecord(op.box)) throw new Error('invalid ChangeSet: moveObject.box required');
      break;
    case 'setObjectProps':
      if (!isRecord(op.props)) throw new Error('invalid ChangeSet: setObjectProps.props required');
      break;
    case 'rawHost':
      if (!nonEmpty(op.hostId) || op.payload === undefined) throw new Error('invalid ChangeSet: rawHost requires hostId and payload');
      break;
    case 'deleteRange':
    case 'mergeCells':
    case 'unmergeCells':
    case 'autoFilter':
    case 'addObject':
    case 'deleteObject':
      break;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSafeNonNegativeInt(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function isPositiveInt(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function isCellValue(value: unknown): boolean {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}
