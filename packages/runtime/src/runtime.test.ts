/**
 * End-to-end (through runtime): intent → ChangeSet (mocked) → diff → surgical writeback to .xlsx, asserting the full event stream is emitted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { AdapterRegistry, STRICT_POLICY, capabilityManifestFor, type AnchorId, type ChangeSet, type DocRev, type HostId, type WritebackBackend, type WritebackId } from '@otterpatch/core';
import { UniverAdapter } from '@otterpatch/adapter-univer';
import { MockModelClient, type ModelClient, type ProposeRequest, type RespondOptions, type AgentResponse } from '@otterpatch/agent';
import { comparePartsIntegrity, readOoxmlParts } from '@otterpatch/writeback-surgical';
import { OtterPatchRuntime } from './runtime.js';
import { buildDiff } from './diff.js';
import type { OtterPatchEvent } from './events.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();

test('runtime diff keeps proposal data separate when no Word shadow is available', () => {
  const anchorId = 'a0' as AnchorId;
  const cs: ChangeSet = {
    id: 'table-cs', hostId: 'h', baseRev: 0 as DocRev, origin: { by: 'human' }, meta: { intent: 'insert table' },
    anchors: { [anchorId]: { id: anchorId, hostId: 'h' as HostId, kind: 'flow', ref: null, baseRev: 0 as DocRev, portable: { kind: 'flow', path: [], quote: { prefix: '', text: '', suffix: '' }, bias: 'left' } } },
    edits: [{ id: 'e0', target: anchorId, op: { family: 'structure', kind: 'insertTable', rows: [['Name', 'Value'], ['Alpha', '10']], headerRows: 1, at: 'end' } }],
  };

  const diff = buildDiff(cs, { format: 'word', unavailableReason: 'no Word shadow' });
  assert.equal(diff.previewStatus, 'unavailable');
  assert.equal(diff.items[0]?.ref, '文档末尾');
  assert.equal(diff.items[0]?.proposalSummary, '2×2 表格');
  assert.equal(diff.items[0]?.before, undefined);
  assert.equal(diff.items[0]?.after, undefined);
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

function singleCellChangeSet(id = 'single', op: ChangeSet['edits'][number]['op'] = { family: 'value', kind: 'setValue', value: 1 }): ChangeSet {
  const aid = 'a0' as AnchorId;
  return {
    id, hostId: 'h', baseRev: 0 as DocRev,
    anchors: { [aid]: { id: aid, hostId: 'h' as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid', sheet: 'Sheet1', a1: 'B1' } } },
    origin: { by: 'human' }, meta: { intent: 'x' }, edits: [{ id: 'e1', target: aid, op }],
  };
}

test('runtime: propose → diff → commit(excel) 端到端 + 事件流', async () => {
  const rt = new OtterPatchRuntime();
  const seen: OtterPatchEvent['type'][] = [];
  rt.on((e) => seen.push(e.type));

  const model = new MockModelClient(() => ({ plan: '把 B1 改成 99', edits: [{ cell: 'Sheet1!B1', op: 'setValue', value: 99 }] }));
  const request: ProposeRequest = {
    hostId: 'h1', format: 'excel', intent: '把 B1 改成 99', baseRev: 0 as DocRev, anchors: [], context: 'B1=20',
    sheet: { a1: 'Sheet1!B1', name: 'Sheet1', values: [[20]], formulas: [[null]] },
  };
  const cs = await rt.propose(
    request,
    model,
  );
  assert.equal(cs.edits.length, 1);

  const d = await rt.diff(cs, { format: 'excel', sheet: request.sheet });
  assert.equal(d.items.length, 1);
  assert.deepEqual(d.items[0]!.before, { kind: 'cell', value: 20 });
  assert.deepEqual(d.items[0]!.after, { kind: 'cell', value: 99 });
  assert.equal(d.previewStatus, 'verified');
  assert.equal(d.items[0]!.badge, 'modify');

  const original = makeXlsx();
  const proposal = rt.createProposal(cs, 'excel');
  const reviewed = rt.reviewProposal(proposal, cs, cs.edits.map((edit) => edit.id), original, 'test-reviewer');
  const res = await rt.commit({ format: 'excel', bytes: original, changeSet: cs, ...reviewed });
  assert.equal(res.ok, true);
  assert.deepEqual(comparePartsIntegrity(original, res.bytes).changed, ['~xl/worksheets/sheet1.xml']);
  const sheet = dec.decode(readOoxmlParts(res.bytes)['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B1" s="2"><v>99<\/v><\/c>/);

  for (const t of ['propose:start', 'propose:done', 'diff:done', 'commit:start', 'commit:done'] as const) {
    assert.ok(seen.includes(t), `missing event ${t}`);
  }
});

test('runtime diff reports shadow before/after and indirect formula recalculation', async () => {
  const anchorId = 'a0' as AnchorId;
  const cs: ChangeSet = {
    id: 'recalc', hostId: 'h', baseRev: 0 as DocRev,
    anchors: { [anchorId]: { id: anchorId, hostId: 'h' as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid', sheet: 'Sheet1', a1: 'A1' } } },
    origin: { by: 'human' }, meta: { intent: 'change dependency' },
    edits: [{ id: 'e0', target: anchorId, op: { family: 'value', kind: 'setValue', value: 25 } }],
  };
  const diff = await new OtterPatchRuntime().diff(cs, {
    format: 'excel',
    sheet: { a1: 'Sheet1!A1:B1', name: 'Sheet1', values: [[10, 20]], formulas: [[null, '=A1*2']] },
  });

  assert.deepEqual(diff.items[0]?.before, { kind: 'cell', value: 10 });
  assert.deepEqual(diff.items[0]?.after, { kind: 'cell', value: 25 });
  assert.deepEqual(diff.indirectEffects[0]?.before, { kind: 'cell', value: 20, formula: '=A1*2' });
  assert.deepEqual(diff.indirectEffects[0]?.after, { kind: 'cell', value: 50, formula: '=A1*2' });
  assert.equal(diff.indirectEffects[0]?.target, 'Sheet1!B1');
  assert.deepEqual(diff.expectedTouchedParts, ['worksheet[Sheet1]']);
});

test('runtime diff exposes complete range details and observed style state', async () => {
  const rangeAnchor = 'range' as AnchorId;
  const rangeChangeSet: ChangeSet = {
    id: 'range-preview', hostId: 'h', baseRev: 0 as DocRev,
    anchors: { [rangeAnchor]: { id: rangeAnchor, hostId: 'h' as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid', sheet: 'Sheet1', a1: 'A1:B2' } } },
    origin: { by: 'human' }, meta: { intent: 'range' },
    edits: [{ id: 'e0', target: rangeAnchor, op: { family: 'value', kind: 'setValue', value: 9 } }],
  };
  const runtime = new OtterPatchRuntime();
  const range = await runtime.diff(rangeChangeSet, {
    format: 'excel', sheet: { a1: 'Sheet1!A1:B2', name: 'Sheet1', values: [[1, 2], [3, 4]], formulas: [[null, null], [null, null]] },
  });
  assert.equal(range.previewStatus, 'verified');
  assert.equal(range.items[0]?.affectedCount, 4);
  assert.equal(range.items[0]?.directEffects.length, 4);
  assert.deepEqual(range.items[0]?.directEffects.map((effect) => (effect.before as { value: unknown }).value), [1, 2, 3, 4]);
  assert.deepEqual(range.items[0]?.directEffects.map((effect) => (effect.after as { value: unknown }).value), [9, 9, 9, 9]);

  const styleChangeSet = singleCellChangeSet('style-preview', { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: false } });
  const style = await runtime.diff(styleChangeSet, {
    format: 'excel',
    sheet: { a1: 'Sheet1!B1', name: 'Sheet1', values: [[10]], styles: [[{ bold: true }]] },
  });
  assert.equal(style.previewStatus, 'verified');
  assert.deepEqual(style.items[0]?.before, { kind: 'cell', value: 10, style: { bold: true } });
  assert.deepEqual(style.items[0]?.after, { kind: 'cell', value: 10, style: { bold: false } });
});

test('runtime diff marks unsupported formula simulation unavailable instead of inventing zero', async () => {
  const changeSet = singleCellChangeSet('unsupported-formula', { family: 'value', kind: 'setFormula', formula: '=XLOOKUP(1,A1:A3,C1:C3)' });
  const diff = await new OtterPatchRuntime().diff(changeSet, {
    format: 'excel', sheet: { a1: 'Sheet1!A1:B3', name: 'Sheet1', values: [[1, 2], [3, 4], [5, 6]], formulas: [[null, null], [null, null], [null, null]] },
  });
  assert.equal(diff.previewStatus, 'unavailable');
  assert.match(diff.unavailableReason ?? '', /VERIFIER_UNSUPPORTED_FORMULA/);
  assert.equal(diff.items[0]?.before, undefined);
  assert.equal(diff.items[0]?.after, undefined);
});

test('runtime diff fails closed when a formula dependency is outside the snapshot', async () => {
  const changeSet = singleCellChangeSet('outside-formula-dependency', { family: 'value', kind: 'setFormula', formula: '=C1+1' });
  const diff = await new OtterPatchRuntime().diff(changeSet, {
    format: 'excel', sheet: { a1: 'Sheet1!A1:B1', name: 'Sheet1', values: [[1, 2]], formulas: [[null, null]] },
  });
  assert.equal(diff.previewStatus, 'unavailable');
  assert.match(diff.unavailableReason ?? '', /VERIFIER_INSUFFICIENT_SNAPSHOT/);
});

test('runtime diff is explicit when the source snapshot is missing', async () => {
  const diff = await new OtterPatchRuntime().diff(singleCellChangeSet('no-snapshot'), { format: 'excel' });
  assert.equal(diff.previewStatus, 'unavailable');
  assert.equal(diff.source, 'unavailable');
  assert.match(diff.unavailableReason ?? '', /sheet snapshot/);
  assert.equal(diff.items[0]?.before, undefined);
  assert.equal(diff.items[0]?.after, undefined);
  assert.deepEqual(diff.items[0]?.proposedAfter, { kind: 'cell', value: 1 });
});

test('runtime diff does not treat a target outside the snapshot as an empty cell', async () => {
  const diff = await new OtterPatchRuntime().diff(singleCellChangeSet('outside-snapshot'), {
    format: 'excel',
    sheet: { a1: 'Sheet1!A1', name: 'Sheet1', values: [[10]] },
  });
  assert.equal(diff.previewStatus, 'unavailable');
  assert.equal(diff.items[0]?.backendSupport, 'partial');
  assert.equal(diff.items[0]?.before, undefined);
  assert.equal(diff.items[0]?.after, undefined);
});

test('runtime diff preserves explicit format removal and null proposal semantics', () => {
  const style = buildDiff(
    singleCellChangeSet('remove-format', { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: false, italic: false } }),
    { format: 'excel', unavailableReason: 'style snapshot unavailable' },
  );
  assert.match(style.items[0]?.label ?? '', /取消加粗/);
  assert.match(style.items[0]?.label ?? '', /取消斜体/);
  assert.deepEqual(style.items[0]?.style, { bold: false, italic: false });

  const cleared = buildDiff(
    singleCellChangeSet('clear-value', { family: 'value', kind: 'setValue', value: null }),
    { format: 'excel', unavailableReason: 'snapshot unavailable' },
  );
  assert.deepEqual(cleared.items[0]?.proposedAfter, { kind: 'cell', value: null });
  assert.equal(cleared.items[0]?.proposalSummary, 'null');
});

test('runtime: verifyOpts 给 word/drawio/pptx 挂上分级检查、未注册格式不挂', async () => {
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
  await rt.respondStream({ ...base, format: 'pptx', context: 'Hello', ppt: { slides: [{ paragraphs: [{ runs: ['Hello'] }] }] } }, cap, () => {});
  await rt.respondStream({ ...base, format: 'pdf', context: 'AcroForm 字段…' }, cap, () => {});
  assert.ok(captured[0]?.verify, 'word 应挂上 verify(锚点可落地性自检)');
  assert.ok(captured[1]?.verify, 'drawio 也应挂上 verify(拓扑完整性自检)');
  assert.ok(captured[2]?.verify, 'pptx 应挂上 verify(页内唯一且单 run)');
  assert.equal(captured[3]?.verify, undefined, '未注册校验器的格式(pdf)不挂');
});

test('runtime passes its actual approval mode into the trusted Agent capability block', async () => {
  const rt = new OtterPatchRuntime({ approvalPolicy: STRICT_POLICY, allowUnreviewedCommit: true });
  let system = '';
  const model: ModelClient = {
    proposeChangeSet: async () => { throw new Error('unused'); },
    respond: async (_req, dialect) => {
      system = dialect.systemPrompt;
      return { kind: 'answer', text: 'ok' };
    },
  };
  await rt.respond({
    hostId: 'h', format: 'excel', intent: 'inspect', baseRev: 0 as DocRev, anchors: [], context: '',
    sheet: { name: 'Sheet1', a1: 'A1', values: [[1]] },
  }, model);
  assert.match(system, /explicit unreviewed-commit mode is enabled/);
  assert.match(system, /autoApprove=safe;requiresApproval=caution,destructive/);
});

test('runtime: PPTX proposal verifier rejects missing, duplicate, and cross-run targets before review', async () => {
  const rt = new OtterPatchRuntime();
  const model = new MockModelClient(() => ({ plan: 'retitle', edits: [{ slide: 0, find: 'Hello', replace: 'World' }] }));
  const base: ProposeRequest = { hostId: 'h', format: 'pptx', intent: 'retitle', baseRev: 0 as DocRev, anchors: [], context: 'Hello' };

  await assert.rejects(() => rt.propose(base, model), /PPTX_SNAPSHOT_REQUIRED/);
  await assert.rejects(
    () => rt.propose({ ...base, ppt: { slides: [{ paragraphs: [{ runs: ['Hello'] }, { runs: ['Hello'] }] }] } }, model),
    /PPTX_AMBIGUOUS_QUOTE/,
  );
  await assert.rejects(
    () => rt.propose({ ...base, ppt: { slides: [{ paragraphs: [{ runs: ['Hel', 'lo'] }] }] } }, model),
    /PPTX_CROSS_RUN_QUOTE/,
  );

  const cs = await rt.propose({ ...base, ppt: { slides: [{ paragraphs: [{ runs: ['Hello'] }] }] } }, model);
  assert.equal(cs.edits.length, 1);
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

test('runtime: injected AdapterRegistry controls verifier and diff preview without runtime format tables', async () => {
  let verified = 0;
  let previewed = 0;
  class ProbeAdapter extends UniverAdapter {
    override proposalVerifier() {
      return async () => {
        verified++;
        return { ok: true, level: 'simulation' as const, report: 'probe verifier' };
      };
    }
    override async preview(cs: ChangeSet) {
      previewed++;
      return {
        supportByEdit: Object.fromEntries(cs.edits.map((edit) => [edit.id, 'partial' as const])),
        expectedTouchedPartsByEdit: Object.fromEntries(cs.edits.map((edit) => [edit.id, ['probe/control-plane']])),
        unavailableReason: 'probe preview',
      };
    }
  }
  const registry = new AdapterRegistry();
  registry.register({
    format: 'excel', aliases: ['xlsx'], manifest: capabilityManifestFor('excel'),
    create: (hostId) => new ProbeAdapter(hostId),
  });
  const runtime = new OtterPatchRuntime({ adapterRegistry: registry });
  const request: ProposeRequest = {
    hostId: 'h1', format: 'xlsx', intent: 'set A1', baseRev: 0 as DocRev, anchors: [], context: '',
    sheet: { a1: 'Sheet1!A1', values: [[1]], formulas: [[null]], name: 'Sheet1' },
  };
  const cs = await runtime.propose(request, new MockModelClient(() => ({ plan: 'set A1', edits: [{ cell: 'Sheet1!A1', op: 'setValue', value: 2 }] })));
  const diff = await runtime.diff(cs, { format: 'xlsx', sheet: request.sheet });
  assert.equal(verified, 1);
  assert.equal(previewed, 1);
  assert.deepEqual(diff.expectedTouchedParts, ['probe/control-plane']);
  assert.deepEqual(runtime.formats().sort(), ['excel', 'xlsx']);
  assert.deepEqual(runtime.capabilities().formats.map((manifest) => manifest.format), ['excel']);
});

test('runtime: drawio registry adapter produces an observed shadow diff from the board snapshot', async () => {
  const anchor = 'a0' as AnchorId;
  const cs: ChangeSet = {
    id: 'drawio-shadow', hostId: 'h', baseRev: 0 as DocRev, origin: { by: 'human' }, meta: { intent: 'move' },
    anchors: {
      [anchor]: {
        id: anchor, hostId: 'h' as HostId, kind: 'object', ref: null, baseRev: 0 as DocRev,
        portable: { kind: 'object', slide: 0, elementId: 'n1' },
      },
    },
    edits: [{ id: 'e0', target: anchor, op: { family: 'object', kind: 'moveObject', box: { left: 40 } } }],
  };
  const diff = await new OtterPatchRuntime().diff(cs, {
    format: 'drawio',
    board: { nodes: [{ id: 'n1', x: 10, y: 20, width: 30, height: 40 }], edges: [] },
  });
  assert.equal(diff.source, 'shadow');
  assert.equal(diff.previewStatus, 'verified');
  assert.deepEqual(diff.items[0]?.before, {
    kind: 'object', box: { left: 10, top: 20, width: 30, height: 40, rotate: 0 }, props: { id: 'n1', kind: 'node' },
  });
  assert.deepEqual(diff.items[0]?.after, {
    kind: 'object', box: { left: 40, top: 20, width: 30, height: 40, rotate: 0 }, props: { id: 'n1', kind: 'node' },
  });
});

test('runtime: commit rejects stale base revision', async () => {
  const rt = new OtterPatchRuntime();
  const cs = { id: 'c', hostId: 'h', baseRev: 0 as DocRev, anchors: {}, origin: { by: 'human' as const }, meta: { intent: 'x' }, edits: [] };
  await assert.rejects(() => rt.commit({ format: 'excel', bytes: makeXlsx(), changeSet: cs, currentRev: 1 as DocRev }), /stale/);
});

test('runtime: commit fails closed without review and binds receipt to ChangeSet, file, IDs, and one use', async () => {
  const rt = new OtterPatchRuntime({ reviewSecret: 'x'.repeat(32) });
  const bytes = makeXlsx();
  const aid = 'a0' as import('@otterpatch/core').AnchorId;
  const cs: ChangeSet = {
    id: 'reviewed', hostId: 'h', baseRev: 0 as DocRev,
    anchors: { [aid]: { id: aid, hostId: 'h' as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid', sheet: 'Sheet1', a1: 'B1' } } },
    origin: { by: 'human' }, meta: { intent: 'x' },
    edits: [{ id: 'e1', target: aid, op: { family: 'value', kind: 'setValue', value: 1 } }],
  };
  await assert.rejects(() => rt.commit({ format: 'excel', bytes, changeSet: cs, acceptedEditIds: ['e1'] }), /signed proposal and review receipt/);

  const proposal = rt.createProposal(cs, 'excel');
  const reviewed = rt.reviewProposal(proposal, cs, ['e1'], bytes, 'reviewer');
  assert.throws(
    () => rt.reviewProposal(reviewed.proposal, cs, ['e1'], new Uint8Array([1, 2, 3]), 'reviewer'),
    /already bound to a different source file/,
  );
  await assert.rejects(
    () => rt.commit({ format: 'excel', bytes, changeSet: { ...cs, meta: { intent: 'tampered' } }, ...reviewed }),
    /ChangeSet hash mismatch/,
  );
  await assert.rejects(
    () => rt.commit({ format: 'excel', bytes: new Uint8Array([1, 2, 3]), changeSet: cs, ...reviewed }),
    /source file hash mismatch/,
  );
  await assert.rejects(
    () => rt.commit({ format: 'excel', bytes, changeSet: cs, acceptedEditIds: [], ...reviewed }),
    /must not be empty/,
  );
  const result = await rt.commit({ format: 'excel', bytes, changeSet: cs, ...reviewed });
  assert.equal(result.ok, true);
  await assert.rejects(() => rt.commit({ format: 'excel', bytes, changeSet: cs, ...reviewed }), /already been used/);
});

test('runtime: commit rejects invalid acceptedEditIds', async () => {
  const rt = new OtterPatchRuntime({ allowUnreviewedCommit: true });
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

test('runtime: unreviewed destructive edits are blocked by the approval policy', async () => {
  const rt = new OtterPatchRuntime({ allowUnreviewedCommit: true });
  const cs = singleCellChangeSet('destructive', { family: 'value', kind: 'deleteRange' });
  await assert.rejects(
    () => rt.commit({ format: 'excel', bytes: makeXlsx(), changeSet: cs, acceptedEditIds: ['e1'] }),
    /requires human approval/,
  );
});

test('runtime: contextual destructive risk requires a review receipt', async () => {
  const rt = new OtterPatchRuntime({ allowUnreviewedCommit: true, reviewSecret: 'r'.repeat(32) });
  const bytes = makeXlsx();
  const cs = singleCellChangeSet('protected-formula', { family: 'value', kind: 'setFormula', formula: '=1+1' });
  const riskContext = {
    byEdit: {
      e1: {
        destinationOccupied: true,
        beforeState: { formula: '=SUM(A1:A9)' },
        formulaDependencies: ['C1'],
        protectedRegion: true,
      },
    },
  };
  await assert.rejects(
    () => rt.commit({ format: 'excel', bytes, changeSet: cs, acceptedEditIds: ['e1'], riskContext }),
    /requires human approval/,
  );
  await assert.rejects(
    () => rt.commit({ format: 'excel', bytes, changeSet: cs, acceptedEditIds: ['e1'], riskContext, reviewReceipt: {} as never }),
    /must be supplied together/,
  );

  const proposal = rt.createProposal(cs, 'excel');
  const reviewed = rt.reviewProposal(proposal, cs, ['e1'], bytes, 'risk-reviewer');
  const result = await rt.commit({ format: 'excel', bytes, changeSet: cs, riskContext, ...reviewed });
  assert.equal(result.ok, true);
});

test('runtime: serializes same-source commits, verifies output, and isolates event listeners', async () => {
  const rt = new OtterPatchRuntime({ reviewSecret: 'q'.repeat(32) });
  const bytes = new Uint8Array([1, 2, 3]);
  const cs = singleCellChangeSet('serialized');
  let active = 0;
  let maxActive = 0;
  let verified = 0;
  let unexpectedDrift = false;
  const backend: WritebackBackend = {
    id: 'test-backend' as WritebackId,
    strategy: 'native-command',
    canHandle: () => ({ ok: true }),
    supports: () => true,
    commit: async (_changeSet, doc) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return { ok: true, bytes: new Uint8Array([...(doc.bytes ?? []), 4]), touchedParts: ['test'], fidelity: { score: 1, drift: [] }, appliedEditIds: ['e1'] };
    },
    verify: async () => {
      verified++;
      return { score: 1, drift: unexpectedDrift ? [{ part: 'outside-target', kind: 'content', note: 'changed' }] : [] };
    },
  };
  rt.registerWriteback('test', () => backend);
  rt.on(() => { throw new Error('observer failure'); });
  await assert.doesNotReject(() => rt.diff(cs));

  const first = rt.reviewProposal(rt.createProposal(cs, 'test', 'doc-1'), cs, ['e1'], bytes, 'r1');
  const second = rt.reviewProposal(rt.createProposal(cs, 'test', 'doc-1'), cs, ['e1'], bytes, 'r2');
  const results = await Promise.allSettled([
    rt.commit({ format: 'test', bytes, changeSet: cs, ...first }),
    rt.commit({ format: 'test', bytes, changeSet: cs, ...second }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejection = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.match(String(rejection?.reason), /already been committed/);
  assert.equal(maxActive, 1);
  assert.equal(verified, 1);

  unexpectedDrift = true;
  const drifted = rt.reviewProposal(rt.createProposal(cs, 'test', 'doc-2'), cs, ['e1'], bytes, 'r3');
  await assert.rejects(
    () => rt.commit({ format: 'test', bytes, changeSet: cs, ...drifted }),
    /unexpected drift: outside-target/,
  );
  unexpectedDrift = false;
  await assert.rejects(
    () => rt.commit({ format: 'test', bytes, changeSet: cs, ...drifted }),
    /already been used/,
  );
});

test('runtime: serializes different source versions of the same document', async () => {
  const rt = new OtterPatchRuntime({ reviewSecret: 'v'.repeat(32) });
  const cs = singleCellChangeSet('document-lock');
  let active = 0;
  let maxActive = 0;
  const backend: WritebackBackend = {
    id: 'document-lock-backend' as WritebackId,
    strategy: 'native-command',
    canHandle: () => ({ ok: true }),
    supports: () => true,
    commit: async (_changeSet, doc) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return { ok: true, bytes: doc.bytes!, touchedParts: ['test'], fidelity: { score: 1, drift: [] }, appliedEditIds: ['e1'] };
    },
    verify: async () => ({ score: 1, drift: [] }),
  };
  rt.registerWriteback('document-lock-test', () => backend);
  const firstBytes = new Uint8Array([1]);
  const secondBytes = new Uint8Array([2]);
  const first = rt.reviewProposal(rt.createProposal(cs, 'document-lock-test', 'same-doc'), cs, ['e1'], firstBytes, 'r1');
  const second = rt.reviewProposal(rt.createProposal(cs, 'document-lock-test', 'same-doc'), cs, ['e1'], secondBytes, 'r2');

  const results = await Promise.all([
    rt.commit({ format: 'document-lock-test', bytes: firstBytes, changeSet: cs, ...first }),
    rt.commit({ format: 'document-lock-test', bytes: secondBytes, changeSet: cs, ...second }),
  ]);
  assert.equal(results.length, 2);
  assert.equal(maxActive, 1);
});

test('runtime: falls back when the primary backend cannot handle the reviewed change', async () => {
  const rt = new OtterPatchRuntime({ reviewSecret: 'f'.repeat(32) });
  const cs = singleCellChangeSet('fallback');
  const bytes = new Uint8Array([7]);
  let fallbackVerified = false;
  const unavailable: WritebackBackend = {
    id: 'primary' as WritebackId, strategy: 'surgical-ooxml', supports: () => false,
    canHandle: () => ({ ok: false, reason: 'unsupported in primary' }),
    commit: async () => { throw new Error('must not run'); }, verify: async () => { throw new Error('must not run'); },
  };
  const fallback: WritebackBackend = {
    id: 'fallback' as WritebackId, strategy: 'native-command', supports: () => true, canHandle: () => ({ ok: true }),
    commit: async () => ({ ok: true, bytes: new Uint8Array([8]), touchedParts: ['test'], fidelity: { score: 1, drift: [] }, appliedEditIds: ['e1'] }),
    verify: async () => { fallbackVerified = true; return { score: 1, drift: [] }; },
  };
  rt.registerWriteback('fallback-test', () => unavailable);
  rt.registerWritebackFallback('fallback-test', () => fallback);
  const reviewed = rt.reviewProposal(rt.createProposal(cs, 'fallback-test', 'doc'), cs, ['e1'], bytes, 'reviewer');
  const result = await rt.commit({ format: 'fallback-test', bytes, changeSet: cs, ...reviewed });
  assert.equal(result.ok, true);
  assert.equal(result.fallbackUsed, 'native-command');
  assert.equal(fallbackVerified, true);
});

test('runtime: never cascades to a fallback after backend execution starts', async () => {
  const rt = new OtterPatchRuntime({ reviewSecret: 'x'.repeat(32) });
  const cs = singleCellChangeSet('partial-failure');
  const bytes = new Uint8Array([7]);
  let mode: 'throw' | 'partial' = 'throw';
  let fallbackCalls = 0;
  const primary: WritebackBackend = {
    id: 'side-effecting-primary' as WritebackId,
    strategy: 'native-command',
    supports: () => true,
    canHandle: () => ({ ok: true }),
    commit: async () => {
      if (mode === 'throw') throw new Error('partial side effect');
      return {
        ok: false,
        bytes: new Uint8Array([8]),
        touchedParts: ['partially-updated'],
        fidelity: { score: 1, drift: [] },
        appliedEditIds: [],
        droppedEdits: [{ editId: 'e1', reason: 'native host rejected the edit' }],
      };
    },
    verify: async () => ({ score: 1, drift: [] }),
  };
  const fallback: WritebackBackend = {
    id: 'must-not-replay' as WritebackId,
    strategy: 'model-roundtrip',
    supports: () => true,
    canHandle: () => ({ ok: true }),
    commit: async () => {
      fallbackCalls++;
      return { ok: true, bytes: new Uint8Array([9]), touchedParts: ['fallback'], fidelity: { score: 1, drift: [] } };
    },
    verify: async () => ({ score: 1, drift: [] }),
  };
  rt.registerWriteback('partial-failure-test', () => primary);
  rt.registerWritebackFallback('partial-failure-test', () => fallback);

  const failedReview = rt.reviewProposal(
    rt.createProposal(cs, 'partial-failure-test', 'throwing-doc'), cs, ['e1'], bytes, 'reviewer',
  );
  await assert.rejects(
    () => rt.commit({ format: 'partial-failure-test', bytes, changeSet: cs, ...failedReview }),
    /side-effecting-primary failed after execution started: partial side effect/,
  );
  assert.equal(fallbackCalls, 0);

  mode = 'partial';
  const partialReview = rt.reviewProposal(
    rt.createProposal(cs, 'partial-failure-test', 'partial-doc'), cs, ['e1'], bytes, 'reviewer',
  );
  const partial = await rt.commit({ format: 'partial-failure-test', bytes, changeSet: cs, ...partialReview });
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.touchedParts, ['partially-updated']);
  assert.equal(partial.fallbackUsed, undefined);
  assert.equal(fallbackCalls, 0);
});

test('runtime rejects verification metrics that report an invalid package', async () => {
  const rt = new OtterPatchRuntime({ reviewSecret: 'p'.repeat(32) });
  const cs = singleCellChangeSet('invalid-package');
  const bytes = new Uint8Array([7]);
  const backend: WritebackBackend = {
    id: 'invalid-package-backend' as WritebackId,
    strategy: 'native-command',
    supports: () => true,
    canHandle: () => ({ ok: true }),
    commit: async () => ({ ok: true, bytes: new Uint8Array([8]), touchedParts: ['test'], fidelity: { score: 1, drift: [] }, appliedEditIds: ['e1'] }),
    verify: async () => ({
      score: 1,
      drift: [],
      verification: {
        packageValid: false,
        locality: { intendedParts: ['test'], unexpectedParts: [], unchangedPartRatio: 1 },
        semantic: { verifiedEdits: ['e1'], unverifiableEdits: [], failedEdits: [] },
        compatibility: { warnings: [] },
      },
    }),
  };
  rt.registerWriteback('invalid-package-test', () => backend);
  const reviewed = rt.reviewProposal(rt.createProposal(cs, 'invalid-package-test', 'doc'), cs, ['e1'], bytes, 'reviewer');
  await assert.rejects(
    () => rt.commit({ format: 'invalid-package-test', bytes, changeSet: cs, ...reviewed }),
    /invalid output package/,
  );
});

test('runtime: proposal signing rejects non-JSON numeric values', () => {
  const rt = new OtterPatchRuntime();
  const aid = 'a0' as import('@otterpatch/core').AnchorId;
  const cs: ChangeSet = {
    id: 'bad-number', hostId: 'h', baseRev: 0 as DocRev,
    anchors: { [aid]: { id: aid, hostId: 'h' as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev, portable: { kind: 'grid', sheet: 'Sheet1', a1: 'A1' } } },
    origin: { by: 'human' }, meta: { intent: 'x' },
    edits: [{ id: 'e1', target: aid, op: { family: 'value', kind: 'setValue', value: Number.NaN } }],
  };
  assert.throws(() => rt.createProposal(cs, 'excel'), /non-finite/);
});

test('runtime: built-in capability gate rejects proposals that cannot be written back', () => {
  const rt = new OtterPatchRuntime();
  const cs = singleCellChangeSet('unsupported-capability');
  const unsupported: ChangeSet = {
    ...cs,
    edits: [{ ...cs.edits[0]!, op: { family: 'structure', kind: 'insertRows', count: 1, before: true } }],
  };
  assert.throws(() => rt.createProposal(unsupported, 'excel'), /does not allow propose for op insertRows/);
  assert.equal(rt.capabilities().version, 'capabilities-v1');
});

test('runtime: caps concurrent model requests per runtime session', async () => {
  const rt = new OtterPatchRuntime({ maxConcurrentModelRequests: 1 });
  let unblock!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  const model: ModelClient = {
    proposeChangeSet: async () => singleCellChangeSet('unused'),
    respond: async () => {
      started();
      await blocked;
      return { kind: 'answer', text: 'done' };
    },
  };
  const request: ProposeRequest = { hostId: 'h', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' };
  const first = rt.respond(request, model);
  await startedPromise;
  await assert.rejects(() => rt.respond(request, model), /concurrent_model_requests/);
  unblock();
  assert.deepEqual(await first, { kind: 'answer', text: 'done' });
});

test('runtime: propagates cancellation and releases the model concurrency slot', async () => {
  const rt = new OtterPatchRuntime({ maxConcurrentModelRequests: 1 });
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const model: ModelClient = {
    proposeChangeSet: async () => singleCellChangeSet('unused'),
    respond: async (_req, _dialect, opts) => {
      observedSignal = opts?.signal;
      return new Promise<AgentResponse>((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    },
  };
  const request: ProposeRequest = { hostId: 'h', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' };
  const pending = rt.respond(request, model, { signal: controller.signal });
  controller.abort();

  await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(observedSignal, controller.signal);

  const next: ModelClient = {
    proposeChangeSet: async () => singleCellChangeSet('unused-next'),
    respond: async () => ({ kind: 'answer', text: 'slot released' }),
  };
  assert.deepEqual(await rt.respond(request, next), { kind: 'answer', text: 'slot released' });
});
