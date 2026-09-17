/**
 * Hover-card model for per-change review cards (逐条改动的悬浮卡).
 *
 * The component keeps the DOM plumbing (event delegation, timers, popup mounting);
 * everything derivable from a change element — old/new text extraction, clipping,
 * viewport flip, anchor position — lives here as a pure function so the card rules
 * are unit-testable. Also hosts the shared ring-cursor arithmetic used by both the
 * change stepper and the comment navigator.
 */
import type { RichDocHoverCardState } from './RichDocReview.js';

/** Minimal DOM surface the card builder needs (a real HTMLElement satisfies it). */
export interface HoverCardElement {
  getAttribute(name: string): string | null;
  querySelector(selector: string): { textContent: string | null } | null;
  textContent: string | null;
  getBoundingClientRect(): { left: number; top: number; bottom: number; width: number };
}

export const HOVER_CARD_OPEN_DELAY_MS = 120;
export const HOVER_CARD_CLOSE_DELAY_MS = 90;
export const HOVER_CARD_TEXT_LIMIT = 48;
/** 改动离视口顶端不足此距离 → 卡片翻到改动下方显示。 */
export const HOVER_CARD_FLIP_TOP_PX = 150;

const cut = (s: string): string => (s.length > HOVER_CARD_TEXT_LIMIT ? s.slice(0, HOVER_CARD_TEXT_LIMIT) + '…' : s);

/**
 * Build the card state for a change element (`.rd-chg` / `[data-edit-block]`).
 * Returns null when the element carries no change id — nothing to show.
 * format 改动显示当前全文;insert 显示插入后的块文本(由调用方用 cleanBlockText 投影,
 * 表格会被折叠成摘要——这里不碰 DOM 清洗);replace 显示 <ins> 的新文。
 */
export function buildHoverCardState(
  element: HoverCardElement,
  options: { insertText?: () => string } = {},
): RichDocHoverCardState | null {
  const cid = element.getAttribute('data-cid');
  if (!cid) return null;
  const kind = element.getAttribute('data-kind') ?? 'replace';
  const del = element.querySelector('del');
  const ins = element.querySelector('ins');
  const rect = element.getBoundingClientRect();
  const below = rect.top < HOVER_CARD_FLIP_TOP_PX;
  const newText = kind === 'format'
    ? (element.textContent ?? '')
    : kind === 'insert'
      ? (options.insertText?.() ?? element.textContent ?? '')
      : (ins?.textContent ?? '');
  return {
    cid,
    kind,
    oldText: cut(del?.textContent ?? ''),
    newText: cut(newText),
    glyph: element.getAttribute('data-glyph') ?? '',
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(below ? rect.bottom : rect.top),
    below,
  };
}

/**
 * 环形游标步进:(current + dir + count) % count。改动导航与批注导航共用同一套
 * 取模语义——到头/到尾都回绕,dir 为正下一处、为负上一处。
 */
export function wrapCursor(current: number, direction: number, count: number): number {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
}
