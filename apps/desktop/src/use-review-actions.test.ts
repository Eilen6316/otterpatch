import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffTurn } from './app-thread-types.js';
import type { DrawioReviewBoard } from './drawio-review-adapter.js';
import type { BoardObject } from './proposal-materializers.js';
import { useReviewActions } from './use-review-actions.js';

test('acceptAll reapplies a previously rejected Drawio mutation', async () => {
  const prior: BoardObject = {
    node: { id: 'node-1', x: 10, y: 20, w: 100, h: 40, inner: '<rect/>', label: 'Before' },
  };
  const next: BoardObject = {
    node: { id: 'node-1', x: 30, y: 40, w: 100, h: 40, inner: '<rect/>', label: 'After' },
  };
  const restored: BoardObject[] = [];
  const board: DrawioReviewBoard = {
    removeObjects: () => { assert.fail('move mutation should not remove an object'); },
    restoreObject: (object) => { restored.push(object); },
  };
  const turn: DiffTurn = {
    role: 'assistant',
    kind: 'diff',
    format: 'drawio',
    diff: {
      changeSetId: 'cs-1',
      hostId: 'drawio',
      intent: 'move one node',
      items: [{ editId: 'move-edit', ref: 'node-1', badge: 'move', label: 'Move node' }],
    },
    ops: [],
    board: {
      byEdit: { 'move-edit': 'node-1' },
      objs: [],
      muts: { 'move-edit': { prior, next } },
    },
  };
  const acceptedKeys: string[][] = [];
  const committed: Array<{ index: number; count: number }> = [];

  const { acceptAll } = useReviewActions({
    format: 'drawio',
    accepted: new Set(),
    autoBatch: false,
    autoBatchRun: { current: 0 },
    excelDiff: 'final',
    fileBase64: '',
    wordRef: { current: null },
    univerRef: { current: null },
    boardRef: { current: board },
    notify: () => {},
    t: (key) => key,
    acceptMany: (keys) => { acceptedKeys.push(keys); },
    setReviewIdx: () => {},
    setExcelDiff: () => {},
    ensureCommitFile: () => true,
    doCommit: async () => { assert.fail('commit should not run without an imported file'); },
    markCommitted: (index, count) => { committed.push({ index, count }); },
    applyGridOp: () => {},
    applyWordEdit: () => {},
    realBg: () => null,
    telemetry: () => {},
    send: () => {},
  });

  await acceptAll(turn, 4);

  assert.deepEqual(restored, [next]);
  assert.deepEqual(acceptedKeys, [['cs-1::move-edit']]);
  assert.deepEqual(committed, [{ index: 4, count: 1 }]);
});
