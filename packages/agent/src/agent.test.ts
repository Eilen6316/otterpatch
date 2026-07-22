import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_LIMITS, ResourceLimitError, STRICT_POLICY, type DocRev } from '@otterpatch/core';
import { Agent, AnthropicModelClient, ConventionStack, EXCEL_OPS, MockModelClient, OpenAICompatModelClient, conventionFromMarkdown, createModelClient, excelDialect, normalizeMessages, PROVIDERS, wordDialect, type ModelClient, type Provider, type StreamEvent } from './index.js';
import { defaultLibrary } from '@otterpatch/skills';
import { AgentLoopBudget, validProposalRepairs } from './loop-budget.js';
import { readingStatus, sanitizeStreamStatus } from './stream-status.js';

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

test('Agent drawio rejects compressed source diagrams before calling the model', async () => {
  let calls = 0;
  const mock = new MockModelClient(() => {
    calls++;
    return { plan: 'must not run', ops: [] };
  });
  await assert.rejects(
    () => new Agent(mock).propose({
      hostId: 'h1',
      format: 'drawio',
      intent: 'change a node',
      baseRev: 0 as DocRev,
      anchors: [],
      context: '',
      board: { nodes: [{ id: '2' }], edges: [], sourceEncoding: 'compressed' },
    }),
    /does not support compressed source diagrams/,
  );
  assert.equal(calls, 0);
});

test('Agent capability surfaces expose only operations with verified writeback', () => {
  assert.deepEqual(EXCEL_OPS, ['setValue', 'setFormula', 'setStyle', 'setNumberFormat', 'clear']);
  const excelSurface = excelDialect.systemPrompt + JSON.stringify(excelDialect.parameters);
  assert.doesNotMatch(excelSurface, /insertRows|deleteRows|merge|freeze|condFormat|dataValidation|chart|addSheet/);
  assert.doesNotMatch(wordDialect.systemPrompt + JSON.stringify(wordDialect.parameters), /all=true|"all"/);
});

test('Agent appends current capability, maturity, snapshot, and approval constraints after skills', async () => {
  let system = '';
  const model: ModelClient = {
    proposeChangeSet: async (req, dialect) => {
      system = dialect.systemPrompt;
      return excelDialect.buildChangeSet(req, { plan: 'update', edits: [{ cell: 'A1', op: 'setValue', value: 2 }] });
    },
  };
  await new Agent(model, undefined, defaultLibrary(), undefined, {
    approvalPolicy: STRICT_POLICY,
    allowUnreviewedCommit: true,
  }).propose({
    hostId: 'h', format: 'excel', intent: 'update A1', baseRev: 0 as DocRev, anchors: [], context: 'A1=1',
    sheet: { name: 'Sheet1', a1: 'A1', values: [[1]] },
  });

  assert.match(system, /setValue\{core=setValue,maturity=verified,scope=range,preview=true,verify=true,backend=surgical-ooxml\}/);
  assert.match(system, /sheetSnapshot=available/);
  assert.match(system, /autoApprove=safe;requiresApproval=caution,destructive/);
  assert.match(system, /Agent 始终只能提出 ChangeSet,不能自行提交/);
  assert.ok(system.lastIndexOf('【当前执行约束') > system.lastIndexOf('可用技能'));
});

