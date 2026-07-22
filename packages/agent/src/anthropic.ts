/**
 * AnthropicModelClient — real Claude (BYOK).
 * proposeChangeSet: forced tool call producing a constrained ChangeSet (when a sheet edit is certain / for tests).
 * respond / respondStream: multi-step agentic loop, isomorphic to the OpenAI-compatible channel —
 *   answer_user routing + on-demand data fetching via read_range/aggregate + declared pre-commit checks
 *   (propose→observe→repair), so the default Claude channel is no longer "strongest model, blindest".
 *   Shared pieces live in ./sheet-tools.
 * Default model claude-opus-4-8; if apiKey is omitted, reads ANTHROPIC_API_KEY; baseURL can be overridden for China routes.
 */
import Anthropic from '@anthropic-ai/sdk';
import { RESOURCE_LIMITS, ResourceLimitError, assertChangeSet, type ChangeSet } from '@otterpatch/core';
import type { AgentResponse, HostDialect, ModelCallOptions, ModelClient, ProposeRequest, RespondOptions, StreamEvent } from './model.js';
import { STEP_LIMIT, TOO_MANY_STEPS_MSG, auxToolDefs, currentRequestMessage, execReadTool, limitToolResult, parseClarify, proposalSystem, recentHistory, respondSystem, validMaxTokens, validProviderTimeout } from './sheet-tools.js';
import { NUDGE_DIRECT, NUDGE_TOOLIFY, EMPTY_RESULT_FALLBACK, TRUNCATED_FALLBACK } from './prompts/index.js';
import { salvageProposalArgs, salvageText, salvagedProposalPayload } from './json-salvage.js';
import { AgentLoopBudget, readToolLimitText, verificationFailureText } from './loop-budget.js';
import { readingStatus } from './stream-status.js';
import { ProviderCallController, type ProviderRetryPolicy } from './provider-control.js';

const safeJson = (s?: string): Record<string, unknown> => { try { return s ? (JSON.parse(s) as Record<string, unknown>) : {}; } catch { return {}; } };

export interface AnthropicOptions {
  apiKey?: string; // omitted → reads ANTHROPIC_API_KEY (BYOK)
  model?: string; // default claude-opus-4-8
  baseURL?: string; // override for China routes / proxies
  maxTokens?: number;
  timeoutMs?: number;
  provider?: string;
  retryPolicy?: Partial<ProviderRetryPolicy>;
}

