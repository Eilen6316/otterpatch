import type { ChangeSet } from './changeset.js';
import { RESOURCE_LIMITS, ResourceLimitError, assertA1RangeBudget, assertJsonBudget } from './limits.js';

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
const STYLE_KEYS = new Set(['bold', 'italic', 'underline', 'color', 'bgColor', 'font', 'size', 'align', 'numberFormat', 'lineSpacing', 'block', 'columns', 'margin', 'orient', 'conditional']);
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);
const BLOCK_STYLES = new Set(['h1', 'h2', 'h3', 'p', 'blockquote']);
const MARGINS = new Set(['narrow', 'normal', 'moderate', 'wide']);
const ORIENTATIONS = new Set(['portrait', 'landscape']);
const CONDITIONAL_WHEN = new Set(['notEmpty', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'between', 'equalTo', 'textContains', 'formula']);
const OP_KEYS: Record<string, ReadonlySet<string>> = Object.fromEntries(Object.entries({
  setValue: ['value'],
  replaceText: ['text'],
  insertText: ['text', 'at'],
  deleteRange: [],
  setStyle: ['style'],
  setFormula: ['formula'],
  setNumberFormat: ['pattern'],
  insertRows: ['count', 'before'],
  deleteRows: ['count'],
  sortRange: ['by', 'asc'],
  insertCols: ['count', 'before'],
  deleteCols: ['count'],
  mergeCells: [],
  unmergeCells: [],
  freezePanes: ['rows', 'cols'],
  autoFilter: [],
  addSheet: ['name'],
  copyRange: ['to'],
  insertChart: ['chartType', 'title', 'range', 'categories', 'series', 'anchor'],
  conditionalFormat: ['when', 'v1', 'v2', 'style'],
  dataValidation: ['rule', 'list', 'min', 'max', 'v'],
  insertTable: ['rows', 'headerRows', 'at'],
  setMark: ['mark'],
  setParagraphStyle: ['styleName'],
  moveObject: ['box'],
  setObjectProps: ['props'],
  addObject: ['payload'],
  deleteObject: [],
  rawHost: ['hostId', 'payload'],
}).map(([kind, keys]) => [kind, new Set(['family', 'kind', ...keys])]));

export const MAX_FORMULA_CHARS = 8_192;

export function assertChangeSet(value: unknown): asserts value is ChangeSet {
  assertJsonBudget(value, 'changeset');
  if (!isRecord(value)) throw new Error('invalid ChangeSet: expected object');
  const cs = value as Partial<ChangeSet>;
  if (!nonEmpty(cs.id)) throw new Error('invalid ChangeSet: id required');
  if (!nonEmpty(cs.hostId)) throw new Error('invalid ChangeSet: hostId required');
  if (!isSafeNonNegativeInt(cs.baseRev)) throw new Error('invalid ChangeSet: baseRev must be a non-negative integer');
  assertMeta(cs.meta);
  assertOrigin(cs.origin);
  if (!isRecord(cs.anchors)) throw new Error('invalid ChangeSet: anchors object required');
  const anchorEntries = Object.entries(cs.anchors);
  if (anchorEntries.length > RESOURCE_LIMITS.changeSetAnchors) {
    throw new ResourceLimitError('changeset_anchors', RESOURCE_LIMITS.changeSetAnchors, anchorEntries.length);
  }
  for (const [id, anchor] of anchorEntries) assertAnchor(id, anchor, cs.hostId, cs.baseRev);
  if (!Array.isArray(cs.edits)) throw new Error('invalid ChangeSet: edits array required');
  if (cs.edits.length > RESOURCE_LIMITS.changeSetEdits) {
    throw new ResourceLimitError('changeset_edits', RESOURCE_LIMITS.changeSetEdits, cs.edits.length);
  }

  const seen = new Set<string>();
  let totalTouchedCells = 0;
  for (const edit of cs.edits as unknown[]) {
    if (!isRecord(edit)) throw new Error('invalid ChangeSet: edit must be object');
    if (!nonEmpty(edit.id)) throw new Error('invalid ChangeSet: edit id required');
    if (seen.has(edit.id)) throw new Error('invalid ChangeSet: duplicate edit id ' + edit.id);
    seen.add(edit.id);
    if (!nonEmpty(edit.target)) throw new Error('invalid ChangeSet: edit target required');
    if (!(edit.target in cs.anchors)) throw new Error('invalid ChangeSet: missing anchor for edit ' + edit.id);
    const op = edit.op;
    if (!isRecord(op)) throw new Error('invalid ChangeSet: edit op required');
    assertOp(op, cs.hostId);
    const anchor = (cs.anchors as unknown as Record<string, unknown>)[edit.target];
    if (isRecord(anchor) && isRecord(anchor.portable) && anchor.portable.kind === 'grid') {
      const cells = assertA1RangeBudget(String(anchor.portable.a1));
      totalTouchedCells += cells;
      if (totalTouchedCells > RESOURCE_LIMITS.totalTouchedCells) {
        throw new ResourceLimitError('total_touched_cells', RESOURCE_LIMITS.totalTouchedCells, totalTouchedCells);
      }
    }
    if (edit.inverse !== undefined) {
      if (!isRecord(edit.inverse)) throw new Error('invalid ChangeSet: inverse op must be object');
      assertOp(edit.inverse, cs.hostId);
    }
    if (op.kind === 'rawHost' && edit.inverse === undefined) throw new Error('invalid ChangeSet: rawHost requires an inverse op');
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
      assertA1RangeBudget(p.a1);
      if (p.a1.includes('!') && normalizeSheetName(p.a1.slice(0, p.a1.lastIndexOf('!'))) !== p.sheet) {
        throw new Error('invalid ChangeSet: grid anchor sheet/a1 mismatch ' + anchorId);
      }
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
      for (const [index, part] of p.parts.entries()) {
        if (!ANCHOR_KINDS.has(String(part.kind))) throw new Error(`invalid ChangeSet: composite anchor part ${index} kind invalid ${anchorId}`);
        assertPortable(part, String(part.kind), `${anchorId}.parts[${index}]`);
      }
      break;
    default:
      throw new Error('invalid ChangeSet: unsupported portable kind ' + String(p.kind));
  }
}

