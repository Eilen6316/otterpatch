/** 双语 i18n:中文 / English。t(中文) → 当前语言,缺译回退中文。 */
import { createContext, useContext } from 'react';
import { DICT } from './i18n-dict.js';

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
  return (zh: string): string => (lang === 'zh' ? zh : DICT[zh]?.[lang] ?? zh);
}

export const TContext = createContext<T>((s) => s);
export const useT = (): T => useContext(TContext);