test('Excel tool schema and builder discriminate operations without dangerous defaults', () => {
  const parameters = excelDialect.parameters as {
    properties: { edits: { items: { oneOf: Array<{ additionalProperties: boolean; required: string[]; properties: { op: { enum: string[] } } }> } } };
  };
  const variants = parameters.properties.edits.items.oneOf;
  assert.deepEqual(variants.map((variant) => variant.properties.op.enum[0]), ['setValue', 'setFormula', 'setStyle', 'setNumberFormat', 'clear']);
  assert.deepEqual(variants.map((variant) => variant.required), [
    ['cell', 'op', 'value'],
    ['cell', 'op', 'formula'],
    ['cell', 'op', 'style'],
    ['cell', 'op', 'pattern'],
    ['cell', 'op'],
  ]);
  assert.ok(variants.every((variant) => variant.additionalProperties === false));

  const request = { hostId: 'h1', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '', sheet: { name: 'Current', a1: 'A1', values: [[1]] } };
  for (const edit of [
    { cell: 'A1', op: 'setValue' },
    { cell: 'A1', op: 'setFormula' },
    { cell: 'A1', op: 'setStyle' },
    { cell: 'A1', op: 'setNumberFormat' },
    { cell: 'A1', op: 'clear', value: 1 },
  ]) {
    assert.throws(() => excelDialect.buildChangeSet(request, { plan: 'x', edits: [edit] }), /required|unsupported fields/);
  }

  const unqualified = excelDialect.buildChangeSet(request, { plan: 'x', edits: [{ cell: 'A1', op: 'setValue', value: null }] });
  const anchor = unqualified.anchors[unqualified.edits[0]!.target]!;
  assert.equal(anchor.portable.kind === 'grid' ? anchor.portable.sheet : '', 'Current');
  assert.throws(
    () => excelDialect.buildChangeSet({ ...request, sheet: undefined }, { plan: 'x', edits: [{ cell: 'A1', op: 'setValue', value: 1 }] }),
    /requires the current sheet name/,
  );
});

test('Agent word: 二维 table 提案 → insertTable ChangeSet', async () => {
  const mock = new MockModelClient(() => ({
    plan: '插入对照表',
    edits: [{ quote: '', table: [['字段', '说明'], ['目标', '真实表格']], tableHeaderRows: 1, tableAt: 'end' }],
  }));
  const cs = await new Agent(mock).propose({
    hostId: 'h1',
    format: 'word',
    intent: '把内容整理成真实表格',
    baseRev: 0 as DocRev,
    anchors: [],
    context: '第1段:字段与说明',
  });

  assert.equal(cs.edits.length, 1);
  assert.deepEqual(cs.edits[0]!.op, {
    family: 'structure',
    kind: 'insertTable',
    rows: [['字段', '说明'], ['目标', '真实表格']],
    headerRows: 1,
    at: 'end',
  });
  const anchor = cs.anchors[cs.edits[0]!.target]!;
  assert.equal(anchor.portable.kind, 'flow');
  assert.deepEqual(anchor.portable.kind === 'flow' ? anchor.portable.path : null, []);
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
  const mock = new MockModelClient(() => ({ plan: 'x', edits: [{ cell: 'Sheet1!A1', op: 'setValue', value: 1 }] }));
  const cs = await new Agent(mock, undefined, lib).propose({
    hostId: 'h1',
    format: 'excel',
    intent: '把金额列补齐',
    baseRev: 0 as DocRev,
    anchors: [],
    context: '',
  });
  assert.equal(cs.edits.length, 1);
  assert.equal(lib.match('把金额列补齐', 'excel')[0]!.name, 'xlsx'); // library matches the Excel skill
});

test('Agent skill tools expose namespaced metadata and filter skills outside current capabilities', async () => {
  const lib = defaultLibrary();
  lib.install(`---\nname: chart-writer\nnamespace: user\nversion: 1.0.0\ndescription: create charts\nformats: [excel]\nkeywords: [chart]\nallowed_ops: [insertChart]\n---\ncreate a chart`, 'user');
  let catalog = '';
  let loaded = '';
  let blocked = '';
  const model: ModelClient = {
    proposeChangeSet: async () => { throw new Error('unused'); },
    respond: async (_req, _dialect, opts) => {
      catalog = opts?.extraTools?.exec('find_skills', { query: 'charts' }) ?? '';
      loaded = opts?.extraTools?.exec('load_skill', { name: 'otterpatch/chart-selection' }) ?? '';
      blocked = opts?.extraTools?.exec('load_skill', { name: 'user/chart-writer' }) ?? '';
      return { kind: 'answer', text: 'ok' };
    },
  };
  await new Agent(model, undefined, lib).respond({
    hostId: 'h', format: 'excel', intent: 'recommend charts', baseRev: 0 as DocRev, anchors: [], context: '',
  });

  assert.match(catalog, /otterpatch\/chart-selection/);
  assert.doesNotMatch(catalog, /user\/chart-writer/);
  assert.match(catalog, /sha256:[0-9a-f]{64}/);
  assert.match(loaded, /"untrusted_data":true/);
  assert.match(loaded, /"allowedOps":\[\]/);
  assert.match(blocked, /capability 不兼容/);
});