function assertOp(op: Record<string, unknown>, changeSetHostId: unknown): void {
  if (typeof op.family !== 'string' || typeof op.kind !== 'string') throw new Error('invalid ChangeSet: op family/kind required');
  const expectedFamily = OP_FAMILIES[op.kind];
  if (!expectedFamily) throw new Error('invalid ChangeSet: unsupported op kind ' + op.kind);
  if (op.family !== expectedFamily) throw new Error(`invalid ChangeSet: op ${op.kind} must use family ${expectedFamily}`);
  assertOnlyKeys(op, OP_KEYS[op.kind]!, `op ${op.kind}`);

  switch (op.kind) {
    case 'setValue':
      if (typeof op.value === 'number' && !Number.isFinite(op.value)) throw new Error('invalid ChangeSet: setValue.value contains a non-finite number');
      if (!isCellValue(op.value)) throw new Error('invalid ChangeSet: setValue.value invalid');
      break;
    case 'replaceText':
      if (typeof op.text !== 'string') throw new Error('invalid ChangeSet: replaceText.text required');
      break;
    case 'insertText':
      if (typeof op.text !== 'string' || !INSERT_AT.has(String(op.at))) throw new Error('invalid ChangeSet: insertText requires text and at');
      break;
    case 'setStyle':
      assertStyle(op.style, 'setStyle.style');
      break;
    case 'setFormula':
      if (!nonBlank(op.formula) || op.formula.length > MAX_FORMULA_CHARS) throw new Error(`invalid ChangeSet: setFormula.formula must contain 1-${MAX_FORMULA_CHARS} characters`);
      break;
    case 'setNumberFormat':
      if (!nonBlank(op.pattern)) throw new Error('invalid ChangeSet: setNumberFormat.pattern required');
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
      if (!nonBlank(op.name) || op.name.length > 31 || /[\\/?*\[\]:]/.test(op.name)) throw new Error('invalid ChangeSet: addSheet.name invalid');
      break;
    case 'copyRange':
      if (!nonBlank(op.to)) throw new Error('invalid ChangeSet: copyRange.to required');
      assertA1RangeBudget(op.to);
      break;
    case 'insertChart':
      assertChart(op);
      break;
    case 'conditionalFormat':
      assertConditionalFormat(op);
      break;
    case 'dataValidation':
      assertDataValidation(op);
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
      assertMark(op.mark);
      break;
    case 'setParagraphStyle':
      if (!nonEmpty(op.styleName)) throw new Error('invalid ChangeSet: setParagraphStyle.styleName required');
      break;
    case 'moveObject':
      assertBox(op.box);
      break;
    case 'setObjectProps':
      assertObjectProps(op.props);
      break;
    case 'rawHost':
      if (!nonBlank(op.hostId) || op.hostId !== changeSetHostId || op.payload === undefined) throw new Error('invalid ChangeSet: rawHost.hostId must match ChangeSet.hostId and payload is required');
      assertJsonValue(op.payload, 'rawHost.payload');
      break;
    case 'deleteRange':
    case 'mergeCells':
    case 'unmergeCells':
    case 'autoFilter':
    case 'deleteObject':
      break;
    case 'addObject':
      assertAddObjectPayload(op.payload);
      break;
  }
}

