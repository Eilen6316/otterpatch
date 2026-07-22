import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from './index.js';
import { assertChangeSet } from './validate.js';
import { RESOURCE_LIMITS, ResourceLimitError } from './limits.js';

function validChangeSet(): ChangeSet {
  const anchorId = 'a1' as AnchorId;
  const anchor: LogicalAnchor = {
    id: anchorId,
    hostId: 'h' as HostId,
    kind: 'grid',
    ref: null,
    baseRev: 0 as DocRev,
    portable: { kind: 'grid', sheet: 'S', a1: 'A1' },
  };
  return {
    id: 'c1',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: { [anchorId]: anchor },
    origin: { by: 'human' },
    meta: { intent: 'test' },
    edits: [{ id: 'e1', target: anchorId, op: { family: 'value', kind: 'setValue', value: 1 } }],
  };
}

test('assertChangeSet accepts a well-formed ChangeSet', () => {
  assert.doesNotThrow(() => assertChangeSet(validChangeSet()));
});

test('assertChangeSet rejects edits whose target anchor is missing', () => {
  const cs = validChangeSet();
  const invalid = { ...cs, edits: [{ ...cs.edits[0], target: 'missing' as AnchorId }] };
  assert.throws(() => assertChangeSet(invalid), /missing anchor/);
});

test('assertChangeSet rejects duplicate edit ids', () => {
  const cs = validChangeSet();
  const invalid = { ...cs, edits: [...cs.edits, { ...cs.edits[0] }] };
  assert.throws(() => assertChangeSet(invalid), /duplicate edit id/);
});

test('assertChangeSet rejects unsupported op kinds', () => {
  const cs = validChangeSet();
  const invalid = { ...cs, edits: [{ ...cs.edits[0], op: { family: 'value', kind: 'unknownOp' } }] };
  assert.throws(() => assertChangeSet(invalid), /unsupported op kind/);
});

test('assertChangeSet rejects mismatched op family and kind', () => {
  const cs = validChangeSet();
  const invalid = { ...cs, edits: [{ ...cs.edits[0], op: { family: 'style', kind: 'setValue', value: 1 } }] };
  assert.throws(() => assertChangeSet(invalid), /must use family value/);
});
test('assertChangeSet rejects malformed anchors before diff/writeback dereference them', () => {
  const cs = validChangeSet();
  const anchor = cs.anchors['a1' as AnchorId];
  const invalid = { ...cs, anchors: { a1: { ...anchor, portable: { kind: 'grid', sheet: 'S' } } } };
  assert.throws(() => assertChangeSet(invalid), /grid anchor requires sheet and a1/);
});

test('assertChangeSet rejects malformed op payloads', () => {
  const cs = validChangeSet();
  const invalid = { ...cs, edits: [{ ...cs.edits[0], op: { family: 'text', kind: 'insertText', text: 'x', at: 'middle' } }] };
  assert.throws(() => assertChangeSet(invalid), /insertText requires text and at/);
});

test('assertChangeSet validates structured Word table payloads', () => {
  const cs = validChangeSet();
  const valid = {
    ...cs,
    edits: [{ ...cs.edits[0], op: { family: 'structure', kind: 'insertTable', rows: [['A', 'B'], ['1', '2']], headerRows: 1, at: 'end' } }],
  };
  assert.doesNotThrow(() => assertChangeSet(valid));

  const ragged = {
    ...cs,
    edits: [{ ...cs.edits[0], op: { family: 'structure', kind: 'insertTable', rows: [['A', 'B'], ['1']], headerRows: 1, at: 'end' } }],
  };
  assert.throws(() => assertChangeSet(ragged), /equal width/);

  const invalidHeader = {
    ...cs,
    edits: [{ ...cs.edits[0], op: { family: 'structure', kind: 'insertTable', rows: [['A']], headerRows: 2, at: 'end' } }],
  };
  assert.throws(() => assertChangeSet(invalidHeader), /headerRows/);

  const invalidPosition = {
    ...cs,
    edits: [{ ...cs.edits[0], op: { family: 'structure', kind: 'insertTable', rows: [['A']], headerRows: 0, at: 'middle' } }],
  };
  assert.throws(() => assertChangeSet(invalidPosition), /insertTable.at/);
});

test('assertChangeSet enforces edit, anchor, string, and nesting budgets', () => {
  const cs = validChangeSet();
  const tooManyEdits = {
    ...cs,
    edits: Array.from({ length: RESOURCE_LIMITS.changeSetEdits + 1 }, (_, index) => ({ ...cs.edits[0], id: `e${index}` })),
  };
  assert.throws(() => assertChangeSet(tooManyEdits), (error) => error instanceof ResourceLimitError && error.resource === 'changeset_edits');

  const tooManyAnchors = {
    ...cs,
    anchors: Object.fromEntries(Array.from({ length: RESOURCE_LIMITS.changeSetAnchors + 1 }, (_, index) => [`a${index}`, {}])),
  };
  assert.throws(() => assertChangeSet(tooManyAnchors), (error) => error instanceof ResourceLimitError && error.resource === 'changeset_anchors');

  const longIntent = { ...cs, meta: { ...cs.meta, intent: 'x'.repeat(RESOURCE_LIMITS.singleStringBytes + 1) } };
  assert.throws(() => assertChangeSet(longIntent), (error) => error instanceof ResourceLimitError && error.resource === 'single_string_bytes');

  let payload: unknown = 'leaf';
  for (let depth = 0; depth < RESOURCE_LIMITS.jsonNestingDepth + 1; depth++) payload = { child: payload };
  const tooDeep = { ...cs, edits: [{ ...cs.edits[0], op: { family: 'object', kind: 'addObject', payload } }] };
  assert.throws(() => assertChangeSet(tooDeep), (error) => error instanceof ResourceLimitError && error.resource === 'changeset_depth');
});

test('assertChangeSet enforces per-range and total touched-cell budgets', () => {
  const cs = validChangeSet();
  const anchorId = cs.edits[0]!.target;
  const anchor = cs.anchors[anchorId]!;
  const hugeRange = { ...cs, anchors: { [anchorId]: { ...anchor, portable: { kind: 'grid', sheet: 'S', a1: 'A1:XFD1048576' } } } };
  assert.throws(() => assertChangeSet(hugeRange), (error) => error instanceof ResourceLimitError && error.resource === 'range_cells');

  const repeatedRange = {
    ...cs,
    anchors: { [anchorId]: { ...anchor, portable: { kind: 'grid', sheet: 'S', a1: 'A1:CV900' } } },
    edits: Array.from({ length: 3 }, (_, index) => ({ ...cs.edits[0], id: `e${index}` })),
  };
  assert.throws(() => assertChangeSet(repeatedRange), (error) => error instanceof ResourceLimitError && error.resource === 'total_touched_cells');
});
