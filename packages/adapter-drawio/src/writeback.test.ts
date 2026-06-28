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
  const out = dec.decode(res.bytes);
  assert.match(out, /id="2"[^>]*value="新"/);
  // d1 原封不动(字节级)
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
      { id: 'e0', target: 'a0' as AnchorId, op: { family: 'object', kind: 'addObject', payload: { id: 'n1', value: '新节点', vertex: true, geometry: { x: 10, y: 10, width: 80, height: 40 } } } },
      { id: 'e1', target: 'a1' as AnchorId, op: { family: 'object', kind: 'deleteObject' } },
    ],
  };
  const res = await new DrawioSurgicalWriteback().commit(cs, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev });
  const out = dec.decode(res.bytes);

  assert.deepEqual(res.touchedParts.sort(), ['d0', 'd1']);
  assert.match(out, /id="n1"[^>]*value="新节点"/); // 加在 d0,parent 取锚点 cell '1'
  assert.match(out, /id="n1"[^>]*parent="1"/);
  assert.doesNotMatch(out, /id="9"/); // d1 的节点被删
});
