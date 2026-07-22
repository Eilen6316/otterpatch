/**
 * End-to-end: Excel setValue → surgical patch written back into a structurally real .xlsx, verifying
 *  (1) the target cell value actually changed and its style is preserved;
 *  (2) all other parts (workbook/rels/styles/media...) are byte-identical.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import type { AnchorId, ChangeSet, DocRev, EditOp, HostId } from '@otterpatch/core';
import {
  SurgicalOoxmlWriteback,
  comparePartsIntegrity,
  readOoxmlParts,
  repackOoxml,
} from '@otterpatch/writeback-surgical';
import { buildXlsxCompiler } from './xlsx-patch.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();

/** Build a structurally valid mini .xlsx (single sheet, A1=10, B1=20, with styles/media as "must-not-change" parts). */
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

function setB1To(value: number | string): ChangeSet {
  const anchorId = 'a1' as AnchorId;
  return {
    id: 'cs1',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: {
      [anchorId]: {
        id: anchorId,
        hostId: 'h1' as HostId,
        kind: 'grid',
        ref: null,
        baseRev: 0 as DocRev,
        portable: { kind: 'grid', sheet: 'Sheet1', a1: 'Sheet1!B1' },
      },
    },
    origin: { by: 'human' },
    meta: { intent: `set B1=${value}` },
    edits: [{ id: 'e1', target: anchorId, op: { family: 'value', kind: 'setValue', value } }],
  };
}

test('setValue 数字:B1 改为 99,其余部件字节级不变,样式保留', async () => {
  const original = makeXlsx();
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(setB1To(99), { hostId: 'h1', bytes: original, rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(res.touchedParts, ['xl/worksheets/sheet1.xml']);

  const integ = comparePartsIntegrity(original, res.bytes);
  assert.deepEqual(integ.changed, ['~xl/worksheets/sheet1.xml'], '只有 sheet1.xml 改动');
  assert.equal(integ.identical, 6, 'workbook/rels/styles/media/Content_Types/.rels 全部不变');

  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B1" s="2"><v>99<\/v><\/c>/, 'B1=99 且样式 s="2" 保留');
  assert.match(sheet, /<c r="A1"><v>10<\/v><\/c>/, 'A1 未受影响');
});

test('setValue 字符串:走 inlineStr,不触碰 sharedStrings', async () => {
  const original = makeXlsx();
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(setB1To('利润'), { hostId: 'h1', bytes: original, rev: 0 as DocRev });

  assert.deepEqual(res.touchedParts, ['xl/worksheets/sheet1.xml']);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B1" s="2" t="inlineStr"><is><t>利润<\/t><\/is><\/c>/);
});

/** Single-edit ChangeSet: B1 (or the given a1) + an arbitrary EditOp. */
function csOp(op: EditOp, a1 = 'Sheet1!B1'): ChangeSet {
  const aid = 'a1' as AnchorId;
  return {
    id: 'cs',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: { [aid]: { id: aid, hostId: 'h1' as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid', sheet: 'Sheet1', a1 } } },
    origin: { by: 'human' },
    meta: { intent: 't' },
    edits: [{ id: 'e1', target: aid, op }],
  };
}

test('P1.3 setFormula:写 <f> 真落盘(保留样式 s),不再静默丢弃', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'value', kind: 'setFormula', formula: '=C2*D2' }), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(res.appliedEditIds, ['e1']);
  assert.deepEqual(res.droppedEdits, []);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B1" s="2"><f>C2\*D2<\/f><\/c>/);
});

test('P1.3 setStyle:登记到 styles.xml 并改单元格 s(保留原值),ok=true', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'style', kind: 'setStyle', style: { bold: true, bgColor: '#ffd6d6' } }), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.ok(res.touchedParts.includes('xl/styles.xml'), 'styles.xml 被写入');
  assert.ok(res.touchedParts.includes('xl/worksheets/sheet1.xml'), 'sheet 被写入');
  const styles = dec.decode(readOoxmlParts(res.bytes)['xl/styles.xml']!);
  assert.match(styles, /<b\/>/, '登记了加粗字体');
  assert.match(styles, /patternType="solid"><fgColor rgb="FFFFD6D6"/, '登记了填充色');
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B1" s="\d+"><v>20<\/v><\/c>/, 'B1 原值保留、仅样式索引改变');
});

test('P1.3 setNumberFormat:登记 numFmt(custom id≥164)到 styles.xml', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'style', kind: 'setNumberFormat', pattern: '0%' }), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });

  assert.equal(res.ok, true);
  const styles = dec.decode(readOoxmlParts(res.bytes)['xl/styles.xml']!);
  assert.match(styles, /<numFmt numFmtId="16[0-9]" formatCode="0%"\/>/);
});

test('P1.3 写入空/不存在的单元格:插入新 <c>(必要时建 <row>),不再 throw', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'value', kind: 'setValue', value: 42 }, 'Sheet1!C5'), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(res.appliedEditIds, ['e1']);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<row r="5"><c r="C5"><v>42<\/v><\/c><\/row>/);
  assert.match(sheet, /<c r="A1"><v>10<\/v><\/c>/, '原有单元格不受影响');
});

test('P0 诚实写回:不支持的 op 进 droppedEdits 且 ok=false(不再静默成功)', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'text', kind: 'replaceText', text: 'x' }), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });

  assert.equal(res.ok, false, '丢了改动就不能报成功');
  assert.deepEqual(res.appliedEditIds, []);
  assert.equal(res.droppedEdits?.length, 1);
  assert.match(res.droppedEdits![0]!.reason, /replaceText/);
  assert.deepEqual(res.touchedParts, [], '什么都没写');
});

test('xlsx writeback: invalid A1 is dropped instead of falling back to A1', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'value', kind: 'setValue', value: 7 }, 'Sheet1!not-a-cell'), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedEditIds, []);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /invalid A1/i);
  assert.deepEqual(res.touchedParts, []);
});

test('xlsx writeback: rejects oversized ranges before expanding cell addresses', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'value', kind: 'setValue', value: 7 }, 'Sheet1!A1:XFD1048576'), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /resource limit exceeded: range_cells/);
});

test('xlsx writeback: explicit missing sheet is dropped instead of falling back to sheet1', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'value', kind: 'setValue', value: 7 }, 'Missing!B1'), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedEditIds, []);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /Missing|not found/);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B1" s="2"><v>20<\/v><\/c>/);
});

test('xlsx writeback: invalid style color is dropped and not written into styles.xml', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'style', kind: 'setStyle', style: { color: '#fff" bad="1' } }), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedEditIds, []);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /invalid ARGB color/);
  assert.deepEqual(res.touchedParts, []);
});

test('xlsx writeback: rejects worksheet relationship traversal target', async () => {
  const original = zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'xl/workbook.xml': enc('<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': enc('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="../evil.xml"/></Relationships>'),
    'xl/styles.xml': enc('<?xml version="1.0"?><styleSheet/>'),
    'xl/worksheets/sheet1.xml': enc('<?xml version="1.0"?><worksheet><sheetData/></worksheet>'),
  });
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'value', kind: 'setValue', value: 7 }), { hostId: 'h1', bytes: original, rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /invalid worksheet relationship target/);
});

test('repackOoxml rejects unsafe patch paths', () => {
  assert.throws(() => repackOoxml(makeXlsx(), { '../evil.xml': enc('x') }), /unsafe OOXML part path/);
});
