import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from '@otterpatch/core';
import { DrawioSurgicalWriteback } from './writeback.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();

const D0 =
  '<diagram id="d0" name="P1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="2" value="旧" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram>';
const D1 =
  '<diagram id="d1" name="P2"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="9" value="不动" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram>';
const FILE = `<mxfile host="app">${D0}${D1}</mxfile>`;

function anchor(id: string, slide: number, elementId: string): LogicalAnchor {
  return {
    id: id as AnchorId,
    hostId: 'h1' as HostId,
    kind: 'object',
    ref: null,
    baseRev: 0 as DocRev,
    portable: { kind: 'object', slide, elementId },
  };
}

test('drawio 写回:只改目标 diagram 的目标 cell,另一 diagram 字节级不变', async () => {
  const cs: ChangeSet = {
    id: 'cs1',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: { a0: anchor('a0', 0, '2') } as Record<AnchorId, LogicalAnchor>,
    origin: { by: 'agent', sessionId: 't' },
    meta: { intent: '改 d0 的 cell 2' },
    edits: [{ id: 'e0', target: 'a0' as AnchorId, op: { family: 'object', kind: 'setObjectProps', props: { value: '新' } } }],
  };
  const res = await new DrawioSurgicalWriteback().commit(cs, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(res.touchedParts, ['d0']);
  assert.equal(res.fidelity.score, 1);
  assert.deepEqual(res.fidelity.verification?.locality, {
    intendedParts: ['d0'],
    unexpectedParts: [],
    unchangedPartRatio: 1,
  });
  assert.equal(res.fidelity.verification?.packageValid, true);
  assert.deepEqual(res.fidelity.verification?.semantic.verifiedEdits, ['e0']);
  const out = dec.decode(res.bytes);
  assert.match(out, /id="2"[^>]*value="新"/);
  // d1 must be byte-for-byte untouched
  assert.ok(out.includes(D1), 'd1 应字节级不变');
});

test('drawio 写回:add + delete 跨两个 diagram', async () => {
  const cs: ChangeSet = {
    id: 'cs2',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: { a0: anchor('a0', 0, '1'), a1: anchor('a1', 1, '9') } as Record<AnchorId, LogicalAnchor>,
    origin: { by: 'agent', sessionId: 't' },
    meta: { intent: 'add+delete' },
    edits: [
      { id: 'e0', target: 'a0' as AnchorId, op: { family: 'object', kind: 'addObject', payload: { id: 'n1', value: '新节点', vertex: true, parent: '1', geometry: { x: 10, y: 10, width: 80, height: 40 } } } },
      { id: 'e1', target: 'a1' as AnchorId, op: { family: 'object', kind: 'deleteObject' } },
    ],
  };
  const res = await new DrawioSurgicalWriteback().commit(cs, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev });
  const out = dec.decode(res.bytes);

  assert.deepEqual(res.touchedParts.sort(), ['d0', 'd1']);
  assert.match(out, /id="n1"[^>]*value="新节点"/);
  assert.match(out, /id="n1"[^>]*parent="1"/);
  assert.doesNotMatch(out, /id="9"/); // the cell in d1 is deleted
});

test('drawio writeback: out-of-range diagram reports dropped edit', async () => {
  const cs: ChangeSet = {
    id: 'cs-out-of-range',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: { a0: anchor('a0', 99, '2') } as Record<AnchorId, LogicalAnchor>,
    origin: { by: 'agent', sessionId: 't' },
    meta: { intent: 'bad page' },
    edits: [{ id: 'e0', target: 'a0' as AnchorId, op: { family: 'object', kind: 'setObjectProps', props: { value: 'x' } } }],
  };
  const res = await new DrawioSurgicalWriteback().commit(cs, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedEditIds, []);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /out of range/);
});

test('drawio writeback: deleting a missing id is dropped, not applied', async () => {
  const cs: ChangeSet = {
    id: 'cs-missing-delete',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: { a0: anchor('a0', 0, 'missing') } as Record<AnchorId, LogicalAnchor>,
    origin: { by: 'agent', sessionId: 't' },
    meta: { intent: 'delete missing object' },
    edits: [{ id: 'e0', target: 'a0' as AnchorId, op: { family: 'object', kind: 'deleteObject' } }],
  };
  const res = await new DrawioSurgicalWriteback().commit(cs, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedEditIds, []);
  assert.deepEqual(res.touchedParts, []);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /cell "missing" not found/);
  assert.equal(dec.decode(res.bytes), FILE);
  assert.equal(res.fidelity.score, 1, 'locality remains perfect when no diagram changed');
  assert.deepEqual(res.fidelity.verification?.semantic.failedEdits.map((failure) => failure.editId), ['e0']);
});

