/**
 * OpenAICompatModelClient — covers all vendors with OpenAI-compatible APIs:
 * ChatGPT/OpenAI, DeepSeek, Zhipu GLM, Kimi (Moonshot), Doubao (Volcengine Ark), MiniMax, Gemini (OpenAI-compatible endpoint).
 * Uses function-calls to produce constrained tool calls per dialect. BYOK: each vendor supplies its own apiKey; baseURL selects the vendor.
 *
 * forcedTool: vendors that support it use tool_choice to force the function (reliable); unsupported ones
 * (Kimi/MiniMax/DeepSeek reasoning models) fall back to tool_choice:'auto' + an extra nudge message
 * (forcing the tool would otherwise return HTTP 400).
 */
import OpenAI from 'openai';
import type { ChangeSet } from '@otterpatch/core';
import type { AgentResponse, HostDialect, ModelClient, ProposeRequest, RespondOptions, StreamEvent } from './model.js';
import { STEP_LIMIT, TOO_MANY_STEPS_MSG, auxToolDefs, execReadTool, parseClarify, recentHistory, respondSystem } from './sheet-tools.js';
import { NUDGE_DIRECT, NUDGE_TOOLIFY, EMPTY_RESULT_FALLBACK, TRUNCATED_FALLBACK } from './prompts/index.js';
import { salvageProposalArgs, salvageText, safeParse } from './json-salvage.js';

export interface OpenAICompatOptions {
  apiKey?: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  /** Whether tool_choice can force a specific function; false triggers the fallback (default true). */
  forcedTool?: boolean;
}

