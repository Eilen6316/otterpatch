/**
 * AnthropicModelClient —— 真实 Claude(BYOK)。
 * 用 forced tool-call 强制模型按 dialect 产出受约束的工具调用(结构化输出)。
 * 默认模型 claude-opus-4-8(可在 opts.model 覆盖);apiKey 省略时读环境变量 ANTHROPIC_API_KEY。
 * 中国线可换 baseURL/国产可合规模型。
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ChangeSet } from '@opal/core';
import type { HostDialect, ModelClient, ProposeRequest } from './model.js';

export interface AnthropicOptions {
  apiKey?: string; // 省略 → 读 ANTHROPIC_API_KEY(BYOK)
  model?: string; // 默认 claude-opus-4-8
  baseURL?: string; // 中国线/代理可覆盖
  maxTokens?: number;
}

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicOptions = {}) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model ?? 'claude-opus-4-8';
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  async proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: dialect.systemPrompt + '\n\n选区上下文:\n' + req.context,
      messages: [{ role: 'user', content: req.intent }],
      tools: [
        {
          name: dialect.toolName,
          description: dialect.toolDescription,
          input_schema: dialect.parameters as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: dialect.toolName },
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new Error(`AnthropicModelClient: model did not call ${dialect.toolName}`);
    }
    return dialect.buildChangeSet(req, block.input);
  }
}
