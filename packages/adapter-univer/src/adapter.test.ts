import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnchorId, ChangeSet, DocRev, HostId } from '@otterpatch/core';
import { UniverAdapter } from './index.js';

function changeSet(): ChangeSet {
  const anchor = 'a0' as AnchorId;
  return {
    id: 'excel-adapter', hostId: 'host', baseRev: 0 as DocRev, origin: { by: 'human' }, meta: { intent: 'set A1' },
    anchors: {
      [anchor]: {
        id: anchor, hostId: 'host' as HostId, kind: 'grid', ref: null, baseRev: 0 as DocRev,
        portable: { kind: 'grid', sheet: 'Sheet1', a1: 'A1' },
      },
    },
    edits: [{ id: 'e0', target: anchor, op: { family: 'value', kind: 'setValue', value: 9 } }],
  };
}

test('UniverAdapter exposes a real manifest, validator, verifier, preview engine, and writeback candidate', async () => {
  const adapter = new UniverAdapter('host');
  const cs = changeSet();
  const sheet = { a1: 'Sheet1!A1', name: 'Sheet1', values: [[1]], formulas: [[null]] };
  assert.equal(adapter.manifest().format, 'excel');
  assert.equal(adapter.capabilities().features.shadowApply, true);
  assert.equal(adapter.validate(cs, 'propose').ok, true);
  assert.ok(adapter.proposalVerifier({ snapshot: { sheet } }));
  const preview = await adapter.preview(cs, { snapshot: { sheet } });
  assert.equal(preview.supportByEdit.e0, 'verified');
  assert.deepEqual(preview.shadow?.diff.root.children[0]?.before, { kind: 'cell', value: 1 });
  assert.deepEqual(preview.shadow?.diff.root.children[0]?.after, { kind: 'cell', value: 9 });
  assert.equal(adapter.writebacks().length, 1);
  assert.equal('anchors' in adapter, false, 'headless adapter must not advertise a throwing live-anchor stub');
});
