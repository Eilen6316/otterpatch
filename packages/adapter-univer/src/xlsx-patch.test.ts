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

function makeTwoSheetXlsx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'xl/workbook.xml': enc(
      '<?xml version="1.0"?><workbook xmlns:r="r"><sheets>' +
        '<sheet name="Sheet1" sheetId="1" r:id="rId1"/>' +
        '<sheet name="Sheet2" sheetId="2" r:id="rId2"/>' +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': enc(
      '<?xml version="1.0"?><Relationships>' +
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' +
        '</Relationships>',
    ),
    'xl/styles.xml': enc('<?xml version="1.0"?><styleSheet/>'),
    'xl/worksheets/sheet1.xml': enc('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="B1"><v>10</v></c></row></sheetData></worksheet>'),
    'xl/worksheets/sheet2.xml': enc('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="B1"><v>20</v></c></row></sheetData></worksheet>'),
  });
}

function makeXlsxWithCalcChain(): Uint8Array {
  return repackOoxml(makeXlsx(), {
    '[Content_Types].xml': enc(
      '<?xml version="1.0"?><Types>' +
        '<Override ContentType=\'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml\' PartName=\'/xl/calcChain.xml\'/>' +
        '<Override PartName=\'/xl/styles.xml\' ContentType=\'keep/styles\'/>' +
        '</Types>',
    ),
    'xl/workbook.xml': enc(
      '<?xml version="1.0"?><workbook xmlns:r="r"><sheets>' +
        '<sheet name="Sheet1" sheetId="1" r:id="rId1"/>' +
        '</sheets><calcPr calcOnSave=\'0\' forceFullCalc=\'0\' calcId=\'191029\' fullCalcOnLoad=\'0\' calcMode=\'manual\'/>' +
        '<extLst><ext uri="keep"/></extLst></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': enc(
      '<?xml version="1.0"?><Relationships>' +
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Target=\'calcChain.xml\' Type=\'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain\' Id=\'rIdCalc\'/>' +
        '<Relationship Id=\'rIdKeep\' Type=\'keep/type\' Target=\'theme/theme1.xml\'/>' +
        '</Relationships>',
    ),
    'xl/calcChain.xml': enc('<?xml version="1.0"?><calcChain><c r="B1" i="1"/></calcChain>'),
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

test('xlsx worksheet tokenizer handles attribute order, prefixes, quotes, and extension nodes', async () => {
  const worksheet = '<?xml version="1.0"?>' +
    '<x:worksheet xmlns:x="urn:sheet" xmlns:m="urn:extension"><x:sheetData>' +
    '<x:row custom="keep" r=\'1\'><x:c s=\'2\' r=\'B1\'><x:v>20</x:v></x:c>' +
    '<x:extLst><x:ext uri="keep"><m:c r="B1"/></x:ext></x:extLst></x:row>' +
    '</x:sheetData></x:worksheet>';
  const original = repackOoxml(makeXlsx(), { 'xl/worksheets/sheet1.xml': enc(worksheet) });
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(setB1To(99), { hostId: 'h1', bytes: original, rev: 0 as DocRev });

  assert.equal(res.ok, true);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.equal((sheet.match(/<x:c\b/g) ?? []).length, 1, 'the existing cell is replaced instead of duplicated');
  assert.match(sheet, /<x:c s='2' r='B1'><x:v>99<\/x:v><\/x:c>/);
  assert.match(sheet, /<x:extLst><x:ext uri="keep"><m:c r="B1"\/><\/x:ext><\/x:extLst>/);
  assert.match(sheet, /<x:row custom="keep" r='1'>/);
});

test('xlsx worksheet tokenizer expands prefixed self-closing containers', async () => {
  const worksheet = '<?xml version="1.0"?><x:worksheet xmlns:x="urn:sheet"><x:sheetData /></x:worksheet>';
  const original = repackOoxml(makeXlsx(), { 'xl/worksheets/sheet1.xml': enc(worksheet) });
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(setB1To(99), { hostId: 'h1', bytes: original, rev: 0 as DocRev });

  assert.equal(res.ok, true);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<x:sheetData ><x:row r="1"><x:c r="B1"><x:v>99<\/x:v><\/x:c><\/x:row><\/x:sheetData>/);
});

/** Single-edit ChangeSet: B1 (or the given a1) + an arbitrary EditOp. */
function csOp(op: EditOp, a1 = 'Sheet1!B1', sheet = 'Sheet1'): ChangeSet {
  const aid = 'a1' as AnchorId;
  return {
    id: 'cs',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: { [aid]: { id: aid, hostId: 'h1' as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid', sheet, a1 } } },
    origin: { by: 'human' },
    meta: { intent: 't' },
    edits: [{ id: 'e1', target: aid, op }],
  };
}

test('xlsx writeback honors portable.sheet when a1 is unqualified', async () => {
  const original = makeTwoSheetXlsx();
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(
    csOp({ family: 'value', kind: 'setValue', value: 99 }, 'B1', 'Sheet2'),
    { hostId: 'h1', bytes: original, rev: 0 as DocRev },
  );

  assert.equal(res.ok, true);
  assert.deepEqual(res.touchedParts, ['xl/worksheets/sheet2.xml']);
  const parts = readOoxmlParts(res.bytes);
  assert.match(dec.decode(parts['xl/worksheets/sheet1.xml']!), /<c r="B1"><v>10<\/v><\/c>/);
  assert.match(dec.decode(parts['xl/worksheets/sheet2.xml']!), /<c r="B1"><v>99<\/v><\/c>/);
});

test('P1.3 setFormula:写 <f> 真落盘(保留样式 s),不再静默丢弃', async () => {
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(csOp({ family: 'value', kind: 'setFormula', formula: '=C2*D2' }), { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(res.appliedEditIds, ['e1']);
  assert.deepEqual(res.droppedEdits, []);
  const parts = readOoxmlParts(res.bytes);
  const sheet = dec.decode(parts['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B1" s="2"><f>C2\*D2<\/f><\/c>/);
  assert.match(
    dec.decode(parts['xl/workbook.xml']!),
    /<\/sheets><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"\/><\/workbook>/,
  );
});

test('formula write forces full recalculation and removes stale calc chain metadata', async () => {
  const original = makeXlsxWithCalcChain();
  const cs = csOp({ family: 'value', kind: 'setFormula', formula: '=C2*D2' });
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(cs, { hostId: 'h1', bytes: original, rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(new Set(res.touchedParts), new Set([
    'xl/worksheets/sheet1.xml',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    '[Content_Types].xml',
    'xl/calcChain.xml',
  ]));
  assert.deepEqual(res.fidelity.drift, []);

  const parts = readOoxmlParts(res.bytes);
  const workbook = dec.decode(parts['xl/workbook.xml']!);
  const calcPr = /<calcPr\b[^>]*\/>/.exec(workbook)?.[0] ?? '';
  assert.match(calcPr, /\bcalcMode="auto"/);
  assert.match(calcPr, /\bfullCalcOnLoad="1"/);
  assert.match(calcPr, /\bforceFullCalc="1"/);
  assert.match(calcPr, /\bcalcId='191029'/, 'unrelated calculation attributes are preserved');
  assert.match(calcPr, /\bcalcOnSave='0'/, 'unrelated calculation attributes are preserved');
  assert.match(workbook, /<extLst><ext uri="keep"\/><\/extLst>/);
  assert.equal(parts['xl/calcChain.xml'], undefined);

  const relationships = dec.decode(parts['xl/_rels/workbook.xml.rels']!);
  assert.doesNotMatch(relationships, /calcChain|rIdCalc/);
  assert.match(relationships, /rId1/);
  assert.match(relationships, /rIdKeep/);
  const contentTypes = dec.decode(parts['[Content_Types].xml']!);
  assert.doesNotMatch(contentTypes, /calcChain/);
  assert.match(contentTypes, /keep\/styles/);

  const verification = await wb.verify(
    { hostId: 'h1', bytes: original, rev: 0 as DocRev },
    { hostId: 'h1', bytes: res.bytes, rev: 1 as DocRev },
    cs,
  );
  assert.deepEqual(verification.drift, [], 'expected calcChain deletion is not integrity drift');
});

test('non-formula writes leave calculation settings and calc chain byte-identical', async () => {
  const original = makeXlsxWithCalcChain();
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(setB1To(99), { hostId: 'h1', bytes: original, rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(res.touchedParts, ['xl/worksheets/sheet1.xml']);
  const before = readOoxmlParts(original);
  const after = readOoxmlParts(res.bytes);
  for (const path of ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml', 'xl/calcChain.xml']) {
    assert.deepEqual(after[path], before[path], `${path} must remain byte-identical`);
  }
});

test('a dropped formula edit does not change workbook calculation metadata', async () => {
  const original = makeXlsx();
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(
    csOp({ family: 'value', kind: 'setFormula', formula: '=1+1' }, 'B1', 'Missing'),
    { hostId: 'h1', bytes: original, rev: 0 as DocRev },
  );

  assert.equal(res.ok, false);
  assert.deepEqual(res.touchedParts, []);
  assert.deepEqual(readOoxmlParts(res.bytes)['xl/workbook.xml'], readOoxmlParts(original)['xl/workbook.xml']);
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

test('xlsx batch editor merges sequential value and style edits on one cell', async () => {
  const cs = setB1To(99);
  cs.edits.push({ id: 'e2', target: cs.edits[0]!.target, op: { family: 'style', kind: 'setStyle', style: { bold: true } } });
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(cs, { hostId: 'h1', bytes: makeXlsx(), rev: 0 as DocRev });

  assert.equal(res.ok, true);
  const parts = readOoxmlParts(res.bytes);
  assert.match(dec.decode(parts['xl/worksheets/sheet1.xml']!), /<c r="B1" s="\d+"><v>99<\/v><\/c>/);
  assert.match(dec.decode(parts['xl/styles.xml']!), /<b\/>/);
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

test('xlsx writeback batches a large range into one worksheet render', { timeout: 10_000 }, async () => {
  const original = repackOoxml(makeXlsx(), {
    'xl/worksheets/sheet1.xml': enc('<?xml version="1.0"?><worksheet><sheetData/></worksheet>'),
  });
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(
    csOp({ family: 'value', kind: 'setValue', value: 7 }, 'Sheet1!A1:CV50'),
    { hostId: 'h1', bytes: original, rev: 0 as DocRev },
  );

  assert.equal(res.ok, true);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.equal((sheet.match(/<c r=/g) ?? []).length, 5_000);
  assert.match(sheet, /<c r="A1"><v>7<\/v><\/c>/);
  assert.match(sheet, /<c r="CV50"><v>7<\/v><\/c>/);
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
