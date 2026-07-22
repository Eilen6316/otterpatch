import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHistory, sanitizeThread, type HistoryTurn } from './app-history.js';

test('sanitizeThread clears refresh-time streaming residue and drops empty placeholders', () => {
  const persisted = [
    { role: 'assistant', kind: 'answer', text: 'partial', reasoning: 'legacy private reasoning', status: { phase: 'reading' }, streaming: true },
    { role: 'assistant', kind: 'answer', text: '', reasoning: 'legacy only', streaming: true },
    { role: 'user', text: 'keep me' },
  ] as unknown as HistoryTurn[];
  const result = sanitizeThread(persisted);

  assert.deepEqual(result, [
    { role: 'assistant', kind: 'answer', text: 'partial', streaming: false },
    { role: 'user', text: 'keep me' },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /legacy|reasoning|status/);
});

test('buildHistory summarizes diff turns and preserves old outcomes in compacted history', () => {
  const thread: HistoryTurn[] = [
    {
      role: 'assistant',
      kind: 'diff',
      diff: { items: [{ ref: 'A1', label: 'old committed edit' }] },
      committed: true,
      committedCount: 1,
    },
    { role: 'user', text: 'old user request' },
  ];

  for (let i = 0; i < 11; i++) thread.push({ role: 'user', text: `recent ${i}` });

  const history = buildHistory(thread);

  assert.equal(history.length, 12);
  assert.match(history[0]!.content, /此前对话要点/);
  assert.match(history[0]!.content, /old user request/);
  assert.match(history[0]!.content, /old committed edit/);
  assert.equal(history.at(-1)!.content, 'recent 10');
});

test('buildHistory projects clarify turns without full UI state', () => {
  const history = buildHistory([
    {
      role: 'assistant',
      kind: 'clarify',
      questions: [{ question: 'Which sheet?', options: [{ label: 'Sheet1' }, { label: 'Sheet2' }] }],
    },
  ]);

  assert.equal(history[0]!.role, 'assistant');
  assert.match(history[0]!.content, /Which sheet\?/);
  assert.match(history[0]!.content, /Sheet1\/Sheet2/);
});
