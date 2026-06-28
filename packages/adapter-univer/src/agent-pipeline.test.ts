/**
 * 端到端:自然语言意图 → ChangeSet(Mock 模型)→ Excel 外科写回真实结构 .xlsx。
 * 把"上游 Agent"和"下游写回"接成一条线,证明整条管线跑通。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import type { DocRev } from '@otterpatch/core';
import { Agent, MockModelClient } from '@otterpatch/agent';
import { SurgicalOoxmlWriteback, comparePartsIntegrity, readOoxmlParts } from '@otterpatch/writeback-surgical';
import { buildXlsxCompiler } from './xlsx-patch.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();

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
      '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="B1" s="2"><v>20</v></c></row></sheetData></worksheet>',
    ),
    'xl/media/image1.png': new Uint8Array([1, 2, 3, 4]),
  });
}

test('意图 → ChangeSet(Mock)→ 外科写回:B1 改为 99,其余部件字节级不变', async () => {
  // Mock 模型:把"把 B1 改成 99"这类意图变成 setValue 提案
  const agent = new Agent(
    new MockModelClient(() => ({ plan: '把 B1 改成 99', edits: [{ cell: 'Sheet1!B1', op: 'setValue', value: 99 }] })),
  );
  const cs = await agent.propose({
    hostId: 'h1',
    format: 'excel',
    intent: '把 B1 改成 99',
    baseRev: 0 as DocRev,
    anchors: [],
    context: 'B1=20',
  });
  assert.equal(cs.meta.planSummary, '把 B1 改成 99');

  const original = makeXlsx();
  const wb = new SurgicalOoxmlWriteback(buildXlsxCompiler());
  const res = await wb.commit(cs, { hostId: 'h1', bytes: original, rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(comparePartsIntegrity(original, res.bytes).changed, ['~xl/worksheets/sheet1.xml']);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B1" s="2"><v>99<\/v><\/c>/);
});
