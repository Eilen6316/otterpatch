/**
 * 端到端:Excel setValue → 外科补丁写回真实结构的 .xlsx,验证
 *  (1) 目标单元格值确实改了、样式保留;
 *  (2) 其余部件(workbook/rels/styles/media…)字节级不变。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import type { AnchorId, ChangeSet, DocRev, HostId } from '@otterpatch/core';
import {
  SurgicalOoxmlWriteback,
  comparePartsIntegrity,
  readOoxmlParts,
} from '@otterpatch/writeback-surgical';
import { buildXlsxCompiler } from './xlsx-patch.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();

/** 构造一个结构合法的迷你 .xlsx(单 sheet,A1=10、B1=20,带样式/媒体作为"不应改动"的部件)。 */
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
