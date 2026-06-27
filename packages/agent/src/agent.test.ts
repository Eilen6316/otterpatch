import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocRev } from '@office-agent/core';
import { Agent, MockModelClient, createModelClient, PROVIDERS, type Provider } from './index.js';

test('Agent: 意图 + Mock 模型 → 受约束 ChangeSet', async () => {
  const mock = new MockModelClient(() => ({
    plan: '补 B1',
    edits: [{ cell: 'Sheet1!B1', op: 'setValue', value: 99 }],
  }));
  const cs = await new Agent(mock).propose({
    hostId: 'h1',
    intent: '把 B1 改成 99',
    baseRev: 0 as DocRev,
    anchors: [],
    context: '',
  });
  assert.equal(cs.edits.length, 1);
  const e = cs.edits[0]!;
  assert.equal(e.op.kind, 'setValue');
  assert.equal(cs.anchors[e.target]!.portable.kind, 'grid');
  assert.equal(cs.meta.planSummary, '补 B1');
});

test('createModelClient 覆盖 8 家厂商(9 个 provider key)', () => {
  const providers: Provider[] = ['claude', 'openai', 'chatgpt', 'deepseek', 'glm', 'kimi', 'doubao', 'minimax', 'gemini'];
  for (const p of providers) {
    const c = createModelClient(p, { apiKey: 'dummy-key' });
    assert.equal(typeof c.proposeChangeSet, 'function', p);
  }
  assert.equal(Object.keys(PROVIDERS).length, 9);
});