test('ConventionStack: 分层拼接,global→workspace→document(就近在后)', () => {
  const s = new ConventionStack()
    .add({ scope: 'document', text: '本文档正文用四号字' })
    .add({ scope: 'global', text: '日期一律 YYYY-MM-DD' });
  const r = s.render();
  assert.match(r, /约定/);
  assert.ok(r.indexOf('YYYY-MM-DD') < r.indexOf('四号字')); // global comes first, document last
});

test('conventionFromMarkdown: 去 frontmatter 取正文', () => {
  const c = conventionFromMarkdown('---\nname: x\n---\n金额保留两位小数。', 'workspace', 'AGENTS.md');
  assert.equal(c.scope, 'workspace');
  assert.equal(c.text, '金额保留两位小数。');
});

test('Agent + 约定 + 技能:都注入系统提示,不破坏产出', async () => {
  const conv = new ConventionStack().add({ scope: 'global', text: '数字保留两位小数' });
  const mock = new MockModelClient(() => ({ plan: 'x', edits: [{ cell: 'Sheet1!A1', op: 'setValue', value: 1 }] }));
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
    return { plan: 'x', edits: n < 2 ? [] : [{ cell: 'Sheet1!A1', op: 'setValue', value: 1 }] };
  });
  const cs = await new Agent(mock, undefined, undefined, undefined, {
    validator: (c) => ({ ok: c.edits.length > 0, errors: c.edits.length ? [] : ['edits 不能为空'] }),
    maxRetries: 2,
  }).propose({ hostId: 'h1', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' });
  assert.equal(n, 2); // first call empty → retry, second passes
  assert.equal(cs.edits.length, 1);
});

test('Agent reask: exhausted retries fail closed', async () => {
  let n = 0;
  const mock = new MockModelClient(() => {
    n++;
    return { plan: 'x', edits: [] };
  });
  await assert.rejects(
    () => new Agent(mock, undefined, undefined, undefined, {
      validator: () => ({ ok: false, errors: ['always fail'] }),
      maxRetries: 2,
    }).propose({ hostId: 'h1', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' }),
    /proposal validation failed: always fail/,
  );
  assert.equal(n, 3); // 1 + 2 retries
});

test('Agent respond fallback runs verifier and fails closed', async () => {
  const baseMock = new MockModelClient(() => ({ plan: 'x', edits: [] }));
  const mock = { proposeChangeSet: baseMock.proposeChangeSet.bind(baseMock) };
  await assert.rejects(
    () => new Agent(mock).respond(
      { hostId: 'h1', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' },
      { verify: async () => ({ ok: false, report: 'forced verifier failure' }) },
    ),
    /forced verifier failure/,
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

test('normalizeMessages: 合并相邻同角色,防 provider roles-must-alternate 500', () => {
  // back-to-back assistant messages caused by rapid-fire sends / answer+diff turn splitting → merged into one
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
    { role: 'user', content: '' }, // empty user message should be dropped
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

test('OpenAI forced proposal rejects truncated tool args', async () => {
  const client = new OpenAICompatModelClient({ apiKey: 'test-key', model: 'test-model' }) as unknown as {
    client: { chat: { completions: { create: () => Promise<unknown> } } };
    proposeChangeSet: OpenAICompatModelClient['proposeChangeSet'];
  };
  client.client = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: { arguments: '{"plan":"x","edits":[{"cell":"A1","op":"setValue","value":1}' } }] } }] }),
      },
    },
  };
  await assert.rejects(
    () => client.proposeChangeSet({ hostId: 'h1', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' }, excelDialect),
    /truncated|截断|输出/i,
  );
});

test('model clients enforce output-token and provider-timeout budgets', () => {
  assert.throws(
    () => new OpenAICompatModelClient({ apiKey: 'x', model: 'test', maxTokens: RESOURCE_LIMITS.maxOutputTokens + 1 }),
    (error) => error instanceof ResourceLimitError && error.resource === 'max_output_tokens',
  );
  assert.throws(
    () => new OpenAICompatModelClient({ apiKey: 'x', model: 'test', timeoutMs: RESOURCE_LIMITS.providerTimeoutMaxMs + 1 }),
    (error) => error instanceof ResourceLimitError && error.resource === 'provider_timeout_ms',
  );
});

