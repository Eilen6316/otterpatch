/**
 * End-to-end: natural-language intent → drawio ChangeSet (mock model, drawio dialect) → diagram-level surgical writeback.
 * Proves the upstream Agent (dispatching by format) and the downstream drawio writeback connect into one pipeline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocRev } from '@otterpatch/core';
import { Agent, MockModelClient } from './index.js';
import { DrawioSurgicalWriteback } from '@otterpatch/adapter-drawio';

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

test('drawio 意图 → ChangeSet(Mock,drawio 方言)→ 外科写回:改节点 + 加节点,另一页不变', async () => {
  const agent = new Agent(
    new MockModelClient(() => ({
      plan: '改节点2文字并加一个节点',
      ops: [
        { op: 'update', cellId: '2', page: 0, value: '新' },
        { op: 'add', cellId: 'n1', page: 0, value: 'C', vertex: true, parent: '1', x: 200, y: 40, width: 120, height: 60 },
      ],
    })),
  );
  const cs = await agent.propose({
    hostId: 'h1',
    format: 'drawio',
    intent: '把节点2改成"新",再加一个节点 C',
    baseRev: 0 as DocRev,
    anchors: [],
    context: 'node2=旧',
  });
  assert.equal(cs.edits.length, 2);

  const res = await new DrawioSurgicalWriteback().commit(cs, { hostId: 'h1', bytes: enc(FILE), rev: 0 as DocRev });
  const out = dec.decode(res.bytes);

  assert.deepEqual(res.touchedParts, ['d0']);
  assert.match(out, /id="2"[^>]*value="新"/);
  assert.match(out, /id="n1"[^>]*value="C"/);
  assert.ok(out.includes(D1), 'd1 应字节级不变');
});
