import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnchorId, ChangeSet, DocRev, EditOp, HostId, LogicalAnchor } from './index.js';
import { riskOf, assessChangeSet, decideApproval, STRICT_POLICY } from './risk.js';

function cs(ops: EditOp[]): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits = ops.map((op, i) => {
    const aid = ('a' + i) as AnchorId;
    anchors[aid] = {
      id: aid,
      hostId: 'h' as HostId,
      kind: 'grid',
      ref: null,
      baseRev: 0 as DocRev,
      portable: { kind: 'grid', sheet: 'S', a1: 'A1' },
    };
    return { id: 'e' + i, target: aid, op };
  });
  return { id: 'c', hostId: 'h', baseRev: 0 as DocRev, anchors, origin: { by: 'human' }, meta: { intent: '' }, edits };
}

test('riskOf: 按 kind 分级', () => {
  assert.equal(riskOf({ family: 'value', kind: 'setValue', value: 1 }), 'safe');
  assert.equal(riskOf({ family: 'object', kind: 'addObject', payload: {} }), 'caution');
  assert.equal(riskOf({ family: 'structure', kind: 'deleteRows' }), 'destructive');
  assert.equal(riskOf({ family: 'object', kind: 'deleteObject' }), 'destructive');
  assert.equal(riskOf({ family: 'raw', kind: 'rawHost', hostId: 'h', payload: {} }), 'destructive');
});

test('assessChangeSet: 取最高风险 + 计数 + 列出破坏性', () => {
  const r = assessChangeSet(
    cs([
      { family: 'value', kind: 'setValue', value: 1 },
      { family: 'structure', kind: 'deleteRows' },
      { family: 'object', kind: 'addObject', payload: {} },
    ]),
  );
  assert.equal(r.level, 'destructive');
  assert.deepEqual(r.counts, { safe: 1, caution: 1, destructive: 1 });
  assert.deepEqual(r.destructive, ['e1']);
});

test('decideApproval: 默认破坏性需人工,安全/谨慎自动', () => {
  const d = decideApproval(
    cs([
      { family: 'value', kind: 'setValue', value: 1 },
      { family: 'object', kind: 'addObject', payload: {} },
      { family: 'structure', kind: 'deleteRows' },
    ]),
  );
  assert.equal(d.level, 'destructive');
  assert.deepEqual(d.auto, ['e0', 'e1']);
  assert.deepEqual(d.needsApproval, ['e2']);
});

test('STRICT_POLICY: 谨慎也需人工', () => {
  const d = decideApproval(
    cs([
      { family: 'value', kind: 'setValue', value: 1 },
      { family: 'object', kind: 'addObject', payload: {} },
    ]),
    STRICT_POLICY,
  );
  assert.deepEqual(d.auto, ['e0']);
  assert.deepEqual(d.needsApproval, ['e1']);
});