test('OpenAI client rejects oversized model output before JSON salvage', async () => {
  const client = new OpenAICompatModelClient({ apiKey: 'test-key', model: 'test-model' }) as unknown as {
    client: { chat: { completions: { create: () => Promise<unknown> } } };
    proposeChangeSet: OpenAICompatModelClient['proposeChangeSet'];
  };
  client.client = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: { arguments: 'x'.repeat(RESOURCE_LIMITS.modelOutputChars + 1) } }] } }] }),
      },
    },
  };
  await assert.rejects(
    () => client.proposeChangeSet({ hostId: 'h1', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' }, excelDialect),
    (error) => error instanceof ResourceLimitError && error.resource === 'model_output_chars',
  );
});

const LOOP_REQ = { hostId: 'h1', format: 'excel', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: '' };
const VALID_EXCEL_PROPOSAL = { plan: 'x', edits: [{ cell: 'Sheet1!A1', op: 'setValue', value: 1 }] };

function openAiToolResponse(name: string, args: string, id: string, completionTokens = 1): unknown {
  return {
    choices: [{ message: { content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: args } }] } }],
    usage: { completion_tokens: completionTokens },
  };
}

function openAiToolStream(name: string, args: string, id: string, reasoningContent?: string, toolPreamble?: string): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      if (reasoningContent) yield { choices: [{ delta: { reasoning_content: reasoningContent } }] };
      if (toolPreamble) yield { choices: [{ delta: { content: toolPreamble } }] };
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }] } }] };
    },
  };
}

function openAiTextStream(content: string): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content } }] };
    },
  };
}

test('OpenAI stream never exposes provider reasoning_content', async () => {
  const client = new OpenAICompatModelClient({ apiKey: 'test-key', model: 'test-model' });
  const controller = new AbortController();
  const secret = 'PRIVATE_OPENAI_CHAIN_OF_THOUGHT';
  const preamble = 'PRIVATE_OPENAI_TOOL_PREAMBLE';
  let requestOptions: { signal?: AbortSignal; timeout?: number; maxRetries?: number } | undefined;
  (client as unknown as { client: { chat: { completions: { create: (_body: unknown, options: typeof requestOptions) => Promise<AsyncIterable<unknown>> } } } }).client = {
    chat: { completions: { create: async (_body, options) => {
      requestOptions = options;
      return openAiToolStream('propose_changeset', JSON.stringify(VALID_EXCEL_PROPOSAL), 't1', secret, preamble);
    } } },
  };
  const events: StreamEvent[] = [];

  const result = await client.respondStream(LOOP_REQ, excelDialect, (event) => events.push(event), { signal: controller.signal });

  assert.equal(result.kind, 'changeset');
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(events), new RegExp(preamble));
  assert.equal(requestOptions?.signal, controller.signal);
  assert.equal(requestOptions?.maxRetries, 0);
  assert.equal(typeof requestOptions?.timeout, 'number');
  assert.deepEqual(
    events.filter((event) => event.type === 'status').map((event) => event.status.phase),
    ['generating', 'ready'],
  );
});

test('public read status maps unknown tool names to a fixed category', () => {
  assert.deepEqual(readingStatus('provider_supplied_private_tool_name'), {
    phase: 'reading',
    source: 'context',
    operation: 'other',
  });
  assert.doesNotMatch(JSON.stringify(readingStatus('provider_supplied_private_tool_name')), /private_tool_name/);
  const sanitized = sanitizeStreamStatus({ phase: 'reading', source: 'spreadsheet', operation: 'read_range', raw: 'private status text' });
  assert.deepEqual(sanitized, { phase: 'reading', source: 'spreadsheet', operation: 'read_range' });
  assert.doesNotMatch(JSON.stringify(sanitized), /private status text/);
  assert.equal(sanitizeStreamStatus({ phase: 'reading', source: 'document', operation: 'read_range' }), null);
});

