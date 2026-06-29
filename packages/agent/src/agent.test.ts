import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocRev } from '@otterpatch/core';
import { Agent, ConventionStack, MockModelClient, conventionFromMarkdown, createModelClient, normalizeMessages, PROVIDERS, type Provider } from './index.js';
import { defaultLibrary } from '@otterpatch/skills';

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
    () => new Agent(mock).propose({ hostId: 'h1', format: 'csv', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' }),
    /no dialect/,
  );
});

test('Agent + SkillLibrary: 命中技能注入系统提示,不影响产出', async () => {
  const lib = defaultLibrary();
  const mock = new MockModelClient(() => ({ plan: 'x', edits: [{ cell: 'A1', op: 'setValue', value: 1 }] }));
  const cs = await new Agent(mock, undefined, lib).propose({
    hostId: 'h1',
    format: 'excel',
    intent: '把金额列补齐',
    baseRev: 0 as DocRev,
    anchors: [],
    context: '',
  });
  assert.equal(cs.edits.length, 1);
  assert.equal(lib.match('把金额列补齐', 'excel')[0]!.name, 'xlsx'); // 库命中 Excel 技能
});

test('ConventionStack: 分层拼接,global→workspace→document(就近在后)', () => {
  const s = new ConventionStack()
    .add({ scope: 'document', text: '本文档正文用四号字' })
    .add({ scope: 'global', text: '日期一律 YYYY-MM-DD' });
  const r = s.render();
  assert.match(r, /约定/);
  assert.ok(r.indexOf('YYYY-MM-DD') < r.indexOf('四号字')); // global 在前,document 在后
});

test('conventionFromMarkdown: 去 frontmatter 取正文', () => {
  const c = conventionFromMarkdown('---\nname: x\n---\n金额保留两位小数。', 'workspace', 'AGENTS.md');
  assert.equal(c.scope, 'workspace');
  assert.equal(c.text, '金额保留两位小数。');
});

test('Agent + 约定 + 技能:都注入系统提示,不破坏产出', async () => {
  const conv = new ConventionStack().add({ scope: 'global', text: '数字保留两位小数' });
  const mock = new MockModelClient(() => ({ plan: 'x', edits: [{ cell: 'A1', op: 'setValue', value: 1 }] }));
  const cs = await new Agent(mock, undefined, defaultLibrary(), conv).propose({
    hostId: 'h1',
    format: 'excel',
    intent: '把金额补齐',
    baseRev: 0 as DocRev,
    anchors: [],
    context: '',
  });
  assert.equal(cs.edits.length, 1);
});

test('Agent reask: 校验失败 → 同回合重试修正', async () => {
  let n = 0;
  const mock = new MockModelClient(() => {
    n++;
    return { plan: 'x', edits: n < 2 ? [] : [{ cell: 'A1', op: 'setValue', value: 1 }] };
  });
  const cs = await new Agent(mock, undefined, undefined, undefined, {
    validator: (c) => ({ ok: c.edits.length > 0, errors: c.edits.length ? [] : ['edits 不能为空'] }),
    maxRetries: 2,
  }).propose({ hostId: 'h1', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' });
  assert.equal(n, 2); // 第一次空→重试,第二次通过
  assert.equal(cs.edits.length, 1);
});

test('Agent reask: 用尽重试返回最后一次(调用 1+maxRetries 次)', async () => {
  let n = 0;
  const mock = new MockModelClient(() => {
    n++;
    return { plan: 'x', edits: [] };
  });
  const cs = await new Agent(mock, undefined, undefined, undefined, {
    validator: () => ({ ok: false, errors: ['always fail'] }),
    maxRetries: 2,
  }).propose({ hostId: 'h1', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' });
  assert.equal(n, 3); // 1 + 2 retries
  assert.equal(cs.edits.length, 0); // 返回最后一次(无效),交下游裁决
});

test('createModelClient 覆盖 8 家厂商(9 个 provider key)', () => {
  const providers: Provider[] = ['claude', 'openai', 'chatgpt', 'deepseek', 'glm', 'kimi', 'doubao', 'minimax', 'gemini'];
  for (const p of providers) {
    const c = createModelClient(p, { apiKey: 'dummy-key' });
    assert.equal(typeof c.proposeChangeSet, 'function', p);
  }
  assert.equal(Object.keys(PROVIDERS).length, 9);
});

test('normalizeMessages: 合并相邻同角色,防 provider roles-must-alternate 500', () => {
  // 快速连发/answer+diff 拆轮造成的背靠背 assistant → 合并成一条
  const out = normalizeMessages([
    { role: 'system', content: 'S' },
    { role: 'user', content: '改X' },
    { role: 'assistant', content: '好的' },
    { role: 'assistant', content: '提出改动…' },
    { role: 'user', content: '改Y' },
  ]);
  assert.deepEqual(out.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(out[2]!.content, '好的\n提出改动…');
});

test('normalizeMessages: 丢空消息 + 合并背靠背 user(失败回滚/空指令兜底)', () => {
  const out = normalizeMessages([
    { role: 'system', content: 'S' },
    { role: 'user', content: '悬挂的旧指令' },
    { role: 'user', content: '' }, // 空 user 应被丢弃
    { role: 'user', content: '当前指令' },
  ]);
  assert.deepEqual(out.map((m) => m.role), ['system', 'user']);
  assert.equal(out[1]!.content, '悬挂的旧指令\n当前指令');
});

test('normalizeMessages: system 之后若以 assistant 起头则丢弃(provider 要求 user 起头)', () => {
  const out = normalizeMessages([
    { role: 'system', content: 'S' },
    { role: 'assistant', content: '截断后悬出的 assistant' },
    { role: 'user', content: '当前指令' },
  ]);
  assert.deepEqual(out.map((m) => m.role), ['system', 'user']);
});
