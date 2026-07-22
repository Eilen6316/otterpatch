/** Excel simulation checker: applies supported edits to a complete sheet snapshot and fails closed when it cannot prove the result. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AbstractStyle, AnchorId, ChangeSet, DocRev, EditOp, HostId, LogicalAnchor } from '@otterpatch/core';
import { buildGridVerifier, type SheetSnapshot } from './grid-verify.js';

function makeCs(edits: Array<{ a1: string; op: EditOp }>): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const es = edits.map((e, i) => {
    const aid = ('a' + i) as AnchorId;
    anchors[aid] = { id: aid, hostId: 'h' as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid', sheet: 'Sheet1', a1: e.a1 } };
    return { id: 'e' + i, target: aid, op: e.op };
  });
  return { id: 'cs', hostId: 'h', baseRev: 0 as DocRev, anchors, origin: { by: 'agent', sessionId: 't' }, meta: { intent: 't' }, edits: es };
}

const SHEET: SheetSnapshot = {
  a1: 'A1:C3',
  values: [['h1', 'h2', 'h3'], [1, 2, 0], [3, 4, 0]],
  formulas: [[null, null, null], [null, null, null], [null, null, null]],
};

test('grid-verify: 合法公式提案 ok=true,report 含模拟重算结果(供模型核对)', async () => {
  const v = buildGridVerifier(SHEET);
  const r = await v(makeCs([{ a1: 'Sheet1!C2', op: { family: 'value', kind: 'setFormula', formula: '=A2+B2' } }]));
  assert.equal(r.ok, true);
  assert.match(r.report, /C2=3/, '影子把 =A2+B2 重算为 3 回喂模型');
});

test('grid-verify: 越界写入(数据只到第3行却写第40行)ok=false', async () => {
  const v = buildGridVerifier(SHEET);
  const r = await v(makeCs([{ a1: 'Sheet1!C40', op: { family: 'value', kind: 'setValue', value: 9 } }]));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VERIFIER_SNAPSHOT_OUT_OF_BOUNDS');
  assert.match(r.report, /C40/);
});

test('grid-verify: 同一格被多条改动重复命中 ok=false', async () => {
  const v = buildGridVerifier(SHEET);
  const r = await v(makeCs([
    { a1: 'Sheet1!B2', op: { family: 'value', kind: 'setValue', value: 1 } },
    { a1: 'Sheet1!B2', op: { family: 'value', kind: 'setValue', value: 2 } },
  ]));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VERIFIER_OVERLAPPING_EDITS');
});

test('grid-verify: typed percent snapshots retain their decimal value', async () => {
  const snapshot: SheetSnapshot = {
    a1: 'A1:C1',
    values: [[{ kind: 'percent', value: 0.5, display: '50%' }, { kind: 'number', value: 1 }, { kind: 'blank' }]],
    formulas: [[null, null, null]],
  };
  const result = await buildGridVerifier(snapshot)(makeCs([
    { a1: 'Sheet1!C1', op: { family: 'value', kind: 'setFormula', formula: '=A1+B1' } },
  ]));
  assert.equal(result.ok, true);
  assert.match(result.report, /C1=1\.5/);
});

test('grid-verify: value and style edits may safely target the same cell', async () => {
  const snapshot: SheetSnapshot = { ...SHEET, styles: SHEET.values.map((row) => row.map(() => null)) };
  const result = await buildGridVerifier(snapshot)(makeCs([
    { a1: 'Sheet1!B2', op: { family: 'value', kind: 'setValue', value: 8 } },
    { a1: 'Sheet1!B2', op: { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: true } } },
  ]));
  assert.equal(result.ok, true);
  assert.equal((result.details as { affectedCells?: number }).affectedCells, 2);
});

test('grid-verify: range and style operations are actually simulated', async () => {
  const snapshot: SheetSnapshot = {
    ...SHEET,
    styles: [
      [null, null, null],
      [{ bold: true }, null, null],
      [null, null, null],
    ],
  };
  const result = await buildGridVerifier(snapshot)(makeCs([
    { a1: 'Sheet1!A2:B2', op: { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: false } } },
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.level, 'simulation');
  assert.equal((result.details as { affectedCells?: number }).affectedCells, 2);
});

test('grid-verify: unsupported operations, formulas, and cycles fail with stable codes', async () => {
  const unsupportedOperation = await buildGridVerifier(SHEET)(makeCs([
    { a1: 'Sheet1!A2', op: { family: 'structure', kind: 'insertRows', count: 1, before: true } },
  ]));
  assert.equal(unsupportedOperation.ok, false);
  assert.equal(unsupportedOperation.code, 'VERIFIER_UNSUPPORTED_OPERATION');

  const unsupportedFormula = await buildGridVerifier(SHEET)(makeCs([
    { a1: 'Sheet1!C2', op: { family: 'value', kind: 'setFormula', formula: '=SUMIFS(A:A,B:B,1)' } },
  ]));
  assert.equal(unsupportedFormula.ok, false);
  assert.equal(unsupportedFormula.code, 'VERIFIER_UNSUPPORTED_FORMULA');

  const cycle = await buildGridVerifier(SHEET)(makeCs([
    { a1: 'Sheet1!C2', op: { family: 'value', kind: 'setFormula', formula: '=C2+1' } },
  ]));
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, 'VERIFIER_FORMULA_CYCLE');
});

test('grid-verify: missing formula/style observations fail as an insufficient snapshot', async () => {
  const noFormulas = await buildGridVerifier({ a1: SHEET.a1, values: SHEET.values })(makeCs([
    { a1: 'Sheet1!A2', op: { family: 'value', kind: 'setValue', value: 8 } },
  ]));
  assert.equal(noFormulas.ok, false);
  assert.equal(noFormulas.code, 'VERIFIER_INSUFFICIENT_SNAPSHOT');

  const noStyles = await buildGridVerifier(SHEET)(makeCs([
    { a1: 'Sheet1!A2', op: { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: false } } },
  ]));
  assert.equal(noStyles.ok, false);
  assert.equal(noStyles.code, 'VERIFIER_INSUFFICIENT_SNAPSHOT');

  const outsideDependency = await buildGridVerifier(SHEET)(makeCs([
    { a1: 'Sheet1!C2', op: { family: 'value', kind: 'setFormula', formula: '=D2+1' } },
  ]));
  assert.equal(outsideDependency.ok, false);
  assert.equal(outsideDependency.code, 'VERIFIER_INSUFFICIENT_SNAPSHOT');
  assert.match(outsideDependency.report, /D2/);

  const sparseFormulaRow = [[null, null, null], [null, null, null], [null, null, null]];
  delete sparseFormulaRow[1]![1];
  const sparseFormula = await buildGridVerifier({ ...SHEET, formulas: sparseFormulaRow })(makeCs([
    { a1: 'Sheet1!A2', op: { family: 'value', kind: 'setValue', value: 8 } },
  ]));
  assert.equal(sparseFormula.ok, false);
  assert.equal(sparseFormula.code, 'VERIFIER_INSUFFICIENT_SNAPSHOT');

  const sparseStyleRow: Array<AbstractStyle | null> = [null, null, null];
  delete sparseStyleRow[1];
  const sparseStyle = await buildGridVerifier({ ...SHEET, styles: [sparseStyleRow, sparseStyleRow, sparseStyleRow] })(makeCs([
    { a1: 'Sheet1!B2', op: { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: true } } },
  ]));
  assert.equal(sparseStyle.ok, false);
  assert.equal(sparseStyle.code, 'VERIFIER_INSUFFICIENT_SNAPSHOT');
});

test('grid-verify: aggregate functions ignore observed blanks and text with Excel-compatible semantics', async () => {
  const snapshot: SheetSnapshot = {
    a1: 'A1:C3',
    values: [[1, null, null], [null, 'text', null], [3, true, null]],
    formulas: [[null, null, null], [null, null, null], [null, null, null]],
  };
  const result = await buildGridVerifier(snapshot)(makeCs([
    { a1: 'Sheet1!C1', op: { family: 'value', kind: 'setFormula', formula: '=AVERAGE(A1:B3)' } },
    { a1: 'Sheet1!C2', op: { family: 'value', kind: 'setFormula', formula: '=COUNT(A1:B3)' } },
  ]));
  assert.equal(result.ok, true);
  assert.match(result.report, /C1=2/);
  assert.match(result.report, /C2=2/);
});
