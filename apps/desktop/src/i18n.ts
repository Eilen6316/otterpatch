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
