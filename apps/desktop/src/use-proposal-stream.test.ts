import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Turn } from './app-thread-types.js';
import { buildDrawioProposalContext, buildWordProposalContext, latestProposalId } from './use-proposal-stream.js';

test('latestProposalId selects the newest usable proposal binding', () => {
  const thread: Turn[] = [
    { role: 'assistant', kind: 'diff', format: 'excel', proposal: { proposalId: 'proposal-1' }, diff: { changeSetId: 'cs-1', hostId: 'excel', intent: 'first', items: [] }, ops: [] },
    { role: 'assistant', kind: 'answer', text: 'between proposals' },
    { role: 'assistant', kind: 'diff', format: 'word', proposal: { proposalId: 42 }, diff: { changeSetId: 'cs-2', hostId: 'word', intent: 'second', items: [] }, ops: [] },
    { role: 'assistant', kind: 'diff', format: 'drawio', proposal: { proposalId: 'proposal-3' }, diff: { changeSetId: 'cs-3', hostId: 'drawio', intent: 'third', items: [] }, ops: [] },
  ];

  assert.equal(latestProposalId(thread), 'proposal-3');
  assert.equal(latestProposalId([{ role: 'assistant', kind: 'answer', text: 'none' }]), undefined);
});

test('Word proposal context distinguishes document, text selection, and image selection', () => {
  const wholeDocument = buildWordProposalContext('Document body', null);
  assert.match(wholeDocument, /未圈选文字/);
  assert.match(wholeDocument, /Document body/);

  const selectedText = buildWordProposalContext('Document body', {
    text: 'exact source quote',
    block: '正文',
    chars: 18,
    para: 4,
    font: '宋体',
    size: 12,
    bold: true,
    align: '居中',
  });
  assert.match(selectedText, /当前选区·用户此刻圈选了这段/);
  assert.match(selectedText, /第4段/);
  assert.match(selectedText, /"exact source quote"/);

  const selectedImage = buildWordProposalContext('Document body', {
    text: 'image:diagram.png',
    block: '图片',
    chars: 0,
    para: 7,
  });
  assert.match(selectedImage, /点选了一张图片/);
  assert.match(selectedImage, /para=7/);
});

test('Drawio proposal context uses the real board selection and identifies an empty board', () => {
  assert.equal(buildDrawioProposalContext(null), '[流程图] 当前画板为空。');
  assert.equal(buildDrawioProposalContext({
    context: '[流程图] 2 个节点',
    count: 2,
    chip: '2 个对象',
    board: { nodes: [], edges: [] },
  }), '[流程图] 2 个节点');
});
