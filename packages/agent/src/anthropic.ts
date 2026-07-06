/**
 * AnthropicModelClient — real Claude (BYOK).
 * proposeChangeSet: forced tool call producing a constrained ChangeSet (when a sheet edit is certain / for tests).
 * respond / respondStream: multi-step agentic loop, isomorphic to the OpenAI-compatible channel —
 *   answer_user routing + on-demand data fetching via read_range/aggregate + shadow verification
 *   (propose→observe→repair), so the default Claude channel is no longer "strongest model, blindest".
 *   Shared pieces live in ./sheet-tools.
 * Default model claude-opus-4-8; if apiKey is omitted, reads ANTHROPIC_API_KEY; baseURL can be overridden for China routes.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ChangeSet } from '@otterpatch/core';
import type { AgentResponse, HostDialect, ModelClient, ProposeRequest, RespondOptions, StreamEvent } from './model.js';
import { STEP_LIMIT, TOO_MANY_STEPS_MSG, auxToolDefs, execReadTool, parseClarify, recentHistory, respondSystemParts } from './sheet-tools.js';
import { NUDGE_DIRECT, NUDGE_TOOLIFY, EMPTY_RESULT_FALLBACK, TRUNCATED_FALLBACK } from './prompts/index.js';
import { salvageProposalArgs, salvageText } from './json-salvage.js';

const safeJson = (s?: string): Record<string, unknown> => { try { return s ? (JSON.parse(s) as Record<string, unknown>) : {}; } catch { return {}; } };

export interface AnthropicOptions {
  apiKey?: string; // omitted → reads ANTHROPIC_API_KEY (BYOK)
  model?: string; // default claude-opus-4-8
  baseURL?: string; // override for China routes / proxies
  maxTokens?: number;
}

/** Normalize history: drop empties, merge adjacent same-role messages, strip leading assistant turns (Anthropic requires user-first, alternating roles). */
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
  /** Unified read-only tool execution: give extraTools (e.g. load_skill) first shot, then route to sheet/doc data fetching. */
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
  /** Split system into two blocks with prompt-cache breakpoints: stable (dialect + skills, unchanged across turns) + volatile (this turn's document snapshot).
   *  Breakpoint at the end of volatile → every step of this turn's multi-step loop (data fetch/repair, up to 8 steps) hits the full system cache; across turns at least stable hits. */
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

  /** Smart routing + multi-step loop: answer_user / read_range / aggregate; shadow-verify proposals and feed failures back for repair (propose→observe→repair). */
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
        // No tool call this turn: empty text → nudge to produce a result; non-empty prose →
        // "prose proposal" failure mode, nudge once to toolify it (routing contract: every
        // turn must end in exactly one tool call).
        if (!nudged) { nudged = true; messages.push({ role: 'assistant', content: text.trim() || '(已完成思考)' }); messages.push({ role: 'user', content: text.trim() ? NUDGE_TOOLIFY : NUDGE_DIRECT }); continue; }
        return { kind: 'answer', text: text.trim() || EMPTY_RESULT_FALLBACK };
      }

      const propose = toolUses.find((b) => b.name === dialect.toolName);
      if (propose) {
        const cs = dialect.buildChangeSet(req, propose.input);
        if (opts?.verify) {
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

      // Read-only tools: echo assistant content + one tool_result each, continue the loop
      messages.push({ role: 'assistant', content: assistantBlocks(text, toolUses) });
      messages.push({ role: 'user', content: toolUses.map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: this.execTool(b.name, b.input, req, opts) })) });
    }
    return { kind: 'answer', text: TOO_MANY_STEPS_MSG };
  }

  /** Streaming variant of respond: emits answer deltas for text (and reasoning deltas when extended thinking is on). Multi-step loop + shadow verification same as respond. */
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
        // Same guard as respond(): toolify prose finals once, nudge empty finals once.
        if (!nudged) { nudged = true; messages.push({ role: 'assistant', content: text.trim() || '(已完成思考)' }); messages.push({ role: 'user', content: text.trim() ? NUDGE_TOOLIFY : NUDGE_DIRECT }); continue; }
        const result: AgentResponse = { kind: 'answer', text: text.trim() || EMPTY_RESULT_FALLBACK };
        onEvent({ type: 'done', result });
        return result;
      }
      const propose = toolUses.find((b) => b.name === dialect.toolName);
      if (propose) {
        const parsed = salvageProposalArgs(propose.json || '{}');
        if (parsed.truncated && !parsed.edits?.length && !parsed.ops?.length) { const result: AgentResponse = { kind: 'answer', text: TRUNCATED_FALLBACK }; onEvent({ type: 'done', result }); return result; }
        const cs = dialect.buildChangeSet(req, parsed);
        if (opts?.verify) {
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

/** Rebuild assistant content blocks (optional leading text + each tool_use) so they pair with tool_results when fed back. */
function assistantBlocks(text: string, toolUses: Array<{ id: string; name: string; input: unknown }>): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (text.trim()) blocks.push({ type: 'text', text });
  for (const b of toolUses) blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
  return blocks;
}
