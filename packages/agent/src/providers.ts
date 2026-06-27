/**
 * 多厂商 BYOK 工厂。Claude 走原生 SDK;其余 7 家走 OpenAI 兼容接口(只差 baseURL + 模型 + key)。
 *
 * 说明(核对自 litellm / one-api / new-api / vercel-ai,2026-06):
 *  - baseURL 是稳健结论;模型 id 换代很快,这里只是【默认值】,务必可被 opts.model 覆盖,
 *    生产建议启动期用 /models 探活校验。
 *  - forcedTool:该厂商是否支持 tool_choice 强制指定函数。false 的(Kimi/MiniMax/DeepSeek 思考模型)
 *    必须降级——否则强制工具会 HTTP 400(见 openai-compat.ts)。我们 ChangeSet 受约束输出对正确性敏感,
 *    应优先选 forcedTool=true 的模型。
 */
import { AnthropicModelClient } from './anthropic.js';
import { OpenAICompatModelClient } from './openai-compat.js';
import type { ModelClient } from './model.js';

export type Provider =
  | 'claude'
  | 'openai'
  | 'chatgpt'
  | 'deepseek'
  | 'glm'
  | 'kimi'
  | 'doubao'
  | 'minimax'
  | 'gemini';

interface Preset {
  kind: 'anthropic' | 'openai-compat';
  baseURL?: string;
  defaultModel: string;
  label: string;
  forcedTool: boolean;
}

export const PROVIDERS: Record<Provider, Preset> = {
  claude: { kind: 'anthropic', defaultModel: 'claude-opus-4-8', label: 'Claude (Anthropic)', forcedTool: true },
  openai: { kind: 'openai-compat', baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-5.5', label: 'ChatGPT (OpenAI)', forcedTool: true },
  chatgpt: { kind: 'openai-compat', baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-5.5', label: 'ChatGPT (OpenAI)', forcedTool: true },
  // deepseek-chat = 非思考模型(强制工具需非思考;deepseek-reasoner 思考模式对强制工具会 400)
  deepseek: { kind: 'openai-compat', baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', label: 'DeepSeek', forcedTool: true },
  glm: { kind: 'openai-compat', baseURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.6', label: '智谱 GLM', forcedTool: true },
  // Kimi 不支持强制工具 → 降级;temperature 范围 [0,1](当前不传 temperature,无需 clamp)
  kimi: { kind: 'openai-compat', baseURL: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-latest', label: 'Kimi (Moonshot)', forcedTool: false },
  // 豆包/火山方舟:BYOK 可填模型名或自己的接入点 endpoint id(ep-xxxx);豆包 1.5+ 支持强制工具
  doubao: { kind: 'openai-compat', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-1-6-251015', label: '豆包 Doubao (火山方舟)', forcedTool: true },
  // MiniMax:.chat 域名已失效 → .io;未声明支持强制工具 → 降级;严禁 role='developer'
  minimax: { kind: 'openai-compat', baseURL: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-M2', label: 'MiniMax', forcedTool: false },
  gemini: { kind: 'openai-compat', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', defaultModel: 'gemini-2.5-pro', label: 'Gemini (Google)', forcedTool: true },
};

export interface CreateModelOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  maxTokens?: number;
}

/** 按 provider 造一个 ModelClient(BYOK)。baseURL/model 可覆盖默认。 */
export function createModelClient(provider: Provider, opts: CreateModelOptions = {}): ModelClient {
  const p = PROVIDERS[provider];
  const model = opts.model ?? p.defaultModel;
  const maxTokens = opts.maxTokens ?? 4096;
  if (p.kind === 'anthropic') {
    return new AnthropicModelClient({ apiKey: opts.apiKey, model, baseURL: opts.baseURL, maxTokens });
  }
  return new OpenAICompatModelClient({
    apiKey: opts.apiKey,
    model,
    baseURL: opts.baseURL ?? p.baseURL,
    maxTokens,
    forcedTool: p.forcedTool,
  });
}