function assertStyle(value: unknown, label: string, allowConditional = true): void {
  if (!isPlainRecord(value)) throw new Error(`invalid ChangeSet: ${label} must be an object`);
  assertOnlyKeys(value, STYLE_KEYS, label);
  if (!Object.keys(value).length) throw new Error(`invalid ChangeSet: ${label} requires at least one property`);
  for (const key of ['bold', 'italic', 'underline'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`invalid ChangeSet: ${label}.${key} must be boolean`);
  }
  for (const key of ['color', 'bgColor'] as const) {
    if (value[key] !== undefined && !isColor(value[key])) throw new Error(`invalid ChangeSet: ${label}.${key} must be a hex color`);
  }
  if (value.font !== undefined && !nonBlank(value.font)) throw new Error(`invalid ChangeSet: ${label}.font must be non-empty`);
  if (value.size !== undefined && (!isFiniteNumber(value.size) || value.size <= 0 || value.size > 1_000)) throw new Error(`invalid ChangeSet: ${label}.size invalid`);
  if (value.align !== undefined && !ALIGNMENTS.has(String(value.align))) throw new Error(`invalid ChangeSet: ${label}.align invalid`);
  if (value.numberFormat !== undefined && !nonBlank(value.numberFormat)) throw new Error(`invalid ChangeSet: ${label}.numberFormat must be non-empty`);
  if (value.lineSpacing !== undefined && (!isFiniteNumber(value.lineSpacing) || value.lineSpacing <= 0 || value.lineSpacing > 10)) throw new Error(`invalid ChangeSet: ${label}.lineSpacing invalid`);
  if (value.block !== undefined && !BLOCK_STYLES.has(String(value.block))) throw new Error(`invalid ChangeSet: ${label}.block invalid`);
  if (value.columns !== undefined && (!Number.isSafeInteger(value.columns) || Number(value.columns) < 1 || Number(value.columns) > 3)) throw new Error(`invalid ChangeSet: ${label}.columns invalid`);
  if (value.margin !== undefined && !MARGINS.has(String(value.margin))) throw new Error(`invalid ChangeSet: ${label}.margin invalid`);
  if (value.orient !== undefined && !ORIENTATIONS.has(String(value.orient))) throw new Error(`invalid ChangeSet: ${label}.orient invalid`);
  if (value.conditional !== undefined) {
    if (!allowConditional || !isPlainRecord(value.conditional)) throw new Error(`invalid ChangeSet: ${label}.conditional invalid`);
    assertOnlyKeys(value.conditional, new Set(['rule', 'format']), `${label}.conditional`);
    if (!nonBlank(value.conditional.rule)) throw new Error(`invalid ChangeSet: ${label}.conditional.rule required`);
    assertStyle(value.conditional.format, `${label}.conditional.format`, false);
  }
}

function assertChart(op: Record<string, unknown>): void {
  if (!CHART_TYPES.has(String(op.chartType)) || !nonBlank(op.title)) throw new Error('invalid ChangeSet: insertChart chartType/title invalid');
  if (op.range !== undefined) {
    if (!nonBlank(op.range)) throw new Error('invalid ChangeSet: insertChart.range invalid');
    assertA1RangeBudget(op.range);
  }
  if (op.anchor !== undefined) {
    if (!nonBlank(op.anchor)) throw new Error('invalid ChangeSet: insertChart.anchor invalid');
    assertA1RangeBudget(op.anchor);
  }
  const hasCategories = op.categories !== undefined;
  const hasSeries = op.series !== undefined;
  if (hasCategories !== hasSeries) throw new Error('invalid ChangeSet: insertChart inline categories and series must be provided together');
  if (!hasCategories) return;
  if (!Array.isArray(op.categories) || !op.categories.length || !op.categories.every((item) => typeof item === 'string')) {
    throw new Error('invalid ChangeSet: insertChart.categories invalid');
  }
  if (!Array.isArray(op.series) || !op.series.length) throw new Error('invalid ChangeSet: insertChart.series invalid');
  for (const series of op.series) {
    if (!isPlainRecord(series)) throw new Error('invalid ChangeSet: insertChart.series item invalid');
    assertOnlyKeys(series, new Set(['name', 'data']), 'insertChart.series item');
    if (!nonBlank(series.name) || !Array.isArray(series.data) || !series.data.length || !series.data.every(isFiniteNumber)) {
      throw new Error('invalid ChangeSet: insertChart.series name/data invalid');
    }
    if (series.data.length !== op.categories.length) throw new Error('invalid ChangeSet: insertChart series/category length mismatch');
  }
}

