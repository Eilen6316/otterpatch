/**
 * 端到端(through runtime):意图 → ChangeSet(Mock)→ diff → 外科写回 .xlsx,并断言事件流齐发。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import type { DocRev } from '@otterpatch/core';
import { MockModelClient } from '@otterpatch/agent';
import { comparePartsIntegrity, readOoxmlParts } from '@otterpatch/writeback-surgical';
import { OtterPatchRuntime } from './runtime.js';
import type { OtterPatchEvent } from './events.js';

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
  });
}

test('runtime: propose → diff → commit(excel) 端到端 + 事件流', async () => {
  const rt = new OtterPatchRuntime();
  const seen: OtterPatchEvent['type'][] = [];
  rt.on((e) => seen.push(e.type));

  const model = new MockModelClient(() => ({ plan: '把 B1 改成 99', edits: [{ cell: 'Sheet1!B1', op: 'setValue', value: 99 }] }));
  const cs = await rt.propose(
    { hostId: 'h1', format: 'excel', intent: '把 B1 改成 99', baseRev: 0 as DocRev, anchors: [], context: 'B1=20' },
    model,
  );
  assert.equal(cs.edits.length, 1);

  const d = rt.diff(cs);
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0]!.after, '99');
  assert.equal(d.items[0]!.badge, 'modify');

  const original = makeXlsx();
  const res = await rt.commit({ format: 'excel', bytes: original, changeSet: cs });
  assert.equal(res.ok, true);
  assert.deepEqual(comparePartsIntegrity(original, res.bytes).changed, ['~xl/worksheets/sheet1.xml']);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B1" s="2"><v>99<\/v><\/c>/);

  for (const t of ['propose:start', 'propose:done', 'diff:done', 'commit:start', 'commit:done'] as const) {
    assert.ok(seen.includes(t), `missing event ${t}`);
  }
});

test('runtime: 未注册格式 commit 抛错;已注册含 excel/word/pdf/ppt/drawio', async () => {
  const rt = new OtterPatchRuntime();
  for (const f of ['excel', 'word', 'pdf', 'ppt', 'drawio']) assert.ok(rt.formats().includes(f), `missing backend ${f}`);
  await assert.rejects(
    () => rt.commit({ format: 'csv', bytes: new Uint8Array(), changeSet: { id: 'c', hostId: 'h', baseRev: 0 as DocRev, anchors: {}, origin: { by: 'human' }, meta: { intent: 'x' }, edits: [] } }),
    /no writeback backend/,
  );
});
