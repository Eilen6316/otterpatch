/**
 * 多厂商 BYOK 工厂。Claude 走原生 SDK;其余 7 家走 OpenAI 兼容接口(只差 baseURL + 模型 + key)。
 * 各家默认 baseURL/模型可被 opts 覆盖(BYOK 用户自填 key,豆包等可能要填自己的 endpoint/模型名)。
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
}

export const PROVIDERS: Record<Provider, Preset> = {
  claude: { kind: 'anthropic', defaultModel: 'claude-opus-4-8', label: 'Claude (Anthropic)' },
  openai: { kind: 'openai-compat', defaultModel: 'gpt-4o', label: 'ChatGPT (OpenAI)' },
  chatgpt: { kind: 'openai-compat', defaultModel: 'gpt-4o', label: 'ChatGPT (OpenAI)' },
  deepseek: { kind: 'openai-compat', baseURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', label: 'DeepSeek' },
  glm: { kind: 'openai-compat', baseURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-plus', label: '智谱 GLM' },
  kimi: { kind: 'openai-compat', baseURL: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-32k', label: 'Kimi (Moonshot)' },
  doubao: { kind: 'openai-compat', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-pro-32k', label: '豆包 Doubao (火山方舟)' },
  minimax: { kind: 'openai-compat', baseURL: 'https://api.minimax.chat/v1', defaultModel: 'MiniMax-Text-01', label: 'MiniMax' },
  gemini: { kind: 'openai-compat', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', defaultModel: 'gemini-2.5-pro', label: 'Gemini (Google)' },
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
  return new OpenAICompatModelClient({ apiKey: opts.apiKey, model, baseURL: opts.baseURL ?? p.baseURL, maxTokens });
}
