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
  '判断用户意图后再行动:① 若用户是在提问/查询/咨询(如"这列平均值多少""哪几行可能有问题""这个公式什么意思"),用 answer_user 工具给出简洁文字回答,【绝不要】修改表格;② 只有当用户明确想修改表格的内容或格式时,才调用修改工具提出改动;③ 指令含糊时,优先用 answer_user 反问澄清,而不是乱改。';

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

  /** 智能路由:tool_choice:auto + [改表工具, answer_user]。模型自己选回答还是改表。 */
  async respond(req: ProposeRequest, dialect: HostDialect): Promise<AgentResponse> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: ROUTING_PREAMBLE + '\n\n' + dialect.systemPrompt + '\n\n当前表格/选区上下文:\n' + req.context },
        { role: 'user', content: req.intent },
      ],
      tools: [
        { type: 'function', function: { name: dialect.toolName, description: dialect.toolDescription, parameters: dialect.parameters } },
        {
          type: 'function',
          function: {
            name: 'answer_user',
            description: '当用户是在提问/查询/咨询表格(而不是要修改它)时,用本工具直接给出文字回答或澄清反问。',
            parameters: { type: 'object', properties: { text: { type: 'string', description: '给用户的回答(简洁、可含数字结论)' } }, required: ['text'] },
          },
        },
      ],
      tool_choice: 'auto',
    });
    const msg = res.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    if (call?.type === 'function' && call.function.name === dialect.toolName) {
      return { kind: 'changeset', changeSet: dialect.buildChangeSet(req, JSON.parse(call.function.arguments)) };
    }
    if (call?.type === 'function' && call.function.name === 'answer_user') {
      const a = JSON.parse(call.function.arguments) as { text?: string };
      return { kind: 'answer', text: a.text ?? '' };
    }
    return { kind: 'answer', text: (msg?.content ?? '').trim() || '(模型未返回内容)' };
  }
}
