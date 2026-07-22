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
  assert.equal(riskOf({ family: 'structure', kind: 'insertTable', rows: [['A']], headerRows: 1, at: 'end' }), 'caution');
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

test('riskOf uses scope, occupancy, dependencies, and before-state context', () => {
  const style = { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: true } } as const;
  assert.equal(riskOf(style, { resolvedScope: 'cell', affectedObjectCount: 1 }), 'safe');
  assert.equal(riskOf(style, { format: 'word', documentWide: true }), 'caution');
  assert.equal(riskOf({ ...style, scope: 'document' }), 'caution');

  const formula = { family: 'value', kind: 'setFormula', formula: '=A1*2' } as const;
  assert.equal(riskOf(formula, { destinationOccupied: false, affectedObjectCount: 1 }), 'safe');
  assert.equal(riskOf(formula, { destinationOccupied: true, beforeState: { formula: '=SUM(A1:A9)' }, formulaDependencies: ['B10'] }), 'destructive');

  const copy = { family: 'structure', kind: 'copyRange', to: 'B1' } as const;
  assert.equal(riskOf(copy, { destinationOccupied: false }), 'caution');
  assert.equal(riskOf(copy, { destinationOccupied: true }), 'destructive');

  const move = { family: 'object', kind: 'moveObject', box: { left: 12, top: 11 } } as const;
  const beforeState = { box: { left: 10, top: 10, width: 20, height: 20 } };
  assert.equal(riskOf(move, { beforeState, canvasBounds: { left: 0, top: 0, width: 100, height: 100 } }), 'safe');
  assert.equal(riskOf({ ...move, box: { left: 95 } }, { beforeState, canvasBounds: { left: 0, top: 0, width: 100, height: 100 } }), 'caution');

  assert.equal(riskOf({ family: 'object', kind: 'setObjectProps', props: { style: 'fillColor=#fff;' } }), 'safe');
  assert.equal(riskOf({ family: 'object', kind: 'setObjectProps', props: { id: 'replacement' } }), 'destructive');
  assert.equal(riskOf({ family: 'value', kind: 'setValue', value: 1 }, { protectedRegion: true }), 'destructive');
});

test('assessChangeSet derives affected range size and supports per-edit trusted observations', () => {
  const large = cs([{ family: 'value', kind: 'setValue', value: 1 }]);
  const anchorId = large.edits[0]!.target;
  large.anchors[anchorId] = {
    ...large.anchors[anchorId]!,
    portable: { kind: 'grid', sheet: 'S', a1: 'A1:A1001' },
  };
  const largeRisk = assessChangeSet(large, { format: 'excel' });
  assert.equal(largeRisk.level, 'destructive');
  assert.match(largeRisk.byEdit[0]!.reasons.join('\n'), /more than 1000/);

  const formulas = cs([
    { family: 'value', kind: 'setFormula', formula: '=A1' },
    { family: 'value', kind: 'setFormula', formula: '=A2' },
  ]);
  const contextual = decideApproval(formulas, STRICT_POLICY, {
    byEdit: {
      e0: { destinationOccupied: false },
      e1: { destinationOccupied: true, beforeState: { formula: '=SUM(A:A)' }, formulaDependencies: 2 },
    },
  });
  assert.deepEqual(contextual.auto, ['e0']);
  assert.deepEqual(contextual.needsApproval, ['e1']);
  assert.equal(contextual.level, 'destructive');
});
