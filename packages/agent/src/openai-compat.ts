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
import type { AgentResponse, HostDialect, ModelClient, ProposeRequest, RespondOptions, StreamEvent } from './model.js';
import { STEP_LIMIT, TOO_MANY_STEPS_MSG, auxToolDefs, execSheetTool, recentHistory, respondSystem } from './sheet-tools.js';

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
    this.maxTokens = opts.maxTokens ?? 8192;
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

  /** 组装 system + 多轮历史 + 当前指令的消息,以及工具菜单(改表 / answer_user / 只读取数)。 */
  private buildCtx(req: ProposeRequest, dialect: HostDialect): { messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]; tools: OpenAI.Chat.Completions.ChatCompletionTool[] } {
    const messages = normalizeMessages([
      { role: 'system', content: respondSystem(dialect, req) },
      ...recentHistory(req).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: req.intent },
    ]);
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      { type: 'function', function: { name: dialect.toolName, description: dialect.toolDescription, parameters: dialect.parameters } },
      ...auxToolDefs(!!req.sheet).map((d) => ({ type: 'function' as const, function: { name: d.name, description: d.description, parameters: d.parameters } })),
    ];
    return { messages, tools };
  }

  /** 智能路由 + 多步 loop:tool_choice:auto;模型可先调只读工具(read_range/aggregate)按需取数,再回答或改表。
   *  改表提案产出后,若提供了 opts.verify 则跑一次影子校验;有问题就把重算结果/问题清单回喂,允许模型修正(propose→observe→repair)。 */
  async respond(req: ProposeRequest, dialect: HostDialect, opts?: RespondOptions): Promise<AgentResponse> {
    const { messages, tools } = this.buildCtx(req, dialect);
    let repairsLeft = opts?.maxRepairs ?? 1;

    for (let step = 0; step < STEP_LIMIT; step++) {
      const res = await this.client.chat.completions.create({ model: this.model, max_tokens: this.maxTokens, messages, tools, tool_choice: 'auto' });
      const msg = res.choices[0]?.message;
      if (!msg) return { kind: 'answer', text: '(模型无响应)' };
      const calls = (msg.tool_calls ?? []).filter((c) => c.type === 'function');
      if (!calls.length) return { kind: 'answer', text: (msg.content ?? '').trim() || '(模型未返回内容)' };

      const propose = calls.find((c) => c.function.name === dialect.toolName);
      if (propose) {
        const cs = dialect.buildChangeSet(req, JSON.parse(propose.function.arguments));
        if (opts?.verify && repairsLeft > 0) {
          const v = await opts.verify(cs);
          if (!v.ok) {
            repairsLeft--;
            messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: [{ id: propose.id, type: 'function', function: propose.function }] });
            messages.push({ role: 'tool', tool_call_id: propose.id, content: v.report });
            continue;
          }
        }
        return { kind: 'changeset', changeSet: cs };
      }
      const ans = calls.find((c) => c.function.name === 'answer_user');
      if (ans) return { kind: 'answer', text: (JSON.parse(ans.function.arguments) as { text?: string }).text ?? '' };

      // 只读工具:执行 + 把结果回喂,继续 loop
      messages.push(msg);
      for (const c of calls) {
        const args = JSON.parse(c.function.arguments) as { a1?: string; column?: string; op?: string };
        messages.push({ role: 'tool', tool_call_id: c.id, content: execSheetTool(c.function.name, args, req.sheet) });
      }
    }
    return { kind: 'answer', text: TOO_MANY_STEPS_MSG };
  }

  /** 流式版 respond:边生成边回调 reasoning(思考)/answer(正文)增量。多步 loop + 影子校验修复同 respond。 */
  async respondStream(req: ProposeRequest, dialect: HostDialect, onEvent: (e: StreamEvent) => void, opts?: RespondOptions): Promise<AgentResponse> {
    const { messages, tools } = this.buildCtx(req, dialect);
    let repairsLeft = opts?.maxRepairs ?? 1;

    for (let step = 0; step < STEP_LIMIT; step++) {
      const stream = await this.client.chat.completions.create({ model: this.model, max_tokens: this.maxTokens, messages, tools, tool_choice: 'auto', stream: true });
      let content = '';
      const toolAcc: Record<number, { id: string; name: string; args: string }> = {};
      for await (const chunk of stream) {
        const d = chunk.choices[0]?.delta;
        if (!d) continue;
        const rc = (d as { reasoning_content?: string }).reasoning_content; // DeepSeek 等思考模型的思维链增量
        if (rc) onEvent({ type: 'reasoning', delta: rc });
        if (d.content) {
          content += d.content;
          onEvent({ type: 'answer', delta: d.content });
        }
        for (const tc of d.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const acc = (toolAcc[idx] ??= { id: '', name: '', args: '' });
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) {
            acc.args += tc.function.arguments;
            // drawio:把改表提案的入参增量吐出,前端可边生成边在画板画出对应图形
            if (dialect.format === 'drawio' && acc.name === dialect.toolName) onEvent({ type: 'draft', delta: tc.function.arguments });
          }
        }
      }
      const calls = Object.values(toolAcc).filter((c) => c.name);

      const propose = calls.find((c) => c.name === dialect.toolName);
      if (propose) {
        const cs = dialect.buildChangeSet(req, JSON.parse(propose.args || '{}'));
        if (opts?.verify && repairsLeft > 0) {
          onEvent({ type: 'tool', name: 'verify' });
          const v = await opts.verify(cs);
          if (!v.ok) {
            repairsLeft--;
            messages.push({ role: 'assistant', content: content || null, tool_calls: [{ id: propose.id, type: 'function' as const, function: { name: propose.name, arguments: propose.args } }] });
            messages.push({ role: 'tool', tool_call_id: propose.id, content: v.report });
            continue;
          }
        }
        const result: AgentResponse = { kind: 'changeset', changeSet: cs };
        onEvent({ type: 'done', result });
        return result;
      }
      const ans = calls.find((c) => c.name === 'answer_user');
      if (ans) {
        const result: AgentResponse = { kind: 'answer', text: (JSON.parse(ans.args || '{}') as { text?: string }).text ?? content.trim() };
        onEvent({ type: 'done', result });
        return result;
      }
      if (!calls.length) {
        const result: AgentResponse = { kind: 'answer', text: content.trim() || '(模型未返回内容)' };
        onEvent({ type: 'done', result });
        return result;
      }

      // 只读工具:执行 + 回喂,继续 loop
      messages.push({ role: 'assistant', content: content || null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args } })) });
      for (const c of calls) {
        onEvent({ type: 'tool', name: c.name });
        const args = JSON.parse(c.args || '{}') as { a1?: string; column?: string; op?: string };
        messages.push({ role: 'tool', tool_call_id: c.id, content: execSheetTool(c.name, args, req.sheet) });
      }
    }
    const result: AgentResponse = { kind: 'answer', text: TOO_MANY_STEPS_MSG };
    onEvent({ type: 'done', result });
    return result;
  }
}
