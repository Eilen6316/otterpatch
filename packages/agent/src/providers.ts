/**
 * Multi-vendor BYOK factory. Claude uses the native SDK; the other 7 vendors go through
 * the OpenAI-compatible API (differing only in baseURL + model + key).
 *
 * Notes (cross-checked against litellm / one-api / new-api / vercel-ai, 2026-06):
 *  - The baseURLs are stable conclusions; model ids churn quickly, so these are only
 *    DEFAULTS and must be overridable via opts.model. In production, probe/validate
 *    with /models at startup.
 *  - forcedTool: whether the vendor supports forcing a specific function via tool_choice.
 *    Vendors with false (Kimi/MiniMax/DeepSeek reasoning models) must be downgraded —
 *    otherwise forcing a tool returns HTTP 400 (see openai-compat.ts). Our ChangeSet
 *    constrained output is correctness-sensitive, so prefer forcedTool=true models.
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
  // deepseek-chat = non-reasoning model (forced tools require non-reasoning; deepseek-reasoner returns 400 on forced tools)
  deepseek: { kind: 'openai-compat', baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', label: 'DeepSeek', forcedTool: true },
  glm: { kind: 'openai-compat', baseURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.6', label: '智谱 GLM', forcedTool: true },
  // Kimi does not support forced tools → downgrade; temperature range is [0,1] (we don't send temperature currently, so no clamp needed)
  kimi: { kind: 'openai-compat', baseURL: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-latest', label: 'Kimi (Moonshot)', forcedTool: false },
  // Doubao / Volcengine Ark: BYOK accepts a model name or your own endpoint id (ep-xxxx); Doubao 1.5+ supports forced tools
  doubao: { kind: 'openai-compat', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-1-6-251015', label: '豆包 Doubao (火山方舟)', forcedTool: true },
  // MiniMax: the .chat domain is defunct → use .io; forced tools not documented as supported → downgrade; role='developer' is strictly forbidden
  minimax: { kind: 'openai-compat', baseURL: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-M2', label: 'MiniMax', forcedTool: false },
  gemini: { kind: 'openai-compat', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', defaultModel: 'gemini-2.5-pro', label: 'Gemini (Google)', forcedTool: true },
};

export interface CreateModelOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Create a ModelClient for the given provider (BYOK). baseURL/model can override the defaults. */
export function createModelClient(provider: Provider, opts: CreateModelOptions = {}): ModelClient {
  const p = PROVIDERS[provider];
  const model = opts.model ?? p.defaultModel;
  const maxTokens = opts.maxTokens ?? 8192;
  if (p.kind === 'anthropic') {
    return new AnthropicModelClient({ apiKey: opts.apiKey, model, baseURL: opts.baseURL, maxTokens, timeoutMs: opts.timeoutMs });
  }
  return new OpenAICompatModelClient({
    apiKey: opts.apiKey,
    model,
    baseURL: opts.baseURL ?? p.baseURL,
    maxTokens,
    timeoutMs: opts.timeoutMs,
    forcedTool: p.forcedTool,
  });
}
