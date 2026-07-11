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

test('Word 表格:文档末尾插入结构化表格无需源锚点', () => {
  const changeSet = cs([{
    quote: '',
    table: [['工作条线', '关键任务'], ['开发迭代', 'Agent 能力']],
    tableHeaderRows: 1,
    tableAt: 'end',
  }]);
  const edit = changeSet.edits[0]!;
  assert.deepEqual(edit.op, {
    family: 'structure',
    kind: 'insertTable',
    rows: [['工作条线', '关键任务'], ['开发迭代', 'Agent 能力']],
    headerRows: 1,
    at: 'end',
  });
  assert.equal(buildDocVerifier(DOC)(changeSet).ok, true);
});

test('Word 自检:quote 多次出现 → 通过但给唯一性告警', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '财政收入', replacement: '一般公共预算收入' }]));
  assert.equal(v.ok, true); // warning does not block
  assert.match(v.report, /出现多次/);
});

// ── End-to-end: actually run AnthropicModelClient.respondStream's repair loop (SDK stubbed, no real key needed) ──
// The desktop /propose-stream endpoint goes through respondStream; its verify/repair path is isomorphic to respond.
/** Build a fake SDK stream that emits a single propose_changeset tool_use. */
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
  // Override the internal SDK client: 1st call emits a fabricated quote, 2nd emits a quote that actually exists in the source
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
  // The finally adopted quote is the corrected one
  const anchor = Object.values(result.changeSet.anchors)[0]!;
  assert.equal(anchor.portable.kind === 'flow' ? anchor.portable.quote.text : '', '增速略有放缓');
  // The failure report was indeed fed back as a tool_result to the second call
  const fedBack = JSON.stringify(secondCallArgs?.messages ?? []);
  assert.match(fedBack, /不在文档原文中/, '应把校验失败报告回喂模型');
});
