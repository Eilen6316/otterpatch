import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnchorId, ChangeSet, DocRev, HostId } from '@otterpatch/core';
import { DrawioAdapter } from './index.js';

function moveChangeSet(): ChangeSet {
  const anchor = 'a0' as AnchorId;
  return {
    id: 'drawio-adapter', hostId: 'host', baseRev: 0 as DocRev, origin: { by: 'human' }, meta: { intent: 'move node' },
    anchors: {
      [anchor]: {
        id: anchor, hostId: 'host' as HostId, kind: 'object', ref: null, baseRev: 0 as DocRev,
        portable: { kind: 'object', slide: 0, elementId: 'n1' },
      },
    },
    edits: [{ id: 'e0', target: anchor, op: { family: 'object', kind: 'moveObject', box: { left: 50, top: 60 } } }],
  };
}

test('DrawioAdapter replaces TODO stubs with topology validation and a structured shadow diff', async () => {
  const adapter = new DrawioAdapter('host');
  const cs = moveChangeSet();
  const board = { nodes: [{ id: 'n1', x: 10, y: 20, width: 30, height: 40 }], edges: [] };
  assert.equal(adapter.manifest().format, 'drawio');
  assert.equal(adapter.capabilities().features.shadowApply, true);
  assert.equal(adapter.validate(cs, 'propose').ok, true);
  assert.ok(adapter.proposalVerifier({ snapshot: { board } }));
  const preview = await adapter.preview(cs, { snapshot: { board } });
  assert.equal(preview.supportByEdit.e0, 'verified');
  assert.deepEqual(preview.shadow?.diff.root.children[0]?.before, {
    kind: 'object', box: { left: 10, top: 20, width: 30, height: 40, rotate: 0 }, props: { id: 'n1', kind: 'node' },
  });
  assert.deepEqual(preview.shadow?.diff.root.children[0]?.after, {
    kind: 'object', box: { left: 50, top: 60, width: 30, height: 40, rotate: 0 }, props: { id: 'n1', kind: 'node' },
  });
  assert.deepEqual(preview.expectedTouchedPartsByEdit.e0, ['drawio/diagram[0]']);
  assert.equal(adapter.writebacks().length, 1);
  assert.equal('anchors' in adapter, false);
});
