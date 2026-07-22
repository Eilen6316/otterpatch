/**
 * Grid shadow engine: setFormula with real recalculation (cell references + SUM ranges), real before/after DiffView, per-edit inversion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnchorId, CellValue, ChangeSet, DocRev, HostId, LogicalAnchor, PreviewValue } from '@otterpatch/core';
import { GridChangeSetEngine, GridSimulationError, gridShadow } from './grid-engine.js';

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
  assert.equal(cellVal(n0.before), null); // E2 was empty before
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

test('grid shadow expands ranges and applies value/style operations to every cell', async () => {
  const valueAnchor = 'range' as AnchorId;
  const styleAnchor = 'style' as AnchorId;
  const cs: ChangeSet = {
    id: 'range-style', hostId: 'h', baseRev: 0 as DocRev,
    anchors: anchorMap({
      [valueAnchor]: gridAnchor(valueAnchor, 'Sheet1!A1:B2'),
      [styleAnchor]: gridAnchor(styleAnchor, 'Sheet1!A1:B2'),
    }),
    origin: { by: 'human' }, meta: { intent: 'range' },
    edits: [
      { id: 'values', target: valueAnchor, op: { family: 'value', kind: 'setValue', value: 7 } },
      { id: 'styles', target: styleAnchor, op: { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: false, bgColor: '#ffffff' } } },
    ],
  };
  const result = await new GridChangeSetEngine().shadowApply(cs, gridShadow({
    A1: { value: 1, style: { bold: true } }, B1: { value: 2 }, A2: { value: 3 }, B2: { value: 4 },
  }));

  assert.equal(result.diff.root.children.length, 8);
  const valueLeaves = result.diff.root.children.filter((node) => node.editIds[0] === 'values');
  assert.deepEqual(valueLeaves.map((node) => cellVal(node.before)), [1, 2, 3, 4]);
  assert.deepEqual(valueLeaves.map((node) => cellVal(node.after)), [7, 7, 7, 7]);
  assert.deepEqual(valueLeaves[0]!.after, { kind: 'cell', value: 7, style: { bold: true } });
  const styleLeaf = result.diff.root.children.find((node) => node.editIds[0] === 'styles' && node.render.label === 'A1')!;
  assert.deepEqual(styleLeaf.after, { kind: 'cell', value: 7, style: { bold: false, bgColor: '#ffffff' } });
});

test('grid shadow rejects unsupported formulas and cycles instead of returning zero', async () => {
  const unsupported: ChangeSet = {
    id: 'unsupported-formula', hostId: 'h', baseRev: 0 as DocRev,
    anchors: anchorMap({ a0: gridAnchor('a0', 'Sheet1!A1') }),
    origin: { by: 'human' }, meta: { intent: 'formula' },
    edits: [{ id: 'e0', target: 'a0' as AnchorId, op: { family: 'value', kind: 'setFormula', formula: '=XLOOKUP(1,B1:B2,C1:C2)' } }],
  };
  await assert.rejects(
    () => new GridChangeSetEngine().shadowApply(unsupported, gridShadow()),
    (error: unknown) => error instanceof GridSimulationError && error.code === 'VERIFIER_UNSUPPORTED_FORMULA',
  );

  const cycle = { ...unsupported, id: 'cycle', edits: [{ ...unsupported.edits[0]!, op: { family: 'value' as const, kind: 'setFormula' as const, formula: '=A1+1' } }] };
  await assert.rejects(
    () => new GridChangeSetEngine().shadowApply(cycle, gridShadow()),
    (error: unknown) => error instanceof GridSimulationError && error.code === 'VERIFIER_FORMULA_CYCLE',
  );

  const unsupportedStyle: ChangeSet = {
    ...unsupported,
    id: 'unsupported-style',
    edits: [{
      ...unsupported.edits[0]!,
      op: { family: 'style', kind: 'setStyle', scope: 'selection', style: { conditional: { rule: '> 0', format: { bold: true } } } },
    }],
  };
  await assert.rejects(
    () => new GridChangeSetEngine().shadowApply(unsupportedStyle, gridShadow()),
    (error: unknown) => error instanceof GridSimulationError && error.code === 'VERIFIER_UNSUPPORTED_OPERATION',
  );
});

test('grid rebase reads MutationRecord.kind instead of an undeclared structural field', () => {
  const cs: ChangeSet = {
    id: 'rebase', hostId: 'h', baseRev: 0 as DocRev,
    anchors: anchorMap({ a0: gridAnchor('a0', 'Sheet1!A1') }),
    origin: { by: 'human' }, meta: { intent: 'x' },
    edits: [{ id: 'e0', target: 'a0' as AnchorId, op: { family: 'value', kind: 'setValue', value: 1 } }],
  };
  const engine = new GridChangeSetEngine();
  assert.deepEqual(engine.rebase(cs, [{ kind: 'set-range-values', rev: 1 as DocRev }], 1 as DocRev).broken, []);
  assert.deepEqual(engine.rebase(cs, [{ kind: 'insert-rows', rev: 1 as DocRev }], 1 as DocRev).broken, ['e0']);
});
