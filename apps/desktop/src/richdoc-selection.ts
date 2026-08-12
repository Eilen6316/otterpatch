import { RICH_DOC_BLOCK_TAGS } from './richdoc-editing.js';
import { fmtBrief } from './richdoc-projection.js';
import type { FormatBrief } from './richdoc-projection.js';

export interface WordSel {
  text: string;
  block: string;
  chars: number;
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: string;
  para?: number;
}

export interface RichDocCommandState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  ul: boolean;
  ol: boolean;
  align: string;
  font: string;
  size: number;
}

export interface RichDocSelectionCapture {
  range: Range;
  wordSelection: WordSel | null;
  commandState: RichDocCommandState | null;
  hasText: boolean;
}

export interface RichDocSelectionDependencies {
  formatElement?: (element: HTMLElement) => FormatBrief;
  queryCommandState?: (command: string) => boolean;
  getStyle?: (element: HTMLElement) => Pick<CSSStyleDeclaration, 'fontFamily' | 'fontSize'>;
}

const asElement = (node: Node | null): HTMLElement | null => {
  if (!node) return null;
  if (node.nodeType === 1) return node as HTMLElement;
  return node.parentElement;
};

export function richDocSelectionBlock(anchor: Node | null, root: HTMLElement): string {
  let current: Node | null = anchor;
  while (current && current !== root) {
    const element = current.nodeType === 1 ? current as HTMLElement : null;
    if (element && RICH_DOC_BLOCK_TAGS.test(element.tagName)) {
      if (/^H[1-3]$/.test(element.tagName)) return '标题';
      if (element.tagName === 'BLOCKQUOTE') return '引用';
      if (element.tagName === 'LI') return '列表项';
      return '正文';
    }
    current = current.parentNode;
  }
  return '正文';
}

export function buildWordSelection(text: string, block: string, format: FormatBrief | null): WordSel | null {
  if (!text.trim()) return null;
  return {
    text: text.length > 400 ? text.slice(0, 400) + '…' : text,
    block,
    chars: text.length,
    ...(format ? {
      font: format.font,
      size: format.size,
      bold: format.bold,
      italic: format.italic,
      align: format.align,
    } : {}),
  };
}

export function readRichDocCommandState(
  anchor: Node | null,
  queryCommandState: (command: string) => boolean,
  getStyle: (element: HTMLElement) => Pick<CSSStyleDeclaration, 'fontFamily' | 'fontSize'>,
): RichDocCommandState | null {
  try {
    const element = asElement(anchor);
    const style = element ? getStyle(element) : { fontFamily: '', fontSize: '16px' };
    const font = style.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '';
    const pixels = parseFloat(style.fontSize);
    return {
      bold: queryCommandState('bold'),
      italic: queryCommandState('italic'),
      underline: queryCommandState('underline'),
      strike: queryCommandState('strikeThrough'),
      ul: queryCommandState('insertUnorderedList'),
      ol: queryCommandState('insertOrderedList'),
      align: queryCommandState('justifyCenter') ? 'center' : queryCommandState('justifyRight') ? 'right' : queryCommandState('justifyFull') ? 'justify' : 'left',
      font,
      size: Math.round(pixels * 0.75 * 10) / 10,
    };
  } catch {
    return null;
  }
}

export function captureRichDocSelection(
  root: HTMLElement,
  selection: Selection | null,
  dependencies: RichDocSelectionDependencies = {},
): RichDocSelectionCapture | null {
  if (!(selection && selection.rangeCount && selection.anchorNode && root.contains(selection.anchorNode))) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const text = selection.toString();
  const hasText = !!text.trim();
  const anchorElement = asElement(selection.anchorNode);
  const format = hasText && anchorElement ? (dependencies.formatElement ?? fmtBrief)(anchorElement) : null;
  const queryCommandState = dependencies.queryCommandState ?? ((command: string) => root.ownerDocument.queryCommandState(command));
  const getStyle = dependencies.getStyle ?? ((element: HTMLElement) => {
    const view = root.ownerDocument.defaultView;
    return view ? view.getComputedStyle(element) : getComputedStyle(element);
  });
  return {
    range,
    wordSelection: buildWordSelection(text, richDocSelectionBlock(selection.anchorNode, root), format),
    commandState: readRichDocCommandState(selection.anchorNode, queryCommandState, getStyle),
    hasText,
  };
}
