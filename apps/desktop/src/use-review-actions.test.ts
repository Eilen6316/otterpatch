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
    rejected: new Set(['cs-1::move-edit']),
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
    applyWordEdit: () => {},
    telemetry: () => {},
    confirmAcceptAll: () => true,
    send: () => {},
  });

  await acceptAll(turn, 4);

  assert.deepEqual(restored, [next]);
  assert.deepEqual(acceptedKeys, [['cs-1::move-edit']]);
  assert.deepEqual(committed, [{ index: 4, count: 1 }]);
});

test('acceptAll does not replay an unreviewed preview and stops when confirmation is declined', async () => {
  const turn: DiffTurn = {
    role: 'assistant', kind: 'diff', format: 'drawio',
    diff: { changeSetId: 'cs-2', hostId: 'drawio', intent: 'preview', items: [{ editId: 'e1', ref: 'n1', badge: 'move', label: 'move' }] },
    ops: [],
    board: { byEdit: { e1: 'n1' }, objs: [], muts: { e1: { prior: {}, next: {} } } },
  };
  let restored = 0;
  let accepted = 0;
  const options = {
    format: 'drawio' as const,
    accepted: new Set<string>(),
    rejected: new Set<string>(),
    autoBatch: false,
    autoBatchRun: { current: 0 },
    excelDiff: 'final' as const,
    fileBase64: '',
    wordRef: { current: null },
    univerRef: { current: null },
    boardRef: { current: { removeObjects: () => {}, restoreObject: () => { restored++; } } },
    notify: () => {},
    t: (key: string) => key,
    acceptMany: () => { accepted++; },
    setReviewIdx: () => {},
    setExcelDiff: () => {},
    ensureCommitFile: () => true,
    doCommit: async () => true,
    markCommitted: () => {},
    applyWordEdit: () => {},
    telemetry: () => {},
    send: () => {},
  };

  await useReviewActions({ ...options, confirmAcceptAll: () => false }).acceptAll(turn, 0);
  assert.equal(accepted, 0);
  await useReviewActions({ ...options, confirmAcceptAll: () => true }).acceptAll(turn, 0);
  assert.equal(restored, 0, 'the unreviewed next-state preview is already applied');
  assert.equal(accepted, 1);
});

test('commitAccepted preserves rejected edits and commits only the accepted subset', async () => {
  const turn: DiffTurn = {
    role: 'assistant', kind: 'diff', format: 'excel',
    diff: {
      changeSetId: 'cs-3', hostId: 'excel', intent: 'partial',
      items: [
        { editId: 'e1', ref: 'A1', badge: 'modify', label: 'one' },
        { editId: 'e2', ref: 'A2', badge: 'remove', label: 'two' },
      ],
    },
    ops: [],
  };
  const commits: string[][] = [];
  const marks: number[] = [];
  const { commitAccepted } = useReviewActions({
    format: 'excel',
    accepted: new Set(['cs-3::e1']),
    rejected: new Set(['cs-3::e2']),
    autoBatch: false,
    autoBatchRun: { current: 0 },
    excelDiff: 'final',
    fileBase64: 'aW4=',
    wordRef: { current: null },
    univerRef: { current: null },
    boardRef: { current: null },
    notify: () => {},
    t: (key) => key,
    acceptMany: () => { assert.fail('partial commit must not accept rejected edits'); },
    setReviewIdx: () => {},
    setExcelDiff: () => {},
    ensureCommitFile: () => true,
    doCommit: async (ids) => { commits.push(ids); return true; },
    markCommitted: (_index, count) => { marks.push(count); },
    applyWordEdit: () => {},
    telemetry: () => {},
    confirmAcceptAll: () => { assert.fail('partial commit does not use accept-all confirmation'); },
    send: () => {},
  });

  await commitAccepted(turn, 7);
  assert.deepEqual(commits, [['e1']]);
  assert.deepEqual(marks, [1]);
});

test('commitAccepted refuses to commit while any proposal item is undecided', async () => {
  const turn: DiffTurn = {
    role: 'assistant', kind: 'diff', format: 'excel',
    diff: {
      changeSetId: 'cs-4', hostId: 'excel', intent: 'partial',
      items: [
        { editId: 'e1', ref: 'A1', badge: 'modify', label: 'one' },
        { editId: 'e2', ref: 'A2', badge: 'modify', label: 'two' },
      ],
    },
    ops: [],
  };
  const notices: string[] = [];
  let committed = false;
  const { commitAccepted } = useReviewActions({
    format: 'excel',
    accepted: new Set(['cs-4::e1']),
    rejected: new Set(),
    autoBatch: false,
    autoBatchRun: { current: 0 },
    excelDiff: 'final',
    fileBase64: 'aW4=',
    wordRef: { current: null },
    univerRef: { current: null },
    boardRef: { current: null },
    notify: (message) => { notices.push(message); },
    t: (key) => key,
    acceptMany: () => {},
    setReviewIdx: () => {},
    setExcelDiff: () => {},
    ensureCommitFile: () => true,
    doCommit: async () => { committed = true; return true; },
    markCommitted: () => {},
    applyWordEdit: () => {},
    telemetry: () => {},
    confirmAcceptAll: () => true,
    send: () => {},
  });

  await commitAccepted(turn, 0);
  assert.equal(committed, false);
  assert.deepEqual(notices, ['请先审阅全部改动']);
});
