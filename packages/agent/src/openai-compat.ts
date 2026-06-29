/**
 * OpenAICompatModelClient —— 覆盖所有 OpenAI 兼容接口的厂商:
 * ChatGPT/OpenAI、DeepSeek、智谱 GLM、Kimi(Moonshot)、豆包(火山方舟)、MiniMax、Gemini(OpenAI 兼容端点)。
 * 用 function-call 按 dialect 产出受约束的工具调用。BYOK:apiKey 各厂商自带;baseURL 区分厂商。
 *
 * forcedTool:支持的厂商用 tool_choice 强制指定函数(可靠);不支持的(Kimi/MiniMax/DeepSeek 思考模型)
 * 降级为 tool_choice:'auto' + 追加一条提示消息(否则强制工具会 HTTP 400)。
 */
import OpenAI from 'openai';
import type { ChangeSet } from '@otterpatch/core';
import type { AgentResponse, HostDialect, ModelClient, ProposeRequest } from './model.js';

/** 路由前导:让模型自己判断『回答问题』还是『提出改动』(配合 tool_choice:auto)。 */
const ROUTING_PREAMBLE =
  '判断用户意图后再行动:① 若用户是在提问/查询/咨询(如"这列平均值多少""哪几行可能有问题""这个公式什么意思"),用 answer_user 工具给出简洁文字回答,【绝不要】修改表格;② 只有当用户明确想修改表格的内容或格式时,才调用修改工具提出改动;③ 指令含糊时,优先用 answer_user 反问澄清,而不是乱改;④ 上下文只给了大表的样本时,需要更多精确数据就调 read_range/aggregate 工具按需取,不要凭样本臆测。';

function colLetter(n: number): string {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
function colIndex(letters: string): number {
  let c = 0;
  for (const ch of letters.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}
function startOf(a1: string): { c: number; r: number } {
  const m = /([A-Za-z]+)([0-9]+)/.exec(a1.split(':')[0] ?? 'A1');
  return { c: m ? colIndex(m[1]!) : 0, r: m ? parseInt(m[2]!, 10) - 1 : 0 };
}
/** 从整表全量数据里读任意 A1 区域,返回带引用的文本。 */
function readRange(sheet: { a1: string; values: unknown[][] }, query: string): string {
  const s = startOf(sheet.a1);
  const parts = query.replace(/^.*!/, '').replace(/[$]/g, '').split(':');
  const cell = (str: string): { c: number; r: number } => {
    const m = /([A-Za-z]+)?([0-9]+)?/.exec(str.trim());
    return { c: m && m[1] ? colIndex(m[1]) : 0, r: m && m[2] ? parseInt(m[2], 10) - 1 : 0 };
  };
  const a = cell(parts[0] ?? 'A1');
  const b = parts[1] ? cell(parts[1]) : a;
  const r0 = Math.min(a.r, b.r);
  const r1 = Math.max(a.r, b.r);
  const c0 = Math.min(a.c, b.c);
  const c1 = Math.max(a.c, b.c);
  const lines: string[] = [];
  for (let r = r0; r <= r1; r++) {
    const row = sheet.values[r - s.r];
    if (!row) continue;
    const cells: string[] = [];
    for (let c = c0; c <= c1; c++) {
      const v = row[c - s.c];
      cells.push(`${colLetter(c)}${r + 1}=${v == null || v === '' ? '(空)' : String(v)}`);
    }
    lines.push(cells.join('  '));
  }
  return lines.join('\n') || '(空)';
}
/** 对某列做聚合(跳过表头)。 */
function aggregate(sheet: { a1: string; values: unknown[][] }, column: string, op: string): string {
  const s = startOf(sheet.a1);
  const ci = colIndex(column.replace(/[^A-Za-z]/g, '') || 'A') - s.c;
  const nums: number[] = [];
  for (let i = 1; i < sheet.values.length; i++) {
    const v = sheet.values[i]?.[ci];
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,%¥$\s]/g, ''));
    if (Number.isFinite(n)) nums.push(n);
  }
  if (!nums.length) return '该列无数值';
  const sum = nums.reduce((p, q) => p + q, 0);
  if (op === 'sum') return String(sum);
  if (op === 'avg') return String(Math.round((sum / nums.length) * 1000) / 1000);
  if (op === 'min') return String(Math.min(...nums));
  if (op === 'max') return String(Math.max(...nums));
  if (op === 'count') return String(nums.length);
  return `sum=${sum} avg=${Math.round((sum / nums.length) * 100) / 100} min=${Math.min(...nums)} max=${Math.max(...nums)} count=${nums.length}`;
}

export interface OpenAICompatOptions {
  apiKey?: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  /** 是否支持 tool_choice 强制指定函数;false 则降级(默认 true)。 */
  forcedTool?: boolean;
}

/**
 * 发送前归一化消息序列,防止前端 thread 被快速连发/请求失败等写坏后,触发 provider 的
 * "roles must alternate" / "first message must be user" 400/500:
 * - 丢弃空内容的非系统消息;
 * - 合并相邻同角色消息(content 换行拼接);
 * - system 之后首条若为 assistant 则丢弃(provider 要求 user 起头)。
 */
