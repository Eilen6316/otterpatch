/**
 * AnthropicModelClient —— 真实 Claude(BYOK)。
 * 用 forced tool-call 强制模型产出受约束的 propose_changeset(结构化输出)。
 * 默认模型 claude-opus-4-8(可在 opts.model 覆盖);apiKey 省略时读环境变量 ANTHROPIC_API_KEY。
 * 中国线可换 baseURL/国产可合规模型。
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ChangeSet } from '@office-agent/core';
import {
  buildChangeSet,
  PROPOSE_DESCRIPTION,
  PROPOSE_PARAMETERS,
  PROPOSE_TOOL_NAME,
  SYSTEM_PROMPT,
  type ModelClient,
  type Proposal,
  type ProposeRequest,
} from './model.js';

export interface AnthropicOptions {
  apiKey?: string; // 省略 → 读 ANTHROPIC_API_KEY(BYOK)
  model?: string; // 默认 claude-opus-4-8
  baseURL?: string; // 中国线/代理可覆盖
  maxTokens?: number;
}

const PROPOSE_TOOL: Anthropic.Tool = {
  name: PROPOSE_TOOL_NAME,
  description: PROPOSE_DESCRIPTION,
  input_schema: PROPOSE_PARAMETERS as unknown as Anthropic.Tool['input_schema'],
};

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicOptions = {}) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model ?? 'claude-opus-4-8';
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  async proposeChangeSet(req: ProposeRequest): Promise<ChangeSet> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT + '\n\n选区上下文:\n' + req.context,
      messages: [{ role: 'user', content: req.intent }],
      tools: [PROPOSE_TOOL],
      tool_choice: { type: 'tool', name: 'propose_changeset' },
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new Error('AnthropicModelClient: model did not call propose_changeset');
    }
    return buildChangeSet(req, block.input as Proposal);
  }
}
