/**
 * Pure text utilities for the Word workspace: HTML escaping and the Home→Change Case
 * family (upper/lower/title/sentence/toggle). Extracted from RichDoc.tsx so the case
 * rules are unit-testable without a DOM.
 */

/** HTML 转义(用户输入拼进 innerHTML 前必转,避免破坏 DOM/注入)。 */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

export type TextCaseMode = 'upper' | 'lower' | 'title' | 'sentence' | 'toggle';

export function transformCase(txt: string, mode: TextCaseMode): string {
  switch (mode) {
    case 'upper': return txt.toUpperCase();
    case 'lower': return txt.toLowerCase();
    case 'title': return txt.replace(/\b\w/g, (c) => c.toUpperCase());
    case 'sentence': return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
    case 'toggle': return txt.split('').map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
    default: return txt;
  }
}