/**
 * Normalize the message sequence before sending, so a frontend thread corrupted by rapid resends /
 * failed requests does not trigger provider "roles must alternate" / "first message must be user" 400/500s:
 * - drop non-system messages with empty content;
 * - merge adjacent same-role messages (content joined with newline);
 * - drop the first message after system if it is assistant (providers require the conversation to start with user).
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
    // When the tool is not forced (incl. reasoning-model fallback): nudge the model toward a tool call with an extra message
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
      // Reasoning models (e.g. deepseek-v4-flash / reasoner) reject forced tool_choice → auto-fallback and retry
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
    return dialect.buildChangeSet(req, salvageProposalArgs(call.function.arguments));
  }

  /** Assemble messages (system + multi-turn history + current instruction) and the tool menu (edit-proposal / answer_user / read-only data / host extras). */
  private buildCtx(req: ProposeRequest, dialect: HostDialect, opts?: RespondOptions): { messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]; tools: OpenAI.Chat.Completions.ChatCompletionTool[] } {
    const messages = normalizeMessages([
      { role: 'system', content: respondSystem(dialect, req) },
      ...recentHistory(req).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: req.intent },
    ]);
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      { type: 'function', function: { name: dialect.toolName, description: dialect.toolDescription, parameters: dialect.parameters } },
      ...[...auxToolDefs(!!req.sheet, !!req.doc), ...(opts?.extraTools?.defs ?? [])].map((d) => ({ type: 'function' as const, function: { name: d.name, description: d.description, parameters: d.parameters } })),
    ];
    return { messages, tools };
  }
  /** Unified read-only tool execution: give extraTools (e.g. load_skill) first shot, then route to sheet/doc data reads. */
  private execTool(name: string, args: unknown, req: ProposeRequest, opts?: RespondOptions): string {
    const ex = opts?.extraTools?.exec(name, args);
    if (ex !== null && ex !== undefined) return ex;
    return execReadTool(name, (args ?? {}) as Record<string, unknown>, req);
  }

  /** Smart routing + multi-step loop: tool_choice:auto; the model may first call read-only tools (read_range/aggregate) to fetch data on demand, then answer or propose edits.
   *  After an edit proposal, if opts.verify is provided run a shadow validation; on failure feed the recomputed results/issue list back and let the model fix it (propose→observe→repair). */
  async respond(req: ProposeRequest, dialect: HostDialect, opts?: RespondOptions): Promise<AgentResponse> {
    const { messages, tools } = this.buildCtx(req, dialect, opts);
    let repairsLeft = opts?.maxRepairs ?? 1;
    let nudged = false;

    for (let step = 0; step < STEP_LIMIT; step++) {
      const res = await this.client.chat.completions.create({ model: this.model, max_tokens: this.maxTokens, messages, tools, tool_choice: 'auto' });
      const msg = res.choices[0]?.message;
      if (!msg) return { kind: 'answer', text: '(模型无响应)' };
      const calls = (msg.tool_calls ?? []).filter((c) => c.type === 'function');
      if (!calls.length) {
        // No tool call: empty text → nudge for a result; prose final → toolify it once
        // ("prose proposal" failure mode: plan/clarify written as raw text).
        const txt = (msg.content ?? '').trim();
        if (!nudged) { nudged = true; messages.push({ role: 'assistant', content: txt || '(已完成思考)' }); messages.push({ role: 'user', content: txt ? NUDGE_TOOLIFY : NUDGE_DIRECT }); continue; }
        return { kind: 'answer', text: txt || EMPTY_RESULT_FALLBACK };
      }

      const propose = calls.find((c) => c.function.name === dialect.toolName);
      if (propose) {
        const parsed = salvageProposalArgs(propose.function.arguments);
        if (parsed.truncated && !parsed.edits?.length && !parsed.ops?.length) return { kind: 'answer', text: TRUNCATED_FALLBACK };
        // 部分截断:抢救出了一截(如 18 条只剩 3 条,值还可能熔接)——别把残图当成品交付,回炉让模型分批重提
        if (parsed.truncated && repairsLeft > 0) {
          repairsLeft--;
          const got = (parsed.ops?.length ?? parsed.edits?.length ?? 0);
          messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: [{ id: propose.id, type: 'function', function: propose.function }] });
          messages.push({ role: 'tool', tool_call_id: propose.id, content: `你的 ${dialect.toolName} 输出在中途被截断,只完整收到前 ${got} 条,其余全部丢失(且截断处的值可能已损坏)。请立即重新提出,并【控制单次输出体积】:本批只输出前 ~8 条完整内容(style/字段只留必要项),plan 里说明"先做第一批,继续说'下一批'"。` });
          continue;
        }
        const cs = dialect.buildChangeSet(req, parsed);
        if (opts?.verify) {
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
      if (ans) return { kind: 'answer', text: salvageText(ans.function.arguments) || (msg.content ?? '').trim() };
      const ask = calls.find((c) => c.function.name === 'ask_user');
      if (ask) {
        const questions = parseClarify(ask.function.arguments);
        if (questions.length) return { kind: 'clarify', questions };
        return { kind: 'answer', text: (msg.content ?? '').trim() || EMPTY_RESULT_FALLBACK };
      }

      // Read-only tools: execute + feed results back, continue the loop
      messages.push(msg);
      for (const c of calls) {
        messages.push({ role: 'tool', tool_call_id: c.id, content: this.execTool(c.function.name, safeParse(c.function.arguments), req, opts) });
      }
    }
    return { kind: 'answer', text: TOO_MANY_STEPS_MSG };
  }

  /** Streaming variant of respond: emits reasoning (chain-of-thought) / answer (body) deltas as they are generated. Same multi-step loop + shadow-validation repair as respond. */
  async respondStream(req: ProposeRequest, dialect: HostDialect, onEvent: (e: StreamEvent) => void, opts?: RespondOptions): Promise<AgentResponse> {
    const { messages, tools } = this.buildCtx(req, dialect, opts);
    let repairsLeft = opts?.maxRepairs ?? 1;
    let nudged = false;

    for (let step = 0; step < STEP_LIMIT; step++) {
      const stream = await this.client.chat.completions.create({ model: this.model, max_tokens: this.maxTokens, messages, tools, tool_choice: 'auto', stream: true });
      let content = '';
      const toolAcc: Record<number, { id: string; name: string; args: string }> = {};
      for await (const chunk of stream) {
        const d = chunk.choices[0]?.delta;
        if (!d) continue;
        const rc = (d as { reasoning_content?: string }).reasoning_content; // chain-of-thought deltas from reasoning models such as DeepSeek
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
            // drawio: emit proposal-argument deltas so the frontend can draw the corresponding shapes on the canvas while generating
            if (dialect.format === 'drawio' && acc.name === dialect.toolName) onEvent({ type: 'draft', delta: tc.function.arguments });
          }
        }
      }
      const calls = Object.values(toolAcc).filter((c) => c.name);

      const propose = calls.find((c) => c.name === dialect.toolName);
      if (propose) {
        const parsed = salvageProposalArgs(propose.args || '{}');
        if (parsed.truncated && !parsed.edits?.length && !parsed.ops?.length) {
          const result: AgentResponse = { kind: 'answer', text: TRUNCATED_FALLBACK };
          onEvent({ type: 'done', result });
          return result;
        }
        // 部分截断 → 回炉分批(与非流式路径同语义),别把残图当成品交付
        if (parsed.truncated && repairsLeft > 0) {
          repairsLeft--;
          onEvent({ type: 'tool', name: 'retry:truncated' });
          const got = (parsed.ops?.length ?? parsed.edits?.length ?? 0);
          messages.push({ role: 'assistant', content: content || null, tool_calls: [{ id: propose.id, type: 'function' as const, function: { name: propose.name, arguments: propose.args } }] });
          messages.push({ role: 'tool', tool_call_id: propose.id, content: `你的 ${dialect.toolName} 输出在中途被截断,只完整收到前 ${got} 条,其余全部丢失(且截断处的值可能已损坏)。请立即重新提出,并【控制单次输出体积】:本批只输出前 ~8 条完整内容(style/字段只留必要项),plan 里说明"先做第一批,继续说'下一批'"。` });
          continue;
        }
        const cs = dialect.buildChangeSet(req, parsed);
        if (opts?.verify) {
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
        const result: AgentResponse = { kind: 'answer', text: salvageText(ans.args) || content.trim() };
        onEvent({ type: 'done', result });
        return result;
      }
      const ask = calls.find((c) => c.name === 'ask_user');
      if (ask) {
        const questions = parseClarify(ask.args);
        const result: AgentResponse = questions.length ? { kind: 'clarify', questions } : { kind: 'answer', text: content.trim() || EMPTY_RESULT_FALLBACK };
        onEvent({ type: 'done', result });
        return result;
      }
      if (!calls.length) {
        // Same guard as respond(): toolify prose finals once, nudge empty finals once.
        if (!nudged) { nudged = true; messages.push({ role: 'assistant', content: content.trim() || '(已完成思考)' }); messages.push({ role: 'user', content: content.trim() ? NUDGE_TOOLIFY : NUDGE_DIRECT }); continue; }
        const result: AgentResponse = { kind: 'answer', text: content.trim() || EMPTY_RESULT_FALLBACK };
        onEvent({ type: 'done', result });
        return result;
      }

      // Read-only tools: execute + feed back, continue the loop
      messages.push({ role: 'assistant', content: content || null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args } })) });
      for (const c of calls) {
        onEvent({ type: 'tool', name: c.name });
        messages.push({ role: 'tool', tool_call_id: c.id, content: this.execTool(c.name, safeParse(c.args || '{}'), req, opts) });
      }
    }
    const result: AgentResponse = { kind: 'answer', text: TOO_MANY_STEPS_MSG };
    onEvent({ type: 'done', result });
    return result;
  }
}
