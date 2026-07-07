import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from './index.js';
import { assertChangeSet } from './validate.js';

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
