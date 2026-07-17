import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDrawioMutations, type DrawioMutationBoard } from './drawio-proposal-adapter.js';
import type { BoardObject } from './proposal-materializers.js';

const node = (id: string, overrides: Partial<NonNullable<BoardObject['node']>> = {}): BoardObject => ({
  node: { id, x: 10, y: 20, w: 100, h: 40, inner: '<rect/>', label: 'Old', ...overrides },
});

test('applyDrawioMutations applies supported operations and captures review snapshots', () => {
  const objects = new Map<string, BoardObject>([
    ['props-node', node('props-node')],
    ['move-node', node('move-node', { x: 0, y: 0 })],
    ['delete-edge', { edge: { id: 'delete-edge', from: 'a', to: 'b', arrow: 'classic', style: 'ortho' } }],
  ]);
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const board: DrawioMutationBoard = {
    getObject: (id) => objects.get(id) ?? null,
    updateObject: (...args) => { calls.push({ method: 'updateObject', args }); },
    removeObjects: (...args) => { calls.push({ method: 'removeObjects', args }); },
    moveObject: (...args) => { calls.push({ method: 'moveObject', args }); },
  };
  const changeSet = {
    anchors: {
      props: { portable: { elementId: 'props-node' } },
      move: { portable: { elementId: 'move-node' } },
      remove: { portable: { elementId: 'delete-edge' } },
      missing: { portable: {} },
    },
    edits: [
      { id: 'ignored', target: 'props', op: { kind: 'addObject' } },
      { id: 'props-edit', target: 'props', op: { kind: 'setObjectProps', props: { value: 'New', style: 'fillColor=#fff;strokeColor=#111;fontStyle=1;' } } },
      { id: 'move-edit', target: 'move', op: { kind: 'moveObject', box: { left: 13, top: 27, width: 120, height: 55 } } },
      { id: 'delete-edit', target: 'remove', op: { kind: 'deleteObject' } },
      { id: 'missing-anchor', target: 'missing', op: { kind: 'deleteObject' } },
    ],
  };

  const result = applyDrawioMutations(changeSet, board);

  assert.deepEqual(calls, [
    { method: 'updateObject', args: ['props-node', { value: 'New', style: 'fillColor=#fff;strokeColor=#111;fontStyle=1;' }] },
    { method: 'moveObject', args: ['move-node', { x: 13, y: 27, w: 120, h: 55 }] },
    { method: 'removeObjects', args: [['delete-edge']] },
  ]);
  assert.deepEqual(result.byEdit, {
    'props-edit': 'props-node',
    'move-edit': 'move-node',
    'delete-edit': 'delete-edge',
  });
  assert.deepEqual(result.muts['props-edit']?.prior, objects.get('props-node'));
  assert.deepEqual(result.muts['props-edit']?.next?.node, {
    ...objects.get('props-node')?.node,
    label: 'New',
    fill: '#fff',
    stroke: '#111',
    bold: true,
  });
  assert.deepEqual(result.muts['move-edit']?.next?.node, {
    ...objects.get('move-node')?.node,
    x: 10,
    y: 30,
    w: 120,
    h: 55,
  });
  assert.deepEqual(result.muts['delete-edit'], {
    prior: objects.get('delete-edge'),
    next: null,
  });
});

test('applyDrawioMutations keeps edit mapping when the board is not mounted', () => {
  const result = applyDrawioMutations({
    anchors: { target: { portable: { elementId: 'node-1' } } },
    edits: [{ id: 'edit-1', target: 'target', op: { kind: 'moveObject', box: { left: 10 } } }],
  }, null);

  assert.deepEqual(result, { byEdit: { 'edit-1': 'node-1' }, muts: {} });
  assert.deepEqual(applyDrawioMutations(null, null), { byEdit: {}, muts: {} });
});
