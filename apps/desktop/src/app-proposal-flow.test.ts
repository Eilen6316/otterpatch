import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendAnswerDelta,
  appendStreamingAnswerTurn,
  appendUserTurn,
  finalizeLastAnswer,
  interruptLastStreamingAnswer,
  replaceLastWithClarify,
  setStreamStatus,
  type ProposalThreadTurn,
} from './app-proposal-flow.js';

test('proposal flow appends user and streaming assistant turns', () => {
  let thread: ProposalThreadTurn[] = [];
  thread = appendUserTurn(thread, 'update totals');
  thread = appendStreamingAnswerTurn(thread);

  assert.deepEqual(thread, [
    { role: 'user', text: 'update totals' },
    { role: 'assistant', kind: 'answer', text: '', status: { phase: 'generating' }, streaming: true },
  ]);
});

test('proposal flow accepts only bounded statuses and answer text', () => {
  let thread = appendStreamingAnswerTurn<ProposalThreadTurn>([]);
  thread = setStreamStatus(thread, { phase: 'reading', source: 'spreadsheet', operation: 'read_range', raw: 'private reasoning' });
  thread = appendAnswerDelta(thread, 'done');

  assert.equal(thread[0]?.role, 'assistant');
  assert.equal(thread[0]?.kind, 'answer');
  assert.deepEqual(thread[0]?.status, { phase: 'reading', source: 'spreadsheet' });
  assert.doesNotMatch(JSON.stringify(thread), /private reasoning/);
  assert.equal(thread[0]?.text, 'done');
});

test('proposal flow rejects unknown statuses and clears progress when stream becomes clarify', () => {
  let thread = appendStreamingAnswerTurn<ProposalThreadTurn>([]);
  thread = setStreamStatus(thread, { phase: 'provider_reasoning', text: 'need context' });
  thread = replaceLastWithClarify(thread, [{ question: 'Which sheet?', options: [] }]);

  assert.deepEqual(thread, [{
    role: 'assistant',
    kind: 'clarify',
    questions: [{ question: 'Which sheet?', options: [] }],
  }]);
  assert.doesNotMatch(JSON.stringify(thread), /need context/);
});

test('proposal flow finalizes or interrupts only the active streaming answer', () => {
  let thread = appendStreamingAnswerTurn<ProposalThreadTurn>([]);
  thread = appendAnswerDelta(thread, 'partial');
  thread = interruptLastStreamingAnswer(thread, 'request failed');

  assert.equal(thread[0]?.streaming, false);
  assert.equal(thread[0]?.text, 'partial\n\nrequest failed');

  const unchanged = finalizeLastAnswer([{ role: 'user', text: 'not assistant' }], 'ignored');
  assert.deepEqual(unchanged, [{ role: 'user', text: 'not assistant' }]);
});
