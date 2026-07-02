/**
 * AnthropicModelClient —— 真实 Claude(BYOK)。
 * proposeChangeSet:forced tool 强制产出受约束 ChangeSet(确定要改表/测试)。
 * respond / respondStream:与 OpenAI 兼容通道同构的多步 agentic loop ——
 *   answer_user 路由 + read_range/aggregate 按需取数 + 影子校验 propose→observe→repair,
 *   让默认 Claude 通道不再"最强模型最瞎"。共享件见 ./sheet-tools。
 * 默认模型 claude-opus-4-8;apiKey 省略时读 ANTHROPIC_API_KEY;中国线可换 baseURL。
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ChangeSet } from '@otterpatch/core';
import type { AgentResponse, HostDialect, ModelClient, ProposeRequest, RespondOptions, StreamEvent } from './model.js';
import { STEP_LIMIT, TOO_MANY_STEPS_MSG, auxToolDefs, execReadTool, parseClarify, recentHistory, respondSystemParts } from './sheet-tools.js';
import { NUDGE_DIRECT, EMPTY_RESULT_FALLBACK, TRUNCATED_FALLBACK } from './prompts/index.js';
import { salvageProposalArgs, salvageText } from './json-salvage.js';

const safeJson = (s?: string): Record<string, unknown> => { try { return s ? (JSON.parse(s) as Record<string, unknown>) : {}; } catch { return {}; } };

export interface AnthropicOptions {
  apiKey?: string; // 省略 → 读 ANTHROPIC_API_KEY(BYOK)
  model?: string; // 默认 claude-opus-4-8
  baseURL?: string; // 中国线/代理可覆盖
  maxTokens?: number;
}

/** 归一化历史:丢空、并相邻同角色、去掉开头的 assistant(Anthropic 要求 user 起头、角色交替)。 */
function normalizeMessages(msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (typeof m.content === 'string' && !m.content.trim()) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && typeof prev.content === 'string' && typeof m.content === 'string') {
      prev.content = `${prev.content}\n${m.content}`;
    } else {
      out.push({ ...m });
    }
  }
  while (out.length && out[0]!.role === 'assistant') out.shift();
  return out;
}

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicOptions = {}) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model ?? 'claude-opus-4-8';
    this.maxTokens = opts.maxTokens ?? 8192;
  }

  private toolset(req: ProposeRequest, dialect: HostDialect, opts?: RespondOptions): Anthropic.Tool[] {
    const defs = [{ name: dialect.toolName, description: dialect.toolDescription, parameters: dialect.parameters }, ...auxToolDefs(!!req.sheet, !!req.doc), ...(opts?.extraTools?.defs ?? [])];
    return defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters as unknown as Anthropic.Tool['input_schema'] }));
  }
  /** 只读工具统一执行:先给 extraTools(如 load_skill)机会,再路由到 sheet/doc 取数。 */
  private execTool(name: string, input: unknown, req: ProposeRequest, opts?: RespondOptions): string {
    const ex = opts?.extraTools?.exec(name, input);
    if (ex !== null && ex !== undefined) return ex;
    return execReadTool(name, (input ?? {}) as Record<string, unknown>, req);
  }
  private initMessages(req: ProposeRequest): Anthropic.MessageParam[] {
    return normalizeMessages([
      ...recentHistory(req).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: req.intent },
    ]);
  }
  /** system 拆两块并挂 prompt cache 断点:stable(方言+技能,跨轮不变)+ volatile(本轮文档快照)。
   *  断点打在 volatile 末尾 → 同一轮的多步 loop(取数/修复,最多 8 步)每步都命中整段 system 缓存;跨轮至少命中 stable。 */
  private systemBlocks(req: ProposeRequest, dialect: HostDialect): Array<Anthropic.TextBlockParam> {
    const p = respondSystemParts(dialect, req);
    return [
      { type: 'text', text: p.stable, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: p.volatile, cache_control: { type: 'ephemeral' } },
    ];
  }

  async proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: dialect.systemPrompt + '\n\n选区上下文:\n' + req.context,
      messages: [{ role: 'user', content: req.intent }],
      tools: [{ name: dialect.toolName, description: dialect.toolDescription, input_schema: dialect.parameters as unknown as Anthropic.Tool['input_schema'] }],
      tool_choice: { type: 'tool', name: dialect.toolName },
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new Error(`AnthropicModelClient: model did not call ${dialect.toolName}`);
    }
    return dialect.buildChangeSet(req, block.input);
  }

  /** 智能路由 + 多步 loop:answer_user / read_range / aggregate;提案后影子校验,不通过则回喂修正(propose→observe→repair)。 */
  async respond(req: ProposeRequest, dialect: HostDialect, opts?: RespondOptions): Promise<AgentResponse> {
    const system = this.systemBlocks(req, dialect);
    const tools = this.toolset(req, dialect, opts);
    const messages = this.initMessages(req);
    let repairsLeft = opts?.maxRepairs ?? 1;
    let nudged = false;

    for (let step = 0; step < STEP_LIMIT; step++) {
      const res = await this.client.messages.create({ model: this.model, max_tokens: this.maxTokens, system, messages, tools, tool_choice: { type: 'auto' } });
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!toolUses.length) {
        if (!text.trim() && !nudged) { nudged = true; messages.push({ role: 'assistant', content: '(已完成思考)' }); messages.push({ role: 'user', content: NUDGE_DIRECT }); continue; }
        return { kind: 'answer', text: text.trim() || EMPTY_RESULT_FALLBACK };
      }

      const propose = toolUses.find((b) => b.name === dialect.toolName);
      if (propose) {
        const cs = dialect.buildChangeSet(req, propose.input);
        if (opts?.verify && repairsLeft > 0) {
          const v = await opts.verify(cs);
          if (!v.ok) {
            repairsLeft--;
            messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: propose.id, name: propose.name, input: propose.input }] });
            messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: propose.id, content: v.report }] });
            continue;
          }
        }
        return { kind: 'changeset', changeSet: cs };
      }
      const ans = toolUses.find((b) => b.name === 'answer_user');
      if (ans) return { kind: 'answer', text: (ans.input as { text?: string }).text ?? '' };
      const ask = toolUses.find((b) => b.name === 'ask_user');
      if (ask) {
        const questions = parseClarify(ask.input);
        if (questions.length) return { kind: 'clarify', questions };
        return { kind: 'answer', text: text.trim() || EMPTY_RESULT_FALLBACK };
      }

      // 只读工具:回显 assistant 内容 + 逐 tool_result,继续 loop
      messages.push({ role: 'assistant', content: assistantBlocks(text, toolUses) });
      messages.push({ role: 'user', content: toolUses.map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: this.execTool(b.name, b.input, req, opts) })) });
    }
    return { kind: 'answer', text: TOO_MANY_STEPS_MSG };
  }

  /** 流式版 respond:文本增量回调 answer(扩展思考开启时回调 reasoning)。多步 loop + 影子校验同 respond。 */
  async respondStream(req: ProposeRequest, dialect: HostDialect, onEvent: (e: StreamEvent) => void, opts?: RespondOptions): Promise<AgentResponse> {
    const system = this.systemBlocks(req, dialect);
    const tools = this.toolset(req, dialect, opts);
    const messages = this.initMessages(req);
    let repairsLeft = opts?.maxRepairs ?? 1;
    let nudged = false;

    for (let step = 0; step < STEP_LIMIT; step++) {
      const stream = await this.client.messages.create({ model: this.model, max_tokens: this.maxTokens, system, messages, tools, tool_choice: { type: 'auto' }, stream: true });
      let text = '';
      const acc: Record<number, { id: string; name: string; json: string }> = {};
      for await (const ev of stream) {
        if (ev.type === 'content_block_start') {
          const cb = ev.content_block;
          if (cb.type === 'tool_use') acc[ev.index] = { id: cb.id, name: cb.name, json: '' };
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta;
          if (d.type === 'text_delta') {
            text += d.text;
            onEvent({ type: 'answer', delta: d.text });
          } else if (d.type === 'input_json_delta') {
            const a = acc[ev.index];
            if (a) {
              a.json += d.partial_json;
              if (dialect.format === 'drawio' && a.name === dialect.toolName) onEvent({ type: 'draft', delta: d.partial_json });
            }
          } else if (d.type === 'thinking_delta') {
            onEvent({ type: 'reasoning', delta: d.thinking });
          }
        }
      }
      const toolUses = Object.values(acc).map((a) => ({ id: a.id, name: a.name, input: safeJson(a.json), json: a.json }));

      if (!toolUses.length) {
        if (!text.trim() && !nudged) { nudged = true; messages.push({ role: 'assistant', content: '(已完成思考)' }); messages.push({ role: 'user', content: NUDGE_DIRECT }); continue; }
        const result: AgentResponse = { kind: 'answer', text: text.trim() || EMPTY_RESULT_FALLBACK };
        onEvent({ type: 'done', result });
        return result;
      }
      const propose = toolUses.find((b) => b.name === dialect.toolName);
      if (propose) {
        const parsed = salvageProposalArgs(propose.json || '{}');
        if (parsed.truncated && !parsed.edits?.length && !parsed.ops?.length) { const result: AgentResponse = { kind: 'answer', text: TRUNCATED_FALLBACK }; onEvent({ type: 'done', result }); return result; }
        const cs = dialect.buildChangeSet(req, parsed);
        if (opts?.verify && repairsLeft > 0) {
          onEvent({ type: 'tool', name: 'verify' });
          const v = await opts.verify(cs);
          if (!v.ok) {
            repairsLeft--;
            messages.push({ role: 'assistant', content: assistantBlocks(text, [propose]) });
            messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: propose.id, content: v.report }] });
            continue;
          }
        }
        const result: AgentResponse = { kind: 'changeset', changeSet: cs };
        onEvent({ type: 'done', result });
        return result;
      }
      const ans = toolUses.find((b) => b.name === 'answer_user');
      if (ans) {
        const result: AgentResponse = { kind: 'answer', text: salvageText(ans.json) || text.trim() };
        onEvent({ type: 'done', result });
        return result;
      }
      const ask = toolUses.find((b) => b.name === 'ask_user');
      if (ask) {
        const questions = parseClarify(ask.input);
        const result: AgentResponse = questions.length ? { kind: 'clarify', questions } : { kind: 'answer', text: text.trim() || EMPTY_RESULT_FALLBACK };
        onEvent({ type: 'done', result });
        return result;
      }

      messages.push({ role: 'assistant', content: assistantBlocks(text, toolUses) });
      messages.push({
        role: 'user',
        content: toolUses.map((b) => {
          onEvent({ type: 'tool', name: b.name });
          return { type: 'tool_result' as const, tool_use_id: b.id, content: this.execTool(b.name, b.input, req, opts) };
        }),
      });
    }
    const result: AgentResponse = { kind: 'answer', text: TOO_MANY_STEPS_MSG };
    onEvent({ type: 'done', result });
    return result;
  }
}

/** 重建 assistant 内容块(可选前导文本 + 各 tool_use),供回喂时与 tool_result 配对。 */
function assistantBlocks(text: string, toolUses: Array<{ id: string; name: string; input: unknown }>): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (text.trim()) blocks.push({ type: 'text', text });
  for (const b of toolUses) blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
  return blocks;
}