function assertConditionalFormat(op: Record<string, unknown>): void {
  if (!CONDITIONAL_WHEN.has(String(op.when))) throw new Error('invalid ChangeSet: conditionalFormat.when invalid');
  assertStyle(op.style, 'conditionalFormat.style');
  if (op.when === 'notEmpty') {
    if (op.v1 !== undefined || op.v2 !== undefined) throw new Error('invalid ChangeSet: conditionalFormat.notEmpty takes no values');
  } else if (op.when === 'between') {
    if (!isFiniteNumber(op.v1) || !isFiniteNumber(op.v2) || op.v1 > op.v2) throw new Error('invalid ChangeSet: conditionalFormat.between requires ordered numeric v1/v2');
  } else if (op.when === 'textContains' || op.when === 'formula') {
    if (!nonBlank(op.v1) || op.v2 !== undefined) throw new Error(`invalid ChangeSet: conditionalFormat.${op.when} requires string v1`);
  } else if (!isFiniteNumber(op.v1) || op.v2 !== undefined) {
    throw new Error(`invalid ChangeSet: conditionalFormat.${String(op.when)} requires numeric v1`);
  }
}

function assertDataValidation(op: Record<string, unknown>): void {
  if (!VALIDATION_RULES.has(String(op.rule))) throw new Error('invalid ChangeSet: dataValidation.rule invalid');
  if (op.rule === 'list') {
    if (!Array.isArray(op.list) || !op.list.length || !op.list.every((item) => nonBlank(item)) || op.min !== undefined || op.max !== undefined || op.v !== undefined) {
      throw new Error('invalid ChangeSet: dataValidation.list requires a non-empty string list only');
    }
  } else if (op.rule === 'numberBetween' || op.rule === 'dateBetween') {
    if (!isFiniteNumber(op.min) || !isFiniteNumber(op.max) || op.min > op.max || op.list !== undefined || op.v !== undefined) {
      throw new Error(`invalid ChangeSet: dataValidation.${op.rule} requires ordered min/max only`);
    }
  } else if (op.rule === 'numberGreaterThan') {
    if (!isFiniteNumber(op.v) || op.list !== undefined || op.min !== undefined || op.max !== undefined) throw new Error('invalid ChangeSet: dataValidation.numberGreaterThan requires numeric v only');
  } else if (op.list !== undefined || op.min !== undefined || op.max !== undefined || op.v !== undefined) {
    throw new Error('invalid ChangeSet: dataValidation.checkbox takes no values');
  }
}

function assertMark(value: unknown): void {
  if (!isPlainRecord(value) || !MARK_TYPES.has(String(value.type))) throw new Error('invalid ChangeSet: setMark.mark invalid');
  assertOnlyKeys(value, new Set(['type', 'value']), 'setMark.mark');
  if ((value.type === 'bold' || value.type === 'italic') && value.value !== undefined && typeof value.value !== 'boolean') throw new Error('invalid ChangeSet: setMark boolean value invalid');
  if (value.type === 'comment' && !nonBlank(value.value)) throw new Error('invalid ChangeSet: setMark comment value required');
  if (value.type === 'highlight' && !isColor(value.value)) throw new Error('invalid ChangeSet: setMark highlight color invalid');
}

function assertBox(value: unknown): void {
  if (!isPlainRecord(value)) throw new Error('invalid ChangeSet: moveObject.box required');
  const allowed = new Set(['left', 'top', 'width', 'height', 'rotate']);
  assertOnlyKeys(value, allowed, 'moveObject.box');
  if (!Object.keys(value).length) throw new Error('invalid ChangeSet: moveObject.box requires at least one coordinate');
  for (const [key, item] of Object.entries(value)) {
    if (!isFiniteNumber(item)) throw new Error(`invalid ChangeSet: moveObject.box.${key} must be finite`);
    if ((key === 'width' || key === 'height') && item <= 0) throw new Error(`invalid ChangeSet: moveObject.box.${key} must be positive`);
  }
}

