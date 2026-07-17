import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyBoardPatchView,
  revertBoardPatch,
  setBoardEditState,
  type DrawioReviewBoard,
} from './drawio-review-adapter.js';
import type { BoardObject, BoardPatch } from './proposal-materializers.js';

const oldNode: BoardObject = {
  node: { id: 'changed', x: 10, y: 20, w: 100, h: 40, inner: '<rect/>', label: 'Old' },
};
const newNode: BoardObject = {
  node: { id: 'changed', x: 30, y: 40, w: 100, h: 40, inner: '<rect/>', label: 'New' },
};
const deletedEdge: BoardObject = {
  edge: { id: 'deleted', from: 'a', to: 'b', arrow: 'classic', style: 'ortho' },
};
const addedNode = {
  editId: 'add-edit',
  node: { id: 'added', x: 50, y: 60, w: 80, h: 30, inner: '<ellipse/>', label: 'Added' },
} satisfies BoardPatch['objs'][number];
const addedObject: BoardObject = { node: addedNode.node };
const patch: BoardPatch = {
  byEdit: {
    'add-edit': 'added',
    'change-edit': 'changed',
    'delete-edit': 'deleted',
    'orphan-edit': 'user-object',
  },
  objs: [addedNode],
  muts: {
    'change-edit': { prior: oldNode, next: newNode },
    'delete-edit': { prior: deletedEdge, next: null },
  },
};

type Call =
  | { method: 'remove'; ids: string[] }
  | { method: 'restore'; object: BoardObject };

function fakeBoard(): { board: DrawioReviewBoard; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    board: {
      removeObjects: (ids) => { calls.push({ method: 'remove', ids }); },
      restoreObject: (object) => { calls.push({ method: 'restore', object }); },
    },
  };
}

test('setBoardEditState projects additions, mutations, and deletions to next state', () => {
  const { board, calls } = fakeBoard();

  setBoardEditState(patch, 'add-edit', 'next', board);
  setBoardEditState(patch, 'change-edit', 'next', board);
  setBoardEditState(patch, 'delete-edit', 'next', board);
  setBoardEditState(patch, 'orphan-edit', 'next', board);
  setBoardEditState(patch, 'unknown-edit', 'next', board);

  assert.deepEqual(calls, [
    { method: 'restore', object: addedObject },
    { method: 'restore', object: newNode },
    { method: 'remove', ids: ['deleted'] },
  ]);
});

test('setBoardEditState restores prior state for additions, mutations, and deletions', () => {
  const { board, calls } = fakeBoard();

  setBoardEditState(patch, 'add-edit', 'prior', board);
  setBoardEditState(patch, 'change-edit', 'prior', board);
  setBoardEditState(patch, 'delete-edit', 'prior', board);
  setBoardEditState(patch, 'orphan-edit', 'prior', board);

  assert.deepEqual(calls, [
    { method: 'remove', ids: ['added'] },
    { method: 'restore', object: oldNode },
    { method: 'restore', object: deletedEdge },
  ]);
});

test('applyBoardPatchView combines view and acceptance state for every diff item', () => {
  const { board, calls } = fakeBoard();

  applyBoardPatchView(patch, {
    editIds: ['add-edit', 'change-edit', 'delete-edit', 'orphan-edit'],
    view: 'final',
    isAccepted: (editId) => editId !== 'change-edit',
    board,
  });

  assert.deepEqual(calls, [
    { method: 'restore', object: addedObject },
    { method: 'restore', object: oldNode },
    { method: 'remove', ids: ['deleted'] },
  ]);
});

test('revertBoardPatch removes all additions before restoring mutation snapshots', () => {
  const { board, calls } = fakeBoard();

  revertBoardPatch(patch, board);
  revertBoardPatch(patch, null);

  assert.deepEqual(calls, [
    { method: 'remove', ids: ['added'] },
    { method: 'restore', object: oldNode },
    { method: 'restore', object: deletedEdge },
  ]);
});
