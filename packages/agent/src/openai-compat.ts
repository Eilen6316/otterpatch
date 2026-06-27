/**
 * OpenAICompatModelClient —— 覆盖所有 OpenAI 兼容接口的厂商:
 * ChatGPT/OpenAI、DeepSeek、智谱 GLM、Kimi(Moonshot)、豆包(火山方舟)、MiniMax、Gemini(OpenAI 兼容端点)。
 * 用 forced function-call 强制产出 propose_changeset。BYOK:apiKey 各厂商自带;baseURL 区分厂商。
 */
import OpenAI from 'openai';
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

export interface OpenAICompatOptions {
  apiKey?: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
}

export class OpenAICompatModelClient implements ModelClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: OpenAICompatOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  async proposeChangeSet(req: ProposeRequest): Promise<ChangeSet> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n\n选区上下文:\n' + req.context },
        { role: 'user', content: req.intent },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: PROPOSE_TOOL_NAME,
            description: PROPOSE_DESCRIPTION,
            parameters: PROPOSE_PARAMETERS as Record<string, unknown>,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: PROPOSE_TOOL_NAME } },
    });
    const call = res.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.type !== 'function') {
      throw new Error('OpenAICompatModelClient: model did not call propose_changeset');
    }
    return buildChangeSet(req, JSON.parse(call.function.arguments) as Proposal);
  }
}
