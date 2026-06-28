/**
 * 网格影子引擎:setFormula 真实重算(单元格引用 + SUM 范围)、真实 before/after DiffView、逐 edit 反演。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnchorId, CellValue, ChangeSet, DocRev, HostId, LogicalAnchor, PreviewValue } from '@opal/core';
import { GridChangeSetEngine, gridShadow } from './grid-engine.js';

function gridAnchor(id: string, a1: string): LogicalAnchor {
  return { id: id as AnchorId, hostId: 'h' as unknown as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid', sheet: 'Sheet1', a1 } };
}
const anchorMap = (m: Record<string, LogicalAnchor>): Record<AnchorId, LogicalAnchor> => m as Record<AnchorId, LogicalAnchor>;
const cellVal = (pv: PreviewValue): CellValue => (pv.kind === 'cell' ? pv.value : null);

test('grid 影子:setFormula 重算(=C2*D2 与 =SUM(C2:C4))+ before/after + 反演', async () => {
  const shadow = gridShadow({ C2: { value: 120 }, D2: { value: 38 }, C4: { value: 64 } });
  const cs: ChangeSet = {
    id: 'cs',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: anchorMap({ a0: gridAnchor('a0', 'Sheet1!E2'), a1: gridAnchor('a1', 'Sheet1!E4') }),
    origin: { by: 'human' },
    meta: { intent: '补公式' },
    edits: [
      { id: 'e0', target: 'a0' as AnchorId, op: { family: 'value', kind: 'setFormula', formula: '=C2*D2' } },
      { id: 'e1', target: 'a1' as AnchorId, op: { family: 'value', kind: 'setFormula', formula: '=SUM(C2:C4)' } },
    ],
  };

  const eng = new GridChangeSetEngine();
  const res = await eng.shadowApply(cs, shadow);

  const n0 = res.diff.root.children[0]!;
  const n1 = res.diff.root.children[1]!;
  assert.equal(cellVal(n0.before), null); // E2 之前空
  assert.equal(cellVal(n0.after), 4560); // 120 * 38
  assert.equal(cellVal(n1.after), 184); // 120 + 0(C3) + 64

  assert.ok((res.effects.recalculated ?? []).some((row) => row[0] === 'E2' && row[1] === 4560));

  const inv = eng.invert(cs, res);
  assert.equal(inv.edits.length, 2);
  assert.equal(inv.edits[0]!.op.kind, 'setValue');
});

test('grid 影子:setValue 改值后,依赖它的公式重算跟随', async () => {
  const shadow = gridShadow({ A1: { value: 10 }, B1: { formula: '=A1*2' } });
  const cs: ChangeSet = {
    id: 'cs2',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: anchorMap({ a0: gridAnchor('a0', 'Sheet1!A1') }),
    origin: { by: 'human' },
    meta: { intent: '改 A1' },
    edits: [{ id: 'e0', target: 'a0' as AnchorId, op: { family: 'value', kind: 'setValue', value: 50 } }],
  };
  const res = await new GridChangeSetEngine().shadowApply(cs, shadow);
  assert.ok((res.effects.recalculated ?? []).some((row) => row[0] === 'B1' && row[1] === 100));
});
