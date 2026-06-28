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
import type { HostDialect, ModelClient, ProposeRequest } from './model.js';

export interface OpenAICompatOptions {
  apiKey?: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  /** 是否支持 tool_choice 强制指定函数;false 则降级(默认 true)。 */
  forcedTool?: boolean;
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

  async proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: dialect.systemPrompt + '\n\n选区上下文:\n' + req.context },
      { role: 'user', content: req.intent },
    ];
    // 不支持强制工具的厂商:用提示消息把模型推向工具调用
    if (!this.forcedTool) {
      messages.push({ role: 'user', content: `请只调用 ${dialect.toolName} 工具来完成上面的修改,不要用普通文字回答。` });
    }

    const res = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages,
      tools: [
        {
          type: 'function',
          function: {
            name: dialect.toolName,
            description: dialect.toolDescription,
            parameters: dialect.parameters,
          },
        },
      ],
      tool_choice: this.forcedTool ? { type: 'function', function: { name: dialect.toolName } } : 'auto',
    });

    const call = res.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.type !== 'function') {
      throw new Error(`OpenAICompatModelClient: model did not call ${dialect.toolName}`);
    }
    return dialect.buildChangeSet(req, JSON.parse(call.function.arguments));
  }
}