test('OpenAI stream releases text only after it is classified as the final answer', async () => {
  const client = new OpenAICompatModelClient({ apiKey: 'test-key', model: 'test-model' });
  let calls = 0;
  (client as unknown as { client: { chat: { completions: { create: () => Promise<AsyncIterable<unknown>> } } } }).client = {
    chat: { completions: { create: async () => openAiTextStream(++calls === 1 ? 'unclassified tool preamble' : 'final answer') } },
  };
  const events: StreamEvent[] = [];

  const result = await client.respondStream(LOOP_REQ, excelDialect, (event) => events.push(event));

  assert.deepEqual(result, { kind: 'answer', text: 'final answer' });
  assert.deepEqual(events.filter((event) => event.type === 'answer'), [{ type: 'answer', delta: 'final answer' }]);
  assert.doesNotMatch(JSON.stringify(events), /unclassified tool preamble/);
});

test('OpenAI stream cancellation reaches the SDK and returns normalized abort error without retrying', async () => {
  const client = new OpenAICompatModelClient({ apiKey: 'test-key', model: 'abort-model' });
  const controller = new AbortController();
  let calls = 0;
  (client as unknown as { client: { chat: { completions: { create: (_body: unknown, options: { signal?: AbortSignal }) => Promise<never> } } } }).client = {
    chat: { completions: { create: async (_body, options) => {
      calls++;
      return new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    } } },
  };

  const pending = client.respondStream(LOOP_REQ, excelDialect, () => undefined, { signal: controller.signal });
  controller.abort();

  await assert.rejects(
    pending,
    (error) => error instanceof Error
      && (error as Error & { code?: string }).code === 'PROVIDER_ABORTED'
      && (error as Error & { retryable?: boolean }).retryable === false,
  );
  assert.equal(calls, 1);
});

test('Anthropic transport errors use the same normalized provider taxonomy', async () => {
  const client = new AnthropicModelClient({
    apiKey: 'test-key',
    model: 'taxonomy-model',
    retryPolicy: { maxRetries: 0 },
  });
  (client as unknown as { client: { messages: { create: () => Promise<never> } } }).client = {
    messages: { create: async () => { throw Object.assign(new Error('raw overloaded response'), { status: 529, type: 'overloaded_error' }); } },
  };

  await assert.rejects(
    () => client.respond(LOOP_REQ, excelDialect),
    (error) => error instanceof Error
      && (error as Error & { code?: string }).code === 'PROVIDER_UNAVAILABLE'
      && (error as Error & { provider?: string }).provider === 'anthropic'
      && !error.message.includes('raw overloaded response'),
  );
});

test('agent loop budget tracks model/read/repair/output/time limits independently', () => {
  assert.throws(
    () => validProposalRepairs(RESOURCE_LIMITS.agentProposalRepairs + 1),
    (error) => error instanceof ResourceLimitError && error.resource === 'agent_proposal_repairs',
  );

  const repairs = new AgentLoopBudget(1);
  assert.equal(repairs.tryTruncationRepair(), true);
  assert.equal(repairs.tryTruncationRepair(), false);
  assert.equal(repairs.tryProposalRepair(), true, 'truncation must not consume proposal repairs');
  assert.equal(repairs.tryProposalRepair(), false);

  const reads = new AgentLoopBudget(0, { readToolCalls: 2 });
  assert.equal(reads.tryReadTools(2), true);
  assert.equal(reads.tryReadTools(1), false);

  const calls = new AgentLoopBudget(0, { modelCalls: 2 });
  calls.beginModelCall();
  calls.beginModelCall();
  assert.throws(
    () => calls.beginModelCall(),
    (error) => error instanceof ResourceLimitError && error.resource === 'agent_model_calls',
  );

  const output = new AgentLoopBudget(0, { totalOutputTokens: 5 });
  output.recordOutput('abc');
  assert.throws(
    () => output.recordOutput('def'),
    (error) => error instanceof ResourceLimitError && error.resource === 'agent_total_output_tokens',
  );

  let now = 0;
  const duration = new AgentLoopBudget(0, { totalDurationMs: 10 }, () => now);
  duration.beginModelCall();
  now = 11;
  assert.throws(
    () => duration.finishStep(),
    (error) => error instanceof ResourceLimitError && error.resource === 'agent_total_duration_ms',
  );
});