test('drawio fidelity separates locality, package validity, and semantic verification', async () => {
  const cs: ChangeSet = {
    id: 'cs-fidelity',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: { a0: anchor('a0', 0, '2') } as Record<AnchorId, LogicalAnchor>,
    origin: { by: 'agent', sessionId: 't' },
    meta: { intent: 'change one node' },
    edits: [{ id: 'e0', target: 'a0' as AnchorId, op: { family: 'object', kind: 'setObjectProps', props: { value: 'new' } } }],
  };
  const writer = new DrawioSurgicalWriteback();
  const oneDiagram = `<mxfile host="app">${D0}</mxfile>`;
  const oneResult = await writer.commit(cs, { hostId: 'h1', bytes: enc(oneDiagram), rev: 0 as DocRev });
  assert.equal(oneResult.fidelity.score, 1, 'an intended change to the only diagram must not reduce locality');
  assert.equal(oneResult.fidelity.verification?.packageValid, true);
  assert.deepEqual(oneResult.fidelity.verification?.semantic.verifiedEdits, ['e0']);

  const result = await writer.commit(cs, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev });
  const verified = await writer.verify(
    { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev },
    { hostId: 'h1', bytes: result.bytes, rev: 1 as DocRev },
    cs,
  );
  assert.equal(verified.score, 1);
  assert.deepEqual(verified.verification?.semantic.verifiedEdits, ['e0']);

  const unexpectedXml = dec.decode(result.bytes).replace('value="不动"', 'value="unexpected"');
  const unexpected = await writer.verify(
    { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev },
    { hostId: 'h1', bytes: enc(unexpectedXml), rev: 1 as DocRev },
    cs,
  );
  assert.equal(unexpected.score, 0);
  assert.deepEqual(unexpected.verification?.locality.unexpectedParts, ['d1']);
  assert.deepEqual(unexpected.verification?.semantic.verifiedEdits, ['e0']);

  const malformed = await writer.verify(
    { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev },
    { hostId: 'h1', bytes: enc(dec.decode(result.bytes).replace('</mxfile>', '')), rev: 1 as DocRev },
    cs,
  );
  assert.equal(malformed.verification?.packageValid, false);

  const entityDocument = '<!DOCTYPE mxfile [<!ENTITY x "value">]><mxfile><diagram id="d"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>';
  const unsafe = await writer.verify(
    { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev },
    { hostId: 'h1', bytes: enc(entityDocument), rev: 1 as DocRev },
    cs,
  );
  assert.equal(unsafe.verification?.packageValid, false);
});

test('drawio writeback: validates ChangeSets at the commit boundary', async () => {
  const base = {
    id: 'cs-unsafe',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: { a0: anchor('a0', 0, '2'), a1: anchor('a1', 0, '1') } as Record<AnchorId, LogicalAnchor>,
    origin: { by: 'agent' as const, sessionId: 't' },
    meta: { intent: 'unsafe' },
  };
  for (const name of ['id', 'parent', 'source', 'target']) {
    const cs = {
      ...base,
      edits: [
        { id: 'e0', target: 'a0' as AnchorId, op: { family: 'object', kind: 'setObjectProps', props: { [name]: 'replacement' } } },
      ],
    } as unknown as ChangeSet;
    assert.equal(new DrawioSurgicalWriteback().canHandle(cs).ok, false);
    await assert.rejects(
      () => new DrawioSurgicalWriteback().commit(cs, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev }),
      new RegExp(`unsupported fields: ${name}`),
    );
  }

  const invalidGeometry = {
    ...base,
    edits: [
      { id: 'e1', target: 'a1' as AnchorId, op: { family: 'object', kind: 'addObject', payload: { id: 'n1', vertex: true, parent: '1', geometry: { x: Number.NaN } } } },
    ],
  } as unknown as ChangeSet;
  await assert.rejects(
    () => new DrawioSurgicalWriteback().commit(invalidGeometry, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev }),
    /must be finite/,
  );
});

test('drawio writeback: invalid add topology is dropped without changing the diagram', async () => {
  const cases = [
    { payload: { id: '2', vertex: true, parent: '1' }, error: /duplicate cell id/ },
    { payload: { id: 'n1', vertex: true, parent: 'ghost' }, error: /parent "ghost".*not found/ },
    { payload: { id: 'e2', edge: true, parent: '1', source: 'ghost', target: '2' }, error: /source "ghost".*not found/ },
    { payload: { id: 'e2', edge: true, parent: '1', source: '2', target: 'ghost' }, error: /target "ghost".*not found/ },
    { payload: { id: 'n1', vertex: true, parent: 'n1' }, error: /references itself/ },
    { payload: { id: 'e2', edge: true, parent: '1', source: 'e2', target: '2' }, error: /references itself/ },
    { payload: { id: 'e2', edge: true, parent: '1', source: '2', target: 'e2' }, error: /references itself/ },
    { payload: { id: 'e2', edge: true, parent: '1', source: '2', target: '2' }, error: /source and target must differ/ },
  ];
  for (const [index, { payload, error }] of cases.entries()) {
    const cs: ChangeSet = {
      id: `cs-bad-add-${index}`,
      hostId: 'h1',
      baseRev: 0 as DocRev,
      anchors: { a0: anchor('a0', 0, '1') } as Record<AnchorId, LogicalAnchor>,
      origin: { by: 'agent', sessionId: 't' },
      meta: { intent: 'invalid add' },
      edits: [{ id: 'e0', target: 'a0' as AnchorId, op: { family: 'object', kind: 'addObject', payload } }],
    };
    const res = await new DrawioSurgicalWriteback().commit(cs, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev });
    assert.equal(res.ok, false);
    assert.deepEqual(res.appliedEditIds, []);
    assert.equal(dec.decode(res.bytes), FILE);
    assert.match(res.droppedEdits?.[0]?.reason ?? '', error);
  }

  const cycle: ChangeSet = {
    id: 'cs-cycle',
    hostId: 'h1',
    baseRev: 0 as DocRev,
    anchors: { a0: anchor('a0', 0, '1'), a1: anchor('a1', 0, '1') } as Record<AnchorId, LogicalAnchor>,
    origin: { by: 'agent', sessionId: 't' },
    meta: { intent: 'cycle' },
    edits: [
      { id: 'e0', target: 'a0' as AnchorId, op: { family: 'object', kind: 'addObject', payload: { id: 'n1', vertex: true, parent: 'n2' } } },
      { id: 'e1', target: 'a1' as AnchorId, op: { family: 'object', kind: 'addObject', payload: { id: 'n2', vertex: true, parent: 'n1' } } },
    ],
  };
  const res = await new DrawioSurgicalWriteback().commit(cycle, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.equal(dec.decode(res.bytes), FILE);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /parent cycle/);
});
