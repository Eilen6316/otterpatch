/**
 * ReviewBox:已采纳回合出现"保存为技能"(示范即技能),未提交/无 ChangeSet 时不出现。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TContext } from './i18n.js';
import { ReviewBox, type ReviewBoxProps } from './ReviewBox.js';
import type { DiffTurn } from './app-thread-types.js';

const t = (s: string): string => s;

const item = {
  editId: 'e1',
  ref: 'B1',
  badge: 'modify',
  label: 'setValue',
  before: { kind: 'cell' as const, value: 20 },
  after: { kind: 'cell' as const, value: 99 },
};

const diffTurn = (overrides: Partial<DiffTurn> = {}): DiffTurn => ({
  role: 'assistant',
  kind: 'diff',
  format: 'excel',
  diff: { changeSetId: 'cs1', hostId: 'h', intent: '把 B1 改成 99', items: [item] },
  ops: [],
  ...overrides,
});

const baseProps: ReviewBoxProps = {
  turn: diffTurn(),
  index: 0,
  active: false,
  reviewIdx: 0,
  accepted: new Set<string>(),
  rejected: new Set<string>(),
  hoverCid: null,
  autoBatch: false,
  wordRef: { current: null },
  onSetReviewIdx() {},
  onHoverCid() {},
  onAccept() {},
  onReject() {},
  onAcceptAll() {},
  onCommitAccepted() {},
  onRevertTurn() {},
  onSend() {},
  onSetAutoBatch() {},
};

const render = (props: Partial<ReviewBoxProps> = {}): string =>
  renderToStaticMarkup(
    <TContext.Provider value={t}>
      <ReviewBox {...baseProps} {...props} />
    </TContext.Provider>,
  );

test('ReviewBox: committed turns with a ChangeSet offer save-as-skill', () => {
  const markup = render({
    turn: diffTurn({ committed: true, committedCount: 1, changeSet: { id: 'cs1' } }),
    onSaveAsSkill() {},
  });
  assert.match(markup, /保存为技能/);
});

test('ReviewBox: uncommitted or ChangeSet-less turns do not offer save-as-skill', () => {
  assert.equal(render({ onSaveAsSkill() {} }).includes('保存为技能'), false, 'not committed yet');
  assert.equal(render({ turn: diffTurn({ committed: true }), onSaveAsSkill() {} }).includes('保存为技能'), false, 'no ChangeSet on the turn');
});

test('ReviewBox: without the handler the button never renders', () => {
  const markup = render({ turn: diffTurn({ committed: true, changeSet: { id: 'cs1' } }) });
  assert.equal(markup.includes('保存为技能'), false);
});
