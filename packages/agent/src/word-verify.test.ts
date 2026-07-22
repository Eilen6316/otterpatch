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

test('Word 自检:页面设置使用空 quote → 跳过定位、通过', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '', scope: 'document', columns: 2 }]));
  assert.equal(v.ok, true);
});

test('Word 自检:不支持无锚点的全文字符格式', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '', scope: 'document', font: '宋体', size: 10.5 }]));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'VERIFIER_MISSING_ANCHOR');
});

test('Word 格式提案把作用域显式编码进 ChangeSet', () => {
  const selection = cs([{ quote: '增速略有放缓', scope: 'selection', bold: true }]);
  const paragraph = cs([{ quote: '增速略有放缓', scope: 'paragraph', align: 'justify' }]);
  const document = cs([{ quote: '', scope: 'document', columns: 2 }]);

  assert.equal(selection.edits[0]?.op.kind === 'setStyle' ? selection.edits[0].op.scope : '', 'selection');
  assert.equal(paragraph.edits[0]?.op.kind === 'setStyle' ? paragraph.edits[0].op.scope : '', 'paragraph');
  assert.equal(document.edits[0]?.op.kind === 'setStyle' ? document.edits[0].op.scope : '', 'document');
  assert.throws(() => cs([{ quote: '增速略有放缓', bold: true }]), /explicit scope/);
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

test('Word 自检:quote 多次出现 → 阻断并要求唯一锚点', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '财政收入', replacement: '一般公共预算收入' }]));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'VERIFIER_AMBIGUOUS_ANCHOR');
  assert.match(v.report, /出现.*次/);
});

test('Word 自检:重叠的重复 quote 也视为歧义', () => {
  const v = buildDocVerifier('aaa')(cs([{ quote: 'aa', replacement: 'b' }]));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'VERIFIER_AMBIGUOUS_ANCHOR');
});

test('Word 结构化快照:para 必须真实存在且 quote 必须属于该段', () => {
  const structured = buildDocVerifier({ blocks: [{ text: '第一段' }, { text: '重复文字在第二段' }] });
  const valid = structured(cs([{ quote: '重复文字', para: 2, replacement: '唯一目标' }]));
  assert.equal(valid.ok, true);
  assert.equal(valid.level, 'lint');

  const wrongBlock = structured(cs([{ quote: '重复文字', para: 1, replacement: '错误目标' }]));
  assert.equal(wrongBlock.ok, false);
  assert.equal(wrongBlock.code, 'VERIFIER_ANCHOR_MISMATCH');

  const outOfBounds = structured(cs([{ quote: '', para: 99, deletePara: true }]));
  assert.equal(outOfBounds.ok, false);
  assert.equal(outOfBounds.code, 'VERIFIER_ANCHOR_OUT_OF_BOUNDS');

  const repeatedInBlock = buildDocVerifier({ blocks: [{ text: '重复文字,再次重复文字' }] })(
    cs([{ quote: '重复文字', para: 1, replacement: '唯一目标' }]),
  );
  assert.equal(repeatedInBlock.ok, false);
  assert.equal(repeatedInBlock.code, 'VERIFIER_AMBIGUOUS_ANCHOR');
});

// ── End-to-end: actually run AnthropicModelClient.respondStream's repair loop (SDK stubbed, no real key needed) ──
// The desktop /propose-stream endpoint goes through respondStream; its verify/repair path is isomorphic to respond.
/** Build a fake SDK stream that emits a single propose_changeset tool_use. */
function fakeToolStream(id: string, input: unknown, thinking?: string, toolPreamble?: string): AsyncIterable<unknown> {
  const json = JSON.stringify(input);
  return {
    async *[Symbol.asyncIterator]() {
      if (thinking) yield { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } };
      if (toolPreamble) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: toolPreamble } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'propose_changeset' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json } };
    },
  };
}

test('Anthropic stream never exposes provider thinking_delta', async () => {
  const client = new AnthropicModelClient({ apiKey: 'test-not-used' });
  const secret = 'PRIVATE_ANTHROPIC_CHAIN_OF_THOUGHT';
  const preamble = 'PRIVATE_ANTHROPIC_TOOL_PREAMBLE';
  (client as unknown as { client: { messages: { create: () => Promise<AsyncIterable<unknown>> } } }).client = {
    messages: { create: async () => fakeToolStream('t1', { plan: '改写', edits: [{ quote: '增速略有放缓', replacement: '增速有所回落' }] }, secret, preamble) },
  };
  const events: StreamEvent[] = [];

  const result = await client.respondStream(reqFor(), wordDialect, (event) => events.push(event));

  assert.equal(result.kind, 'changeset');
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(events), new RegExp(preamble));
  assert.deepEqual(
    events.filter((event) => event.type === 'status').map((event) => event.status.phase),
    ['generating', 'ready'],
  );
});

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
  assert.ok(events.some((e) => e.type === 'status' && e.status.phase === 'checking'), '应发 checking 状态');
  assert.ok(events.some((e) => e.type === 'status' && e.status.phase === 'repairing' && e.status.reason === 'check_failed'), '应发 repair 状态');
  assert.equal(result.kind, 'changeset');
  if (result.kind !== 'changeset') return;
  // The finally adopted quote is the corrected one
  const anchor = Object.values(result.changeSet.anchors)[0]!;
  assert.equal(anchor.portable.kind === 'flow' ? anchor.portable.quote.text : '', '增速略有放缓');
  // The failure report was indeed fed back as a tool_result to the second call
  const fedBack = JSON.stringify(secondCallArgs?.messages ?? []);
  assert.match(fedBack, /不在文档原文中/, '应把校验失败报告回喂模型');
});

test('Anthropic stream: maxRepairs=0 stops after the first failed proposal', async () => {
  const client = new AnthropicModelClient({ apiKey: 'test-not-used' });
  let calls = 0;
  (client as unknown as { client: { messages: { create: () => Promise<AsyncIterable<unknown>> } } }).client = {
    messages: { create: async () => {
      calls++;
      return fakeToolStream('t1', { plan: '改写', edits: [{ quote: '不存在', replacement: '新表述' }] });
    } },
  };
  const result = await client.respondStream(
    { hostId: 'h1', format: 'word', intent: '改写', baseRev: 0 as DocRev, anchors: [], context: DOC },
    wordDialect,
    () => {},
    { verify: buildDocVerifier(DOC), maxRepairs: 0 },
  );
  assert.equal(calls, 1);
  assert.equal(result.kind, 'answer');
  assert.match(result.kind === 'answer' ? result.text : '', /repair budget exhausted/);
});
