import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendAnswerDelta,
  appendReasoningDelta,
  appendStreamingAnswerTurn,
  appendToolReasoning,
  appendUserTurn,
  finalizeLastAnswer,
  interruptLastStreamingAnswer,
  replaceLastWithClarify,
  type ProposalThreadTurn,
} from './app-proposal-flow.js';

test('proposal flow appends user and streaming assistant turns', () => {
  let thread: ProposalThreadTurn[] = [];
  thread = appendUserTurn(thread, 'update totals');
  thread = appendStreamingAnswerTurn(thread);

  assert.deepEqual(thread, [
    { role: 'user', text: 'update totals' },
    { role: 'assistant', kind: 'answer', text: '', reasoning: '', streaming: true },
  ]);
});

test('proposal flow accumulates reasoning, tool markers, and answer text on the last assistant turn', () => {
  let thread = appendStreamingAnswerTurn<ProposalThreadTurn>([]);
  thread = appendReasoningDelta(thread, 'thinking');
  thread = appendToolReasoning(thread, 'read_range');
  thread = appendAnswerDelta(thread, 'done');

  assert.equal(thread[0]?.role, 'assistant');
  assert.equal(thread[0]?.kind, 'answer');
  assert.equal(thread[0]?.reasoning, 'thinking\n〔查表 read_range〕\n');
  assert.equal(thread[0]?.text, 'done');
});

test('proposal flow preserves reasoning when a stream becomes clarify', () => {
  let thread = appendStreamingAnswerTurn<ProposalThreadTurn>([]);
  thread = appendReasoningDelta(thread, 'need context');
  thread = replaceLastWithClarify(thread, [{ question: 'Which sheet?', options: [] }]);

  assert.deepEqual(thread, [{
    role: 'assistant',
    kind: 'clarify',
    questions: [{ question: 'Which sheet?', options: [] }],
    reasoning: 'need context',
  }]);
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