export function normalizeMessages(
  msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const m of msgs) {
    const c = typeof m.content === 'string' ? m.content : '';
    if (m.role !== 'system' && !c.trim()) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && (m.role === 'user' || m.role === 'assistant') && typeof prev.content === 'string') {
      prev.content = `${prev.content}\n${c}`;
    } else {
      out.push({ ...m });
    }
  }
  const sysCount = out[0]?.role === 'system' ? 1 : 0;
  if (out[sysCount]?.role === 'assistant') out.splice(sysCount, 1);
  return out;
}

export class OpenAICompatModelClient implements ModelClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly forcedTool: boolean;

  constructor(opts: OpenAICompatOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? 4096;
    this.forcedTool = opts.forcedTool ?? true;
  }

  private callModel(
    req: ProposeRequest,
    dialect: HostDialect,
    forced: boolean,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: dialect.systemPrompt + '\n\n选区上下文:\n' + req.context },
      { role: 'user', content: req.intent },
    ];
    // 非强制工具时(含思考模型降级):用提示消息把模型推向工具调用
    if (!forced) {
      messages.push({ role: 'user', content: `请只调用 ${dialect.toolName} 工具来完成上面的修改,不要用普通文字回答。` });
    }
    return this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages,
      tools: [
        {
          type: 'function',
          function: { name: dialect.toolName, description: dialect.toolDescription, parameters: dialect.parameters },
        },
      ],
      tool_choice: forced ? { type: 'function', function: { name: dialect.toolName } } : 'auto',
    });
  }

  async proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet> {
    let res: OpenAI.Chat.Completions.ChatCompletion;
    try {
      res = await this.callModel(req, dialect, this.forcedTool);
    } catch (e) {
      // 思考模型(如 deepseek-v4-flash / reasoner)不支持强制 tool_choice → 自动降级重试
      const msg = e instanceof Error ? e.message : String(e);
      if (this.forcedTool && /tool_choice|thinking/i.test(msg)) {
        res = await this.callModel(req, dialect, false);
      } else {
        throw e;
      }
    }

    const call = res.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.type !== 'function') {
      throw new Error(`OpenAICompatModelClient: model did not call ${dialect.toolName}`);
    }
    return dialect.buildChangeSet(req, JSON.parse(call.function.arguments));
  }

  /** 智能路由 + 多步 loop:tool_choice:auto;模型可先调只读工具(read_range/aggregate)按需取数,再回答或改表。 */
  async respond(req: ProposeRequest, dialect: HostDialect): Promise<AgentResponse> {
    const messages = normalizeMessages([
      { role: 'system', content: ROUTING_PREAMBLE + '\n\n' + dialect.systemPrompt + '\n\n当前表格/选区上下文:\n' + req.context },
      // 多轮:历史对话插在 system 之后、当前指令之前,让 Agent 关联上下文
      ...(req.history ?? []).slice(-12).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: req.intent },
    ]);
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      { type: 'function', function: { name: dialect.toolName, description: dialect.toolDescription, parameters: dialect.parameters } },
      {
        type: 'function',
        function: {
          name: 'answer_user',
          description: '当用户是在提问/查询/咨询表格(而不是要修改它)时,用本工具直接给出文字回答或澄清反问。',
          parameters: { type: 'object', properties: { text: { type: 'string', description: '给用户的回答(简洁、可含数字结论)' } }, required: ['text'] },
        },
      },
    ];
    if (req.sheet) {
      tools.push(
        { type: 'function', function: { name: 'read_range', description: '读取整张表里任意 A1 区域的精确单元格值(用于超出已给样本的数据)。', parameters: { type: 'object', properties: { a1: { type: 'string', description: 'A1 区域,如 C2:C500' } }, required: ['a1'] } } },
        { type: 'function', function: { name: 'aggregate', description: '对某一整列做聚合统计(自动跳过表头行)。', parameters: { type: 'object', properties: { column: { type: 'string', description: '列字母,如 C' }, op: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count'] } }, required: ['column', 'op'] } } },
      );
    }

    for (let step = 0; step < 6; step++) {
      const res = await this.client.chat.completions.create({ model: this.model, max_tokens: this.maxTokens, messages, tools, tool_choice: 'auto' });
      const msg = res.choices[0]?.message;
      if (!msg) return { kind: 'answer', text: '(模型无响应)' };
      const calls = (msg.tool_calls ?? []).filter((c) => c.type === 'function');
      if (!calls.length) return { kind: 'answer', text: (msg.content ?? '').trim() || '(模型未返回内容)' };

      const propose = calls.find((c) => c.function.name === dialect.toolName);
      if (propose) return { kind: 'changeset', changeSet: dialect.buildChangeSet(req, JSON.parse(propose.function.arguments)) };
      const ans = calls.find((c) => c.function.name === 'answer_user');
      if (ans) return { kind: 'answer', text: (JSON.parse(ans.function.arguments) as { text?: string }).text ?? '' };

      // 只读工具:执行 + 把结果回喂,继续 loop
      messages.push(msg);
      for (const c of calls) {
        const args = JSON.parse(c.function.arguments) as { a1?: string; column?: string; op?: string };
        let result = '(unknown tool)';
        if (c.function.name === 'read_range' && req.sheet) result = readRange(req.sheet, String(args.a1 ?? ''));
        else if (c.function.name === 'aggregate' && req.sheet) result = aggregate(req.sheet, String(args.column ?? ''), String(args.op ?? ''));
        messages.push({ role: 'tool', tool_call_id: c.id, content: result });
      }
    }
    return { kind: 'answer', text: '处理步数过多,请缩小问题范围或把指令说得更具体。' };
  }
}
