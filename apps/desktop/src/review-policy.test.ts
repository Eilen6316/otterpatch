import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffTurn } from './app-thread-types.js';
import { acceptAllConfirmation, reviewRiskLevel, summarizeReviewRisk } from './review-policy.js';

test('review policy fails closed when risk metadata is missing', () => {
  assert.equal(reviewRiskLevel({ editId: 'e', ref: 'A1', badge: 'modify', label: 'edit' }), 'caution');
});

test('review risk summary reports destructive, delete, structure, and document-wide changes', () => {
  const turn: DiffTurn = {
    role: 'assistant',
    kind: 'diff',
    format: 'word',
    diff: {
      changeSetId: 'cs',
      hostId: 'word',
      intent: 'revise',
      items: [
        { editId: 'text', ref: 'p1', badge: 'modify', label: 'replace', risk: { level: 'safe', reasons: [] } },
        { editId: 'delete', ref: 'p2', badge: 'remove', label: 'delete', risk: { level: 'destructive', reasons: ['deletion'] } },
        { editId: 'table', ref: 'doc', badge: 'add', label: 'table', risk: { level: 'caution', reasons: [] } },
        { editId: 'page', ref: 'doc', badge: 'modify', label: 'columns', style: { columns: 2 } },
        { editId: 'scope', ref: 'doc', badge: 'modify', label: 'font', style: { font: 'Arial' }, risk: { level: 'caution', reasons: ['style scope is document'] } },
      ],
    },
    ops: [],
    word: [
      { editId: 'text', domId: 't', quote: 'old', replacement: 'new' },
      { editId: 'delete', domId: 'd', quote: 'remove', remove: true },
      { editId: 'table', domId: 'tb', quote: '', table: { rows: [['A']], headerRows: 0, at: 'end' } },
      { editId: 'page', domId: 'p', quote: '', style: { columns: 2 } },
      { editId: 'scope', domId: 's', quote: '', style: { font: 'Arial' } },
    ],
  };
  const summary = summarizeReviewRisk(turn);
  assert.deepEqual(summary, {
    total: 5, safe: 1, caution: 3, destructive: 1, deletions: 1, structural: 1, documentWide: 2,
  });
  assert.match(acceptAllConfirmation(summary), /破坏性 1/);
  assert.match(acceptAllConfirmation(summary), /删除 1，结构 1，文档级 2/);
});
