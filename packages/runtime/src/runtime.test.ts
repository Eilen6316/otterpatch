/**
 * End-to-end (through runtime): intent → ChangeSet (mocked) → diff → surgical writeback to .xlsx, asserting the full event stream is emitted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import type { AnchorId, ChangeSet, DocRev, HostId } from '@otterpatch/core';
import { MockModelClient, type ModelClient, type ProposeRequest, type RespondOptions, type AgentResponse } from '@otterpatch/agent';
import { comparePartsIntegrity, readOoxmlParts } from '@otterpatch/writeback-surgical';
import { OtterPatchRuntime } from './runtime.js';
import { buildDiff } from './diff.js';
import type { OtterPatchEvent } from './events.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();

test('runtime diff summarizes structured Word tables without flattening cells', () => {
  const anchorId = 'a0' as AnchorId;
  const cs: ChangeSet = {
    id: 'table-cs', hostId: 'h', baseRev: 0 as DocRev, origin: { by: 'human' }, meta: { intent: 'insert table' },
    anchors: { [anchorId]: { id: anchorId, hostId: 'h' as HostId, kind: 'flow', ref: null, baseRev: 0 as DocRev, portable: { kind: 'flow', path: [], quote: { prefix: '', text: '', suffix: '' }, bias: 'left' } } },
    edits: [{ id: 'e0', target: anchorId, op: { family: 'structure', kind: 'insertTable', rows: [['Name', 'Value'], ['Alpha', '10']], headerRows: 1, at: 'end' } }],
  };

  assert.deepEqual(buildDiff(cs).items[0], {
    editId: 'e0', ref: '文档末尾', kind: 'insertTable', badge: 'add', label: '插入 2×2 表格 · 1 行表头', after: '2×2 表格',
  });
});

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

test('runtime: verifyOpts 给 word/drawio 挂上影子自检、未注册格式不挂', async () => {
  const rt = new OtterPatchRuntime();
  const captured: Array<RespondOptions | undefined> = [];
  const cap: ModelClient = {
    proposeChangeSet: async () => { throw new Error('unused'); },
    respondStream: async (_req: ProposeRequest, _d, onEvent, opts) => {
      captured.push(opts);
      const result: AgentResponse = { kind: 'answer', text: 'ok' };
      onEvent({ type: 'done', result });
      return result;
    },
  };
  const base = { hostId: 'h1', intent: 'x', baseRev: 0 as DocRev, anchors: [] };
  await rt.respondStream({ ...base, format: 'word', context: '全省财政收入逐年增长。' }, cap, () => {});
  await rt.respondStream({ ...base, format: 'drawio', context: '<mxGraphModel/>' }, cap, () => {});
  await rt.respondStream({ ...base, format: 'pdf', context: 'AcroForm 字段…' }, cap, () => {});
  assert.ok(captured[0]?.verify, 'word 应挂上 verify(锚点可落地性自检)');
  assert.ok(captured[1]?.verify, 'drawio 也应挂上 verify(拓扑完整性自检)');
  assert.equal(captured[2]?.verify, undefined, '未注册校验器的格式(pdf)不挂');
});

test('runtime: 未注册格式 commit 抛错;已注册含 excel/word/pdf/ppt/drawio', async () => {
  const rt = new OtterPatchRuntime();
  for (const f of ['excel', 'word', 'pdf', 'ppt', 'drawio']) assert.ok(rt.formats().includes(f), `missing backend ${f}`);
  await assert.rejects(
    () => rt.commit({ format: 'csv', bytes: new Uint8Array(), changeSet: { id: 'c', hostId: 'h', baseRev: 0 as DocRev, anchors: {}, origin: { by: 'human' }, meta: { intent: 'x' }, edits: [] } }),
    /no writeback backend/,
  );
});

test('runtime: legacy propose path runs verifier and fails closed', async () => {
  const rt = new OtterPatchRuntime();
  rt.registerVerifier('excel', () => async () => ({ ok: false, report: 'forced verifier failure' }));
  const model = new MockModelClient(() => ({ plan: 'bad ref', edits: [{ cell: 'Sheet1!A1', op: 'setValue', value: 1 }] }));
  await assert.rejects(
    () => rt.propose({ hostId: 'h1', format: 'excel', intent: 'bad', baseRev: 0 as DocRev, anchors: [], context: 'A1=1' }, model),
    /forced verifier failure/,
  );
});

test('runtime: commit rejects stale base revision', async () => {
  const rt = new OtterPatchRuntime();
  const cs = { id: 'c', hostId: 'h', baseRev: 0 as DocRev, anchors: {}, origin: { by: 'human' as const }, meta: { intent: 'x' }, edits: [] };
  await assert.rejects(() => rt.commit({ format: 'excel', bytes: makeXlsx(), changeSet: cs, currentRev: 1 as DocRev }), /stale/);
});

test('runtime: commit rejects invalid acceptedEditIds', async () => {
  const rt = new OtterPatchRuntime();
  const aid = 'a0' as import('@otterpatch/core').AnchorId;
  const cs = {
    id: 'c',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: { [aid]: { id: aid, hostId: 'h' as import('@otterpatch/core').HostId, kind: 'grid' as const, ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid' as const, sheet: 'Sheet1', a1: 'B1' } } },
    origin: { by: 'human' as const },
    meta: { intent: 'x' },
    edits: [{ id: 'e1', target: aid, op: { family: 'value' as const, kind: 'setValue' as const, value: 1 } }],
  };
  await assert.rejects(() => rt.commit({ format: 'excel', bytes: makeXlsx(), changeSet: cs, acceptedEditIds: [] }), /must not be empty/);
  await assert.rejects(() => rt.commit({ format: 'excel', bytes: makeXlsx(), changeSet: cs, acceptedEditIds: ['missing'] }), /unknown edit id/);
  await assert.rejects(() => rt.commit({ format: 'excel', bytes: makeXlsx(), changeSet: cs, acceptedEditIds: ['e1', 'e1'] }), /duplicate edit id/);
});