function assertModelOutputChars(actual: number): void {
  if (actual > RESOURCE_LIMITS.modelOutputChars) {
    throw new ResourceLimitError('model_output_chars', RESOURCE_LIMITS.modelOutputChars, actual, 'Ask the model to return a smaller batch.');
  }
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
  private readonly timeoutMs: number;
  private readonly callControl: ProviderCallController;

  constructor(opts: AnthropicOptions = {}) {
    const timeout = validProviderTimeout(opts.timeoutMs);
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout, maxRetries: 0 });
    this.model = opts.model ?? 'claude-opus-4-8';
    this.maxTokens = validMaxTokens(opts.maxTokens);
    this.timeoutMs = timeout;
    const provider = opts.provider ?? 'anthropic';
    this.callControl = new ProviderCallController({
      provider,
      circuitKey: `${provider}:${opts.baseURL ?? 'default'}:${this.model}`,
      retryPolicy: opts.retryPolicy,
    });
  }

  private runProviderCall<T>(
    budget: AgentLoopBudget,
    signal: AbortSignal | undefined,
    call: (options: { timeout: number; maxRetries: 0; signal?: AbortSignal }) => Promise<T>,
    deferSuccess = false,
  ): Promise<T> {
    return this.callControl.run(async () => {
      const requestOptions = {
        timeout: Math.min(this.timeoutMs, budget.beginModelCall()),
        maxRetries: 0 as const,
        ...(signal ? { signal } : {}),
      };
      const result = await call(requestOptions);
      budget.finishStep();
      return result;
    }, { ...(signal ? { signal } : {}), ...(deferSuccess ? { deferSuccess: true } : {}) });
  }

  private toolset(req: ProposeRequest, dialect: HostDialect, opts?: RespondOptions): Anthropic.Tool[] {
    const defs = [{ name: dialect.toolName, description: dialect.toolDescription, parameters: dialect.parameters }, ...auxToolDefs(!!req.sheet, !!req.doc), ...(opts?.extraTools?.defs ?? [])];
    return defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters as unknown as Anthropic.Tool['input_schema'] }));
  }
  /** Unified read-only tool execution: give extraTools (e.g. load_skill) first shot, then route to sheet/doc data fetching. */
  private execTool(name: string, input: unknown, req: ProposeRequest, opts?: RespondOptions): string {
    const ex = opts?.extraTools?.exec(name, input);
    if (ex !== null && ex !== undefined) return limitToolResult(ex);
    return execReadTool(name, (input ?? {}) as Record<string, unknown>, req);
  }
  private initMessages(req: ProposeRequest): Anthropic.MessageParam[] {
    return normalizeMessages([
      ...recentHistory(req).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: currentRequestMessage(req) },
    ]);
  }
  /** Stable system block; request-specific document data lives in the user message. */
  private systemBlocks(dialect: HostDialect): Array<Anthropic.TextBlockParam> {
    return [{ type: 'text', text: respondSystem(dialect), cache_control: { type: 'ephemeral' } }];
  }

  async proposeChangeSet(req: ProposeRequest, dialect: HostDialect, opts?: ModelCallOptions): Promise<ChangeSet> {
    const budget = new AgentLoopBudget(0);
    const res = await this.runProviderCall(budget, opts?.signal, (requestOptions) => this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: proposalSystem(dialect),
      messages: [{ role: 'user', content: currentRequestMessage(req) }],
      tools: [{ name: dialect.toolName, description: dialect.toolDescription, input_schema: dialect.parameters as unknown as Anthropic.Tool['input_schema'] }],
      tool_choice: { type: 'tool', name: dialect.toolName },
    }, requestOptions));
    const output = res.content.map((block) => block.type === 'text' ? block.text : block.type === 'tool_use' ? block.name + JSON.stringify(block.input) : '').join('');
    assertModelOutputChars(output.length);
    budget.recordOutput(output, res.usage?.output_tokens);
    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new Error(`AnthropicModelClient: model did not call ${dialect.toolName}`);
    }
    const changeSet = dialect.buildChangeSet(req, block.input);
    assertChangeSet(changeSet);
    return changeSet;
  }

  /** Smart routing + multi-step loop: answer_user / read_range / aggregate; check proposals and feed failures back for repair (propose→observe→repair). */
  async respond(req: ProposeRequest, dialect: HostDialect, opts?: RespondOptions): Promise<AgentResponse> {
    const system = this.systemBlocks(dialect);
    const tools = this.toolset(req, dialect, opts);
    const messages = this.initMessages(req);
    const budget = new AgentLoopBudget(opts?.maxRepairs ?? 1);
    let nudged = false;

    for (let step = 0; step < STEP_LIMIT; step++) {
      const res = await this.runProviderCall(
        budget,
        opts?.signal,
        (requestOptions) => this.client.messages.create(
          { model: this.model, max_tokens: this.maxTokens, system, messages, tools, tool_choice: { type: 'auto' } },
          requestOptions,
        ),
      );
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const output = text + toolUses.map((tool) => tool.name + JSON.stringify(tool.input)).join('');
      assertModelOutputChars(output.length);
      budget.recordOutput(output, res.usage?.output_tokens);
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
        assertChangeSet(cs);
        if (opts?.verify) {
          const v = await opts.verify(cs);
          budget.finishStep();
          if (!v.ok) {
            if (!budget.tryProposalRepair()) return { kind: 'answer', text: verificationFailureText(v) };
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
      if (!budget.tryReadTools(toolUses.length)) return { kind: 'answer', text: readToolLimitText() };
      messages.push({ role: 'assistant', content: assistantBlocks(text, toolUses) });
      messages.push({ role: 'user', content: toolUses.map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: this.execTool(b.name, b.input, req, opts) })) });
      budget.finishStep();
    }
    return { kind: 'answer', text: TOO_MANY_STEPS_MSG };
  }

  /** Streaming variant of respond: suppresses provider thinking and emits bounded public status events. */
  async respondStream(req: ProposeRequest, dialect: HostDialect, onEvent: (e: StreamEvent) => void, opts?: RespondOptions): Promise<AgentResponse> {
    const system = this.systemBlocks(dialect);
    const tools = this.toolset(req, dialect, opts);
    const messages = this.initMessages(req);
    const budget = new AgentLoopBudget(opts?.maxRepairs ?? 1);
    let nudged = false;
    let repairAttempt = 0;
    onEvent({ type: 'status', status: { phase: 'generating' } });
    const complete = (result: AgentResponse): AgentResponse => {
      if (result.kind === 'answer' && result.text) onEvent({ type: 'answer', delta: result.text });
      onEvent({ type: 'done', result });
      return result;
    };

    for (let step = 0; step < STEP_LIMIT; step++) {
      const stream = await this.runProviderCall(
        budget,
        opts?.signal,
        (requestOptions) => this.client.messages.create(
          { model: this.model, max_tokens: this.maxTokens, system, messages, tools, tool_choice: { type: 'auto' }, stream: true },
          requestOptions,
        ),
        true,
      );
      let text = '';
      let outputChars = 0;
      const acc: Record<number, { id: string; name: string; json: string }> = {};
      for await (const ev of this.callControl.monitorStream(stream, opts?.signal)) {
        if (ev.type === 'content_block_start') {
          const cb = ev.content_block;
          if (cb.type === 'tool_use') {
            acc[ev.index] = { id: cb.id, name: cb.name, json: '' };
            outputChars += cb.id.length + cb.name.length;
            assertModelOutputChars(outputChars);
            budget.recordOutput(cb.id + cb.name);
          }
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta;
          if (d.type === 'text_delta') {
            outputChars += d.text.length;
            assertModelOutputChars(outputChars);
            budget.recordOutput(d.text);
            text += d.text;
          } else if (d.type === 'input_json_delta') {
            const a = acc[ev.index];
            if (a) {
              outputChars += d.partial_json.length;
              assertModelOutputChars(outputChars);
              budget.recordOutput(d.partial_json);
              a.json += d.partial_json;
              if (dialect.format === 'drawio' && a.name === dialect.toolName) onEvent({ type: 'draft', delta: d.partial_json });
            }
          } else if (d.type === 'thinking_delta') {
            outputChars += d.thinking.length;
            assertModelOutputChars(outputChars);
            budget.recordOutput(d.thinking);
          }
        }
      }
      budget.finishStep();
      const toolUses = Object.values(acc).map((a) => ({ id: a.id, name: a.name, input: safeJson(a.json), json: a.json }));

      if (!toolUses.length) {
        // Same guard as respond(): toolify prose finals once, nudge empty finals once.
        if (!nudged) { nudged = true; messages.push({ role: 'assistant', content: text.trim() || '(已完成思考)' }); messages.push({ role: 'user', content: text.trim() ? NUDGE_TOOLIFY : NUDGE_DIRECT }); continue; }
        const result: AgentResponse = { kind: 'answer', text: text.trim() || EMPTY_RESULT_FALLBACK };
        return complete(result);
      }
      const propose = toolUses.find((b) => b.name === dialect.toolName);
      if (propose) {
        const parsed = salvageProposalArgs(propose.json || '{}');
        if (parsed.truncated) {
          if (!budget.tryTruncationRepair()) {
            const result: AgentResponse = { kind: 'answer', text: TRUNCATED_FALLBACK };
            return complete(result);
          }
          repairAttempt++;
          onEvent({ type: 'status', status: { phase: 'repairing', attempt: repairAttempt, reason: 'truncated_output' } });
          messages.push({ role: 'assistant', content: assistantBlocks(text, [propose]) });
          messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: propose.id, content: TRUNCATED_FALLBACK }] });
          continue;
        }
        const cs = dialect.buildChangeSet(req, salvagedProposalPayload(parsed));
        assertChangeSet(cs);
        if (opts?.verify) {
          onEvent({ type: 'status', status: { phase: 'checking' } });
          const v = await opts.verify(cs);
          budget.finishStep();
          if (!v.ok) {
            if (!budget.tryProposalRepair()) {
              const result: AgentResponse = { kind: 'answer', text: verificationFailureText(v) };
              return complete(result);
            }
            repairAttempt++;
            onEvent({ type: 'status', status: { phase: 'repairing', attempt: repairAttempt, reason: 'check_failed' } });
            messages.push({ role: 'assistant', content: assistantBlocks(text, [propose]) });
            messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: propose.id, content: v.report }] });
            continue;
          }
        }
        onEvent({ type: 'status', status: { phase: 'ready', editCount: cs.edits.length } });
        const result: AgentResponse = { kind: 'changeset', changeSet: cs };
        return complete(result);
      }
      const ans = toolUses.find((b) => b.name === 'answer_user');
      if (ans) {
        const result: AgentResponse = { kind: 'answer', text: salvageText(ans.json) || text.trim() };
        return complete(result);
      }
      const ask = toolUses.find((b) => b.name === 'ask_user');
      if (ask) {
        const questions = parseClarify(ask.input);
        const result: AgentResponse = questions.length ? { kind: 'clarify', questions } : { kind: 'answer', text: text.trim() || EMPTY_RESULT_FALLBACK };
        return complete(result);
      }

      if (!budget.tryReadTools(toolUses.length)) {
        const result: AgentResponse = { kind: 'answer', text: readToolLimitText() };
        return complete(result);
      }
      messages.push({ role: 'assistant', content: assistantBlocks(text, toolUses) });
      messages.push({
        role: 'user',
        content: toolUses.map((b) => {
          onEvent({ type: 'status', status: readingStatus(b.name) });
          return { type: 'tool_result' as const, tool_use_id: b.id, content: this.execTool(b.name, b.input, req, opts) };
        }),
      });
      budget.finishStep();
    }
    const result: AgentResponse = { kind: 'answer', text: TOO_MANY_STEPS_MSG };
    return complete(result);
  }
}

/** Rebuild assistant content blocks (optional leading text + each tool_use) so they pair with tool_results when fed back. */
function assistantBlocks(text: string, toolUses: Array<{ id: string; name: string; input: unknown }>): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (text.trim()) blocks.push({ type: 'text', text });
  for (const b of toolUses) blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
  return blocks;
}
