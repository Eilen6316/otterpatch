import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocRev } from '@otterpatch/core';
import { AnthropicModelClient, buildDocVerifier, wordDialect, type ProposeRequest, type StreamEvent } from './index.js';

const DOC = '本报告分析吉林省财政收入的影响因素。全省财政收入逐年增长,增速略有放缓。';
const reqFor = (): ProposeRequest => ({ hostId: 'h1', format: 'word', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: DOC });
const cs = (edits: unknown[]) => wordDialect.buildChangeSet(reqFor(), { plan: 'p', edits } as never);

test('Word 自检:quote 真实存在 → 通过', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '增速略有放缓', replacement: '增速有所回落' }]));
  assert.equal(v.ok, true);
});

test('Word 自检:quote 不在原文 → 失败并回喂', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '这句话文档里根本没有', replacement: '改后' }]));
  assert.equal(v.ok, false);
  assert.match(v.report, /不在文档原文中/);
});

test('Word 自检:改后与原文相同 = 空改动 → 失败', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '增速略有放缓', replacement: '增速略有放缓' }]));
  assert.equal(v.ok, false);
  assert.match(v.report, /空改动/);
});

test('Word 自检:全文格式改动(all=true,无 quote)→ 跳过定位、通过', () => {
  const v = buildDocVerifier(DOC)(cs([{ all: true, font: '宋体', size: 10.5 }]));
  assert.equal(v.ok, true);
});

test('Word 自检:quote 多次出现 → 通过但给唯一性告警', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '财政收入', replacement: '一般公共预算收入' }]));
  assert.equal(v.ok, true); // 告警不阻断
  assert.match(v.report, /出现多次/);
});

// ── 端到端:真跑 AnthropicModelClient.respondStream 的修复闭环(打桩 SDK,无需真实 key)──
// 桌面 /propose-stream 走的就是 respondStream;verify/repair 那段与 respond 同构。
/** 造一个"流式返回一次 propose_changeset tool_use"的假 SDK 流。 */
function fakeToolStream(id: string, input: unknown): AsyncIterable<unknown> {
  const json = JSON.stringify(input);
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'propose_changeset' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json } };
    },
  };
}

test('Word 端到端:编造 quote → 校验失败回喂 → 同回合改对(真跑 respondStream 修复闭环)', async () => {
  const client = new AnthropicModelClient({ apiKey: 'test-not-used' });
  let calls = 0;
  let secondCallArgs: { messages?: Array<{ role: string; content: unknown }> } | undefined;
  // 覆写内部 SDK client:第 1 次吐编造 quote,第 2 次吐原文真实存在的 quote
  (client as unknown as { client: { messages: { create: (a: unknown) => Promise<AsyncIterable<unknown>> } } }).client = {
    messages: {
      create: async (a: unknown) => {
        calls++;
        if (calls === 1) return fakeToolStream('t1', { plan: '改写', edits: [{ quote: '文档里根本不存在的句子XYZ', replacement: '新表述' }] });
        secondCallArgs = a as typeof secondCallArgs;
        return fakeToolStream('t2', { plan: '改写', edits: [{ quote: '增速略有放缓', replacement: '增速有所回落' }] });
      },
    },
  };

  const events: StreamEvent[] = [];
  const result = await client.respondStream(
    { hostId: 'h1', format: 'word', intent: '把结尾那句改委婉些', baseRev: 0 as DocRev, anchors: [], context: DOC },
    wordDialect,
    (e) => events.push(e),
    { verify: buildDocVerifier(DOC), maxRepairs: 1 },
  );

  assert.equal(calls, 2, '修复闭环应触发第二次调用');
  assert.ok(events.some((e) => e.type === 'tool' && e.name === 'verify'), '应发 verify 事件');
  assert.equal(result.kind, 'changeset');
  if (result.kind !== 'changeset') return;
  // 最终采纳的是"改对后"的 quote
  const anchor = Object.values(result.changeSet.anchors)[0]!;
  assert.equal(anchor.portable.kind === 'flow' ? anchor.portable.quote.text : '', '增速略有放缓');
  // 失败报告确实作为 tool_result 回喂给了第二次调用
  const fedBack = JSON.stringify(secondCallArgs?.messages ?? []);
  assert.match(fedBack, /不在文档原文中/, '应把校验失败报告回喂模型');
});
