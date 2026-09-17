/**
 * Provider 错误类型 → 友好文案的映射(中文为键,经 i18n 的 STATUS_DICT 译英文)。
 * propose 流与连接测试向导共用,避免两处各写一遍。
 */

export const PROVIDER_ERROR_TEXT: Record<string, string> = {
  authentication: 'API Key 未通过 Provider 验证',
  permission: '当前 API Key 无权使用该模型',
  invalid_request: 'Provider 拒绝了模型请求',
  rate_limit: 'Provider 限流,请稍后重试',
  timeout: 'Provider 请求超时',
  unavailable: 'Provider 暂时不可用',
  network: '无法连接 Provider',
  circuit_open: 'Provider 暂时熔断,请稍后重试',
  unknown: 'Provider 请求失败',
};

/** 流事件里的结构化错误 → 展示文案;未知类型回退事件消息。 */
export function providerErrorMessage(
  t: (zh: string) => string,
  kind: string | undefined,
  fallbackMessage?: string,
): string {
  return t(PROVIDER_ERROR_TEXT[kind ?? ''] ?? fallbackMessage ?? PROVIDER_ERROR_TEXT.unknown!);
}
