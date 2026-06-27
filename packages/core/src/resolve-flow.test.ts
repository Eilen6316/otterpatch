import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFlow, flowConfidenceToStatus } from './resolve-flow.js';

test('① 精确文本 + 前后文吻合 → 高置信', () => {
  const m = resolveFlow('the quick brown fox', { prefix: 'the quick ', text: 'brown', suffix: ' fox' })!;
  assert.equal(m.mode, 'exact');
  assert.deepEqual([m.start, m.end], [10, 15]);
  assert.ok(m.confidence > 0.95);
});

test('① 多处同文本 → 前后文消歧选对位置', () => {
  const m = resolveFlow('a BAR b c BAR d', { prefix: 'c ', text: 'BAR', suffix: ' d' })!;
  assert.equal(m.start, 10); // 第二个 BAR(前后文吻合),而非第一个
  assert.ok(m.confidence > 0.95);
});

test('② 空白/换行漂移 → ws-insensitive 命中', () => {
  const m = resolveFlow('hello\nworld foo', { prefix: '', text: 'hello world', suffix: '' })!;
  assert.equal(m.mode, 'ws-insensitive');
  assert.deepEqual([m.start, m.end], [0, 11]);
  assert.equal(m.confidence, 0.85);
});

test('③ 正文被改但前后文还在 → context-only 命中被改区间', () => {
  const m = resolveFlow('BEGIN newtext END', { prefix: 'BEGIN ', text: 'oldtext', suffix: ' END' })!;
  assert.equal(m.mode, 'context-only');
  assert.deepEqual([m.start, m.end], [6, 13]); // "newtext"
  assert.ok(m.confidence < 0.5);
});

test('完全找不到 → null(detached)', () => {
  assert.equal(resolveFlow('abc', { prefix: 'x', text: 'zzz', suffix: 'y' }), null);
});

test('confidence → RebaseResult 状态分层', () => {
  assert.equal(flowConfidenceToStatus(1), 'tracked');
  assert.equal(flowConfidenceToStatus(0.85), 'shifted');
  assert.equal(flowConfidenceToStatus(0.5), 'fuzzy');
  assert.equal(flowConfidenceToStatus(0.3), 'detached');
});
