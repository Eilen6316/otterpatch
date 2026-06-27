import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocRev } from '@opal/core';
import { Agent, MockModelClient, createModelClient, PROVIDERS, type Provider } from './index.js';

test('Agent excel: 意图 + Mock → grid setValue ChangeSet', async () => {
  const mock = new MockModelClient(() => ({ plan: '补 B1', edits: [{ cell: 'Sheet1!B1', op: 'setValue', value: 99 }] }));
  const cs = await new Agent(mock).propose({
    hostId: 'h1',
    format: 'excel',
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

test('Agent drawio: 意图 + Mock → object ChangeSet(按 mxCell id)', async () => {
  const mock = new MockModelClient(() => ({ plan: '改节点2', ops: [{ op: 'update', cellId: '2', value: '新' }] }));
  const cs = await new Agent(mock).propose({
    hostId: 'h1',
    format: 'drawio',
    intent: '把节点 2 文字改成新',
    baseRev: 0 as DocRev,
    anchors: [],
    context: '',
  });
  assert.equal(cs.edits.length, 1);
  const e = cs.edits[0]!;
  assert.equal(e.op.kind, 'setObjectProps');
  const anchor = cs.anchors[e.target]!;
  assert.equal(anchor.portable.kind, 'object');
  assert.equal(anchor.portable.kind === 'object' && anchor.portable.elementId, '2');
});

test('Agent: 未知格式抛错', async () => {
  const mock = new MockModelClient(() => ({ plan: '', edits: [] }));
  await assert.rejects(
    () => new Agent(mock).propose({ hostId: 'h1', format: 'ppt', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' }),
    /no dialect/,
  );
});

test('createModelClient 覆盖 8 家厂商(9 个 provider key)', () => {
  const providers: Provider[] = ['claude', 'openai', 'chatgpt', 'deepseek', 'glm', 'kimi', 'doubao', 'minimax', 'gemini'];
  for (const p of providers) {
    const c = createModelClient(p, { apiKey: 'dummy-key' });
    assert.equal(typeof c.proposeChangeSet, 'function', p);
  }
  assert.equal(Object.keys(PROVIDERS).length, 9);
});
