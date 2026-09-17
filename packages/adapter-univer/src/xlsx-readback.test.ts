/**
 * Post-write-back semantic read-back for Excel: re-open the written workbook and verify
 * every applied edit's intended effect against the bytes on disk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from '@otterpatch/core';
import { XlsxSurgicalWriteback } from './xlsx-writeback.js';
import { expandA1, readXlsxReadback, verifyXlsxReadback } from './xlsx-readback.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeXlsx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'xl/workbook.xml': enc(
      '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': enc(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/styles.xml': enc('<?xml version="1.0"?><styleSheet/>'),
    'xl/worksheets/sheet1.xml': enc(
      '<?xml version="1.0"?><worksheet><sheetData><row r="1">' +
        '<c r="A1"><v>10</v></c><c r="B1" s="2"><v>20</v></c>' +
        '</row></sheetData></worksheet>',
    ),
    'xl/media/image1.png': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  });
}

function gridAnchor(id: string, a1: string, sheet = 'Sheet1'): LogicalAnchor {
  return {
    id: id as AnchorId,
    hostId: 'h1' as HostId,
    kind: 'grid',
    ref: null,
    baseRev: 0 as DocRev,
    portable: { kind: 'grid', sheet, a1 },
  };
}

function changeSet(anchors: Record<string, LogicalAnchor>, edits: ChangeSet['edits']): ChangeSet {
  return {
    id: 'cs-readback',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: anchors as ChangeSet['anchors'],
    origin: { by: 'human' },
    meta: { intent: 'xlsx readback test' },
    edits,
  };
}

async function commitAndVerify(cs: ChangeSet, original = makeXlsx()): Promise<{ res: Awaited<ReturnType<XlsxSurgicalWriteback['commit']>>; verify: Awaited<ReturnType<XlsxSurgicalWriteback['verify']>> }> {
  const wb = new XlsxSurgicalWriteback();
  const res = await wb.commit(cs, { hostId: 'h1', bytes: original, rev: 0 as DocRev });
  const verify = await wb.verify({ hostId: 'h1', bytes: original, rev: 0 as DocRev }, { hostId: 'h1', bytes: res.bytes, rev: 1 as DocRev }, cs);
  return { res, verify };
}

// ── readXlsxReadback / expandA1 ──────────────────────────────────────────────

test('readXlsxReadback: parses numbers, inline strings, booleans, formulas, empty cells, style indices', () => {
  const original = makeXlsx();
  // setValue writes inlineStr; setFormula writes <f>; deleteRange empties cells.
  const cs = changeSet(
    { a: gridAnchor('a', 'Sheet1!A1'), b: gridAnchor('b', 'Sheet1!B1') },
    [
      { id: 'e0', target: 'a' as AnchorId, op: { family: 'value', kind: 'setValue', value: '文本' } },
      { id: 'e1', target: 'b' as AnchorId, op: { family: 'value', kind: 'setFormula', formula: '=A1*2' } },
    ],
  );
  const wb = new XlsxSurgicalWriteback();
  return wb.commit(cs, { hostId: 'h1', bytes: original, rev: 0 as DocRev }).then((res) => {
    const model = readXlsxReadback(res.bytes, 'Sheet1');
    assert.equal(model.cells.get('A1')?.value, '文本');
    assert.equal(model.cells.get('A1')?.type, 'inlineStr');
    assert.equal(model.cells.get('B1')?.formula, 'A1*2');
    assert.equal(model.cells.get('B1')?.styleIndex, 2);
    assert.equal(model.cells.get('Z99'), undefined);
  });
});

test('expandA1: single cell, row range, column range, block', () => {
  assert.deepEqual(expandA1('B2'), ['B2']);
  assert.deepEqual(expandA1('A1:B2'), ['A1', 'B1', 'A2', 'B2']);
  assert.deepEqual(expandA1('Sheet1!A1:A1'), ['A1']);
});

// ── end-to-end semantic read-back ────────────────────────────────────────────

test('readback: setValue (number / string / boolean) verifies', async () => {
  const cs = changeSet(
    { a: gridAnchor('a', 'Sheet1!A1'), b: gridAnchor('b', 'Sheet1!B1'), c: gridAnchor('c', 'Sheet1!C1') },
    [
      { id: 'e0', target: 'a' as AnchorId, op: { family: 'value', kind: 'setValue', value: 42 } },
      { id: 'e1', target: 'b' as AnchorId, op: { family: 'value', kind: 'setValue', value: '利润' } },
      { id: 'e2', target: 'c' as AnchorId, op: { family: 'value', kind: 'setValue', value: true } },
    ],
  );
  const { verify } = await commitAndVerify(cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0', 'e1', 'e2']);
  assert.deepEqual(verify.verification.semantic.failedEdits, []);
});

test('readback: setFormula verifies the formula text and warns about cached results', async () => {
  const cs = changeSet(
    { a: gridAnchor('a', 'Sheet1!B1') },
    [{ id: 'e0', target: 'a' as AnchorId, op: { family: 'value', kind: 'setFormula', formula: '=A1*2' } }],
  );
  const { verify } = await commitAndVerify(cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0']);
  assert.match(verify.verification.compatibility.warnings.join('\n'), /cached results are not recalculated/);
});

test('readback: deleteRange verifies every cell in the range is empty', async () => {
  const cs = changeSet(
    { a: gridAnchor('a', 'Sheet1!A1:B1') },
    [{ id: 'e0', target: 'a' as AnchorId, op: { family: 'value', kind: 'deleteRange' } }],
  );
  const { verify } = await commitAndVerify(cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0']);
});

test('readback: setNumberFormat verifies the resolved number-format code', async () => {
  const cs = changeSet(
    { a: gridAnchor('a', 'Sheet1!B1') },
    [{ id: 'e0', target: 'a' as AnchorId, op: { family: 'style', kind: 'setNumberFormat', pattern: '0.0%' } }],
  );
  const { verify } = await commitAndVerify(cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0']);
});

test('readback: setStyle verifies bold/font color/alignment through the style tables', async () => {
  const cs = changeSet(
    { a: gridAnchor('a', 'Sheet1!B1') },
    [{ id: 'e0', target: 'a' as AnchorId, op: { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: true, color: '#ff0000', align: 'center' } } }],
  );
  const { verify } = await commitAndVerify(cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0']);
});

test('readback: an expectation the bytes do not satisfy fails the edit', async () => {
  const original = makeXlsx();
  const wb = new XlsxSurgicalWriteback();
  const committed = changeSet(
    { a: gridAnchor('a', 'Sheet1!A1') },
    [{ id: 'e0', target: 'a' as AnchorId, op: { family: 'value', kind: 'setValue', value: 42 } }],
  );
  const res = await wb.commit(committed, { hostId: 'h1', bytes: original, rev: 0 as DocRev });

  // Same bytes, but a different expectation: the read-back must not rubber-stamp the commit.
  const wrong = changeSet(
    { a: gridAnchor('a', 'Sheet1!A1') },
    [{ id: 'e0', target: 'a' as AnchorId, op: { family: 'value', kind: 'setValue', value: 43 } }],
  );
  const verify = await wb.verify({ hostId: 'h1', bytes: original, rev: 0 as DocRev }, { hostId: 'h1', bytes: res.bytes, rev: 1 as DocRev }, wrong);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, []);
  assert.equal(verify.verification.semantic.failedEdits[0]?.editId, 'e0');
  assert.match(verify.verification.semantic.failedEdits[0]?.reason ?? '', /expected 43/);
});

test('readback: dropped edits (unsupported op) stay failed', async () => {
  const cs = changeSet(
    { a: gridAnchor('a', 'Sheet1!A1') },
    [{ id: 'e0', target: 'a' as AnchorId, op: { family: 'structure', kind: 'insertRows', count: 1, before: true } }],
  );
  const { res, verify } = await commitAndVerify(cs);
  assert.equal(res.ok, false);
  assert.deepEqual(verify.verification.semantic.failedEdits.map((f) => f.editId), ['e0']);
});

test('verifyXlsxReadback: reports failed edits for cells that did not land', () => {
  const bytes = makeXlsx();
  const cs = changeSet(
    { a: gridAnchor('a', 'Sheet1!A1') },
    [{ id: 'e0', target: 'a' as AnchorId, op: { family: 'value', kind: 'setValue', value: 42 } }],
  );
  // Nothing was written: A1 still holds 10.
  const outcome = verifyXlsxReadback(bytes, cs, new Set(['e0']));
  assert.deepEqual(outcome.verifiedEdits, []);
  assert.equal(outcome.failedEdits[0]?.editId, 'e0');
  assert.match(outcome.failedEdits[0]?.reason ?? '', /expected 42, read back 10/);
});