function assertObjectProps(value: unknown): void {
  if (!isPlainRecord(value) || !Object.keys(value).length) throw new Error('invalid ChangeSet: setObjectProps.props must be a non-empty object');
  if ('imgAction' in value) {
    assertOnlyKeys(value, new Set(['imgAction', 'width']), 'setObjectProps.props');
    if (value.imgAction !== 'remove' && value.imgAction !== 'resize') throw new Error('invalid ChangeSet: setObjectProps.props.imgAction invalid');
    if (value.imgAction === 'resize') {
      if (!isFiniteNumber(value.width) || value.width <= 0) throw new Error('invalid ChangeSet: image resize requires a positive width');
    } else if (value.width !== undefined) {
      throw new Error('invalid ChangeSet: image remove does not accept width');
    }
    return;
  }
  assertOnlyKeys(value, new Set(['value', 'style']), 'setObjectProps.props');
  if (value.value === undefined && value.style === undefined) throw new Error('invalid ChangeSet: drawio properties require value or style');
  if (value.value !== undefined && typeof value.value !== 'string') throw new Error('invalid ChangeSet: drawio value property must be string');
  if (value.style !== undefined && typeof value.style !== 'string') throw new Error('invalid ChangeSet: drawio style property must be string');
}

function assertAddObjectPayload(value: unknown): void {
  if (!isPlainRecord(value)) throw new Error('invalid ChangeSet: addObject.payload must be an object');
  assertOnlyKeys(value, new Set(['id', 'value', 'style', 'vertex', 'edge', 'parent', 'source', 'target', 'geometry']), 'addObject.payload');
  if (!nonBlank(value.id)) throw new Error('invalid ChangeSet: addObject.payload.id required');
  if (value.value !== undefined && typeof value.value !== 'string') throw new Error('invalid ChangeSet: addObject.payload.value must be string');
  if (value.style !== undefined && typeof value.style !== 'string') throw new Error('invalid ChangeSet: addObject.payload.style must be string');
  if (value.vertex !== undefined && typeof value.vertex !== 'boolean') throw new Error('invalid ChangeSet: addObject.payload.vertex must be boolean');
  if (value.edge !== undefined && typeof value.edge !== 'boolean') throw new Error('invalid ChangeSet: addObject.payload.edge must be boolean');
  if ((value.vertex === true) === (value.edge === true)) throw new Error('invalid ChangeSet: addObject payload must be exactly one of vertex or edge');
  if (!nonBlank(value.parent)) throw new Error('invalid ChangeSet: addObject.payload.parent required');
  for (const key of ['source', 'target'] as const) {
    if (value[key] !== undefined && !nonBlank(value[key])) throw new Error(`invalid ChangeSet: addObject.payload.${key} invalid`);
  }
  if (value.edge === true && (!nonBlank(value.source) || !nonBlank(value.target))) throw new Error('invalid ChangeSet: addObject edge requires source and target');
  if (value.geometry !== undefined) {
    if (!isPlainRecord(value.geometry)) throw new Error('invalid ChangeSet: addObject.payload.geometry must be an object');
    assertOnlyKeys(value.geometry, new Set(['x', 'y', 'width', 'height']), 'addObject.payload.geometry');
    if (!Object.keys(value.geometry).length) throw new Error('invalid ChangeSet: addObject.payload.geometry must not be empty');
    for (const [key, item] of Object.entries(value.geometry)) {
      if (!isFiniteNumber(item)) throw new Error(`invalid ChangeSet: addObject.payload.geometry.${key} must be finite`);
      if ((key === 'width' || key === 'height') && item <= 0) throw new Error(`invalid ChangeSet: addObject.payload.geometry.${key} must be positive`);
    }
  }
}

function assertJsonValue(value: unknown, label: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`invalid ChangeSet: ${label} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`));
    return;
  }
  if (!isPlainRecord(value)) throw new Error(`invalid ChangeSet: ${label} must contain JSON values only`);
  for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${label}.${key}`);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`invalid ChangeSet: ${label} contains unsupported fields: ${unknown.join(', ')}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isSafeNonNegativeInt(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function isPositiveInt(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#?(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim());
}
function normalizeSheetName(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("'") && trimmed.endsWith("'")
    ? trimmed.slice(1, -1).replace(/''/g, "'")
    : trimmed;
}
function isCellValue(value: unknown): boolean {
  return value == null || typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value);
}
