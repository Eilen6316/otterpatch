import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  captureGridOpBeforeState,
  makeWorkspaceDiffTurn,
  orderWordEditsForApply,
  replaceLastWithWorkspaceDiff,
} from './app-workspace-proposals.js';
import type { AgentDiff, GridOp, WordEdit } from './proposal-materializers.js';

const diff: AgentDiff = { changeSetId: 'cs', hostId: 'host', intent: 'test', items: [] };

test('orderWordEditsForApply keeps text/style first, tables next, and removals last descending by block', () => {
  const edits: WordEdit[] = [
    { editId: 'remove-low', domId: 'd1', quote: 'a', remove: true, blockIdx: 2 },
    { editId: 'table', domId: 'd2', quote: '', table: { rows: [['A']], headerRows: 0, at: 'end' } },
    { editId: 'style', domId: 'd3', quote: 'b', style: { bold: true } },
    { editId: 'remove-high', domId: 'd4', quote: 'c', remove: true, blockIdx: 9 },
  ];

  assert.deepEqual(orderWordEditsForApply(edits).map((edit) => edit.editId), [
    'style',
    'table',
    'remove-high',
    'remove-low',
  ]);
});

test('captureGridOpBeforeState snapshots value and cell state without mutating original ops', () => {
  const ops: GridOp[] = [{ a1: 'B2', value: 42, note: 'set', editId: 'e1' }];
  const captured = captureGridOpBeforeState(ops, {
    getValue: (a1) => `old:${a1}`,
    getCellState: (a1) => ({ v: `old:${a1}`, bg: '#fff', bold: true, numFmt: '0.00' }),
  });

  assert.deepEqual(captured, [{
    a1: 'B2',
    value: 42,
    note: 'set',
    editId: 'e1',
    before: 'old:B2',
    beforeState: { v: 'old:B2', bg: '#fff', bold: true, numFmt: '0.00' },
  }]);
  assert.equal(ops[0]!.before, undefined);
  assert.notEqual(captured[0], ops[0]);
});

test('makeWorkspaceDiffTurn preserves answer text without transient stream status', () => {
  const turn = makeWorkspaceDiffTurn(
    { role: 'assistant', kind: 'answer', text: 'draft answer' },
    { format: 'excel', changeSet: { edits: [] }, proposal: { proposalId: 'p1' }, diff, ops: [{ a1: 'A1', note: 'noop' }] },
  );

  assert.equal(turn.kind, 'diff');
  assert.equal(turn.text, 'draft answer');
  assert.deepEqual(turn.ops, [{ a1: 'A1', note: 'noop' }]);
  assert.deepEqual(turn.proposal, { proposalId: 'p1' });
});

test('replaceLastWithWorkspaceDiff only replaces the final assistant turn', () => {
  const thread = replaceLastWithWorkspaceDiff(
    [
      { role: 'user', text: 'request' },
      { role: 'assistant', kind: 'answer', text: 'ok' },
    ],
    { format: 'word', changeSet: null, diff, word: [{ editId: 'w1', domId: 'd1', quote: 'q', replacement: 'r' }] },
  );

  assert.equal(thread[0]!.role, 'user');
  const proposal = thread[1];
  assert.ok(proposal && 'format' in proposal);
  assert.equal(proposal.role, 'assistant');
  assert.equal(proposal.kind, 'diff');
  assert.equal(proposal.format, 'word');
  assert.equal(proposal.word?.[0]?.editId, 'w1');
});
