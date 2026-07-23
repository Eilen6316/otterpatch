/** 双语 i18n:中文 / English。t(中文) → 当前语言,缺译回退中文。 */
import { createContext, useContext } from 'react';
import { DICT } from './i18n-dict.js';

const STATUS_DICT: Record<string, string> = {
  '正在生成回复': 'Generating response',
  '正在检查提案': 'Checking proposal',
  '已生成可审阅改动': 'Reviewable changes generated',
  '正在重新生成截断的提案': 'Regenerating truncated proposal',
  '正在修复未通过检查的提案': 'Repairing proposal after checks',
  '正在读取数据范围': 'Reading data range',
  '正在读取文档内容': 'Reading document content',
  '正在读取任务规范': 'Reading task guidance',
  '正在读取所需上下文': 'Reading required context',
  '取消本轮请求': 'Cancel this request',
  '本轮请求已取消。': 'This request was cancelled.',
  'API Key 未通过 Provider 验证': 'The provider rejected this API key',
  '当前 API Key 无权使用该模型': 'This API key cannot access the selected model',
  'Provider 拒绝了模型请求': 'The provider rejected the model request',
  'Provider 限流,请稍后重试': 'Provider rate limit reached; retry later',
  'Provider 请求超时': 'Provider request timed out',
  'Provider 暂时不可用': 'Provider is temporarily unavailable',
  '无法连接 Provider': 'Could not reach the provider',
  'Provider 暂时熔断,请稍后重试': 'Provider circuit is open; retry later',
  'Provider 请求失败': 'Provider request failed',
  '浏览器开发连接': 'Browser development connection',
  '本机服务令牌': 'Local service token',
  '审阅令牌': 'Review token',
  '未填写本机服务令牌。请在模型设置中粘贴服务启动时显示的 POST token。': 'Enter the POST token shown when the local service started.',
  '本机服务令牌无效。请更新模型设置中的 POST token。': 'The local service token is invalid. Update the POST token in model settings.',
  'API Key 仅发送给本机服务和所选模型提供方;本机令牌仅发送给本机服务。': 'The API key is sent only to the local service and selected model provider; local tokens are sent only to the local service.',
};

export type Lang = 'zh' | 'en';

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English (United States)' },
];

/** 存量 localStorage 里可能残留已下线语言(ja/fr/ko…),读档时收敛回 zh。 */
export const asLang = (v: string | null | undefined): Lang => (v === 'en' ? 'en' : 'zh');

export type T = (zh: string) => string;

/** 以中文原文为键查当前语言译文;zh 或缺译时回退原文。 */
export function makeT(lang: Lang): T {
  return (zh: string): string => (lang === 'zh' ? zh : STATUS_DICT[zh] ?? DICT[zh]?.[lang] ?? zh);
}

export const TContext = createContext<T>((s) => s);
export const useT = (): T => useContext(TContext);