test('OpenAI non-stream repair budget is a strict retry ceiling', async () => {
  const client = new OpenAICompatModelClient({ apiKey: 'test-key', model: 'test-model' });
  let calls = 0;
  (client as unknown as { client: { chat: { completions: { create: () => Promise<unknown> } } } }).client = {
    chat: { completions: { create: async () => openAiToolResponse('propose_changeset', JSON.stringify(VALID_EXCEL_PROPOSAL), `t${++calls}`) } },
  };
  const result = await client.respond(LOOP_REQ, excelDialect, {
    maxRepairs: 1,
    verify: async () => ({ ok: false, code: 'TEST_FAILURE', report: 'always invalid' }),
  });
  assert.equal(calls, 2);
  assert.equal(result.kind, 'answer');
  assert.match(result.kind === 'answer' ? result.text : '', /repair budget exhausted.*always invalid/s);
});

test('OpenAI stream repair budget is a strict retry ceiling', async () => {
  const client = new OpenAICompatModelClient({ apiKey: 'test-key', model: 'test-model' });
  let calls = 0;
  (client as unknown as { client: { chat: { completions: { create: () => Promise<AsyncIterable<unknown>> } } } }).client = {
    chat: { completions: { create: async () => openAiToolStream('propose_changeset', JSON.stringify(VALID_EXCEL_PROPOSAL), `t${++calls}`) } },
  };
  const result = await client.respondStream(LOOP_REQ, excelDialect, () => {}, {
    maxRepairs: 1,
    verify: async () => ({ ok: false, code: 'TEST_FAILURE', report: 'always invalid' }),
  });
  assert.equal(calls, 2);
  assert.equal(result.kind, 'answer');
  assert.match(result.kind === 'answer' ? result.text : '', /repair budget exhausted/);
});

test('Anthropic non-stream repair budget is a strict retry ceiling', async () => {
  const client = new AnthropicModelClient({ apiKey: 'test-key', model: 'test-model' });
  let calls = 0;
  (client as unknown as { client: { messages: { create: () => Promise<unknown> } } }).client = {
    messages: { create: async () => ({
      content: [{ type: 'tool_use', id: `t${++calls}`, name: 'propose_changeset', input: VALID_EXCEL_PROPOSAL }],
      usage: { output_tokens: 1 },
    }) },
  };
  const result = await client.respond(LOOP_REQ, excelDialect, {
    maxRepairs: 1,
    verify: async () => ({ ok: false, code: 'TEST_FAILURE', report: 'always invalid' }),
  });
  assert.equal(calls, 2);
  assert.equal(result.kind, 'answer');
  assert.match(result.kind === 'answer' ? result.text : '', /repair budget exhausted/);
});

test('truncation and proposal repair budgets are independent', async () => {
  const client = new OpenAICompatModelClient({ apiKey: 'test-key', model: 'test-model' });
  let calls = 0;
  let verifies = 0;
  const truncated = '{"plan":"x","edits":[{"cell":"Sheet1!A1","op":"setValue","value":1}';
  (client as unknown as { client: { chat: { completions: { create: () => Promise<unknown> } } } }).client = {
    chat: { completions: { create: async () => {
      calls++;
      return openAiToolResponse('propose_changeset', calls === 1 ? truncated : JSON.stringify(VALID_EXCEL_PROPOSAL), `t${calls}`);
    } } },
  };
  const result = await client.respond(LOOP_REQ, excelDialect, {
    maxRepairs: 1,
    verify: async () => ({ ok: ++verifies > 1, report: 'repair proposal once' }),
  });
  assert.equal(calls, 3);
  assert.equal(verifies, 2);
  assert.equal(result.kind, 'changeset');
});

test('read-tool budget stops the loop before the ninth tool is executed', async () => {
  const client = new OpenAICompatModelClient({ apiKey: 'test-key', model: 'test-model' });
  let calls = 0;
  (client as unknown as { client: { chat: { completions: { create: () => Promise<unknown> } } } }).client = {
    chat: { completions: { create: async () => openAiToolResponse('read_range', '{"a1":"A1"}', `r${++calls}`) } },
  };
  const result = await client.respond({ ...LOOP_REQ, sheet: { a1: 'A1', values: [[1]] } }, excelDialect);
  assert.equal(calls, RESOURCE_LIMITS.agentReadToolCalls + 1);
  assert.equal(result.kind, 'answer');
  assert.match(result.kind === 'answer' ? result.text : '', /read-tool limit/);
});
