export const RICH_TEXT_BLOCK_SELECTOR = 'p,h1,h2,h3,h4,li,blockquote';
const DOCUMENT_BLOCK_SELECTOR = `${RICH_TEXT_BLOCK_SELECTOR},table`;

const SAFE_HTML_TAGS = new Set([
  'A', 'B', 'BR', 'BLOCKQUOTE', 'CAPTION', 'CIRCLE', 'CODE', 'COL', 'COLGROUP', 'DD', 'DEL', 'DIV', 'DL', 'DT', 'EM', 'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'HR', 'I', 'IMG', 'INS', 'LI', 'LINE', 'NAV', 'OL', 'P', 'PATH', 'POLYGON', 'POLYLINE', 'PRE', 'RECT', 'RT', 'RUBY', 'SECTION', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'SVG', 'TABLE', 'TBODY', 'TD', 'TEXT', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
]);
const SAFE_URI_ATTRS = new Set(['href', 'src']);
const SAFE_HTML_ATTRS = new Set([
  'alt', 'aria-label', 'class', 'colspan', 'contenteditable', 'cx', 'cy', 'd', 'data-cid', 'data-edit', 'data-edit-block', 'data-glyph', 'data-kind', 'data-label', 'data-undo', 'download', 'fill', 'height', 'href', 'id', 'r', 'rowspan', 'rx', 'ry', 'src', 'stroke', 'stroke-width', 'style', 'tabindex', 'target', 'title', 'viewbox', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2',
]);

export function safeHtmlUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === ''
    || normalized.startsWith('#')
    || normalized.startsWith('data:image/')
    || normalized.startsWith('data:application/')
    || normalized.startsWith('blob:')
    || normalized.startsWith('https://')
    || (() => {
      try {
        const url = new URL(normalized);
        return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
      } catch {
        return false;
      }
    })();
}

export function sanitizeHtml(html: string, ownerDocument: Document = document): string {
  const template = ownerDocument.createElement('template');
  template.innerHTML = html;
  const sanitizeNode = (node: Node): void => {
    if (node.nodeType === 8) { node.parentNode?.removeChild(node); return; }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (!SAFE_HTML_TAGS.has(element.tagName)) {
      const children = Array.from(element.childNodes);
      element.replaceWith(...children);
      children.forEach(sanitizeNode); // Unwrapped descendants still need their own tag/attribute checks.
      return;
    }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on') || !SAFE_HTML_ATTRS.has(name)) { element.removeAttribute(attr.name); continue; }
      if (SAFE_URI_ATTRS.has(name) && !safeHtmlUrl(value)) { element.removeAttribute(attr.name); continue; }
      if (name === 'style' && /url\s*\(|expression\s*\(|javascript:/i.test(value)) element.removeAttribute(attr.name);
    }
    Array.from(element.childNodes).forEach(sanitizeNode);
  };
  Array.from(template.content.childNodes).forEach(sanitizeNode);
  return template.innerHTML;
}

export function cleanClone(el: HTMLElement): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('del').forEach((deleted) => deleted.remove());
  return clone;
}

export interface DocumentBlockCandidate {
  getAttribute(name: string): string | null;
  parentElement: { closest(selector: string): unknown } | null;
}

export function filterVisibleDocumentBlocks<T extends DocumentBlockCandidate>(elements: readonly T[]): T[] {
  return elements.filter((element) => element.getAttribute('data-kind') !== 'remove' && !element.parentElement?.closest('table'));
}

export function visibleBlocks(root: HTMLElement): HTMLElement[] {
  return filterVisibleDocumentBlocks(Array.from(root.querySelectorAll(DOCUMENT_BLOCK_SELECTOR)) as HTMLElement[]);
}

export function tableRows(el: HTMLElement): string[][] {
  const clone = cleanClone(el);
  if (clone.tagName !== 'TABLE') return [];
  return Array.from((clone as HTMLTableElement).rows).map((row) =>
    Array.from(row.cells).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );
}

export function summarizeTableRows(rows: readonly (readonly string[])[], maxRows = 100, maxCols = 20, maxCell = 250): string {
  const columns = rows.reduce((count, row) => Math.max(count, row.length), 0);
  const preview = rows.slice(0, maxRows).map((row) => row.slice(0, maxCols).map((cell) => cell.length > maxCell ? cell.slice(0, maxCell) + '…' : cell));
  const omitted = rows.length > maxRows || columns > maxCols
    ? `,省略 ${Math.max(0, rows.length - maxRows)} 行/${Math.max(0, columns - maxCols)} 列`
    : '';
  return `[表格 ${rows.length}×${columns},rows=${JSON.stringify(preview)}${omitted}]`;
}

export function tableSummary(el: HTMLElement, maxRows = 100, maxCols = 20, maxCell = 250): string {
  return summarizeTableRows(tableRows(el), maxRows, maxCols, maxCell);
}

export function cleanBlockText(el: HTMLElement): string {
  return el.tagName === 'TABLE' ? tableSummary(el) : (cleanClone(el).textContent ?? '');
}

export function visibleBlockFor(root: HTMLElement, node: Node): HTMLElement | undefined {
  const target = node.nodeType === 1 ? node as Element : node.parentElement;
  return target ? visibleBlocks(root).find((block) => block === target || block.contains(target)) : undefined;
}

export function imgBrief(el: HTMLElement): string {
  return Array.from(el.querySelectorAll('img'))
    .map((image) => `[图片${image.alt ? ' ' + image.alt : ''}${image.width ? ' ' + image.width + '×' + image.height : ''}]`)
    .join('');
}

export function rgbToHex(rgb: string): string {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!match) return rgb;
  const hex = (value: string): string => Number(value).toString(16).padStart(2, '0');
  return ('#' + hex(match[1]!) + hex(match[2]!) + hex(match[3]!)).toLowerCase();
}

export interface FormatBrief {
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: string;
  sizeDefault: boolean;
}

export function fmtBrief(el: HTMLElement): FormatBrief {
  const view = el.ownerDocument.defaultView;
  const styleOf = (target: Element): CSSStyleDeclaration => view ? view.getComputedStyle(target) : getComputedStyle(target);
  const blockStyle = styleOf(el);
  const probeNode = el.ownerDocument.createTreeWalker(el, 4).nextNode();
  const probe = probeNode?.parentElement && el.contains(probeNode.parentElement) ? probeNode.parentElement : el;
  const textStyle = probe === el ? blockStyle : styleOf(probe);
  let sizeDefault = true;
  for (let node: HTMLElement | null = probe; node; node = node.parentElement) {
    if (node.style.fontSize) { sizeDefault = false; break; }
    if (node.classList.contains('rd-page')) break;
  }
  return {
    font: textStyle.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '',
    size: Math.round(parseFloat(textStyle.fontSize) * 0.75 * 10) / 10,
    color: rgbToHex(textStyle.color),
    bold: parseInt(textStyle.fontWeight, 10) >= 600,
    italic: textStyle.fontStyle === 'italic',
    align: blockStyle.textAlign === 'center' ? '居中' : blockStyle.textAlign === 'right' ? '右对齐'
      : (blockStyle.textAlign === 'justify' || blockStyle.textAlign === 'justify-all') ? (blockStyle.textAlignLast === 'justify' ? '分散对齐' : '两端对齐') : '左对齐',
    sizeDefault,
  };
}

export type RichDocBlockStyle = '标题1' | '标题2' | '标题3' | '标题4' | '引用' | '列表项' | '表格' | '正文';

export function blockStyleForTag(tag: string): RichDocBlockStyle {
  const normalized = tag.toLowerCase();
  return normalized === 'h1' ? '标题1' : normalized === 'h2' ? '标题2' : normalized === 'h3' ? '标题3'
    : normalized === 'h4' ? '标题4' : normalized === 'blockquote' ? '引用' : normalized === 'li' ? '列表项'
      : normalized === 'table' ? '表格' : '正文';
}

export interface ProjectionBlock {
  tag: string;
  style: RichDocBlockStyle;
  text: string;
  contextText: string;
  imageBrief: string;
  format: FormatBrief;
}

export interface RichDocSnapshotBlock {
  style: string;
  text: string;
  font?: string;
  size?: number;
  align?: string;
}

export interface RichDocSnapshot { blocks: RichDocSnapshotBlock[] }

export function readProjectionBlocks(root: HTMLElement): ProjectionBlock[] {
  return visibleBlocks(root).map((element) => {
    const tag = element.tagName.toLowerCase();
    const text = cleanBlockText(element).replace(/\s+/g, ' ').trim();
    return {
      tag,
      style: blockStyleForTag(tag),
      text,
      contextText: tag === 'table' ? tableSummary(element, 8, 8, 80) : text,
      imageBrief: imgBrief(element),
      format: fmtBrief(element),
    };
  });
}

export function documentTextFromBlocks(blocks: readonly ProjectionBlock[], fallback = ''): string {
  if (!blocks.length) return fallback.trim();
  return blocks.map((block) => block.text).filter(Boolean).join('\n');
}

export function documentSnapshotFromBlocks(blocks: readonly ProjectionBlock[]): RichDocSnapshot {
  return {
    blocks: blocks.map((block) => ({
      style: block.style,
      text: block.imageBrief + block.text,
      font: block.format.font,
      size: block.format.size,
      align: block.format.align,
    })),
  };
}

export function documentContextFromBlocks(blocks: readonly ProjectionBlock[], fallback = '(空文档)'): string {
  if (!blocks.length) return fallback;
  const fonts = new Set<string>();
  const sizes = new Set<number>();
  const colors = new Set<string>();
  const headings: string[] = [];
  const bodyCombos = new Map<string, number>();
  let truncated = 0;
  const lines = blocks.map((block, index) => {
    const format = block.format;
    if (format.font) fonts.add(format.font);
    sizes.add(format.size);
    if (format.color !== '#000000' && format.color !== '#1f2430') colors.add(format.color);
    if (/^标题/.test(block.style)) {
      const level = parseInt(block.tag.slice(1), 10);
      headings.push(`${'  '.repeat(level - 1)}H${level} 第${index + 1}段 ${block.contextText.slice(0, 30)}`);
    } else if (block.style === '正文') {
      const key = `${format.font} ${format.size}pt`;
      bodyCombos.set(key, (bodyCombos.get(key) ?? 0) + 1);
    }
    const marks = [
      block.style,
      `${format.font} ${format.size}pt${format.sizeDefault ? '(默认)' : ''}`,
      format.color !== '#000000' && format.color !== '#1f2430' ? format.color : '',
      format.bold ? '加粗' : '',
      format.italic ? '斜体' : '',
      format.align !== '左对齐' ? format.align : '',
    ].filter(Boolean).join(' · ');
    const cut = block.contextText.length > 300;
    if (cut) truncated++;
    const text = cut ? block.contextText.slice(0, 300) + '…(已截断)' : block.contextText || (block.imageBrief ? '' : '(空段)');
    return `第${index + 1}段 [${marks}]: ${block.imageBrief}${text}`;
  });
  const baseline = [...bodyCombos].sort((a, b) => b[1] - a[1]);
  const system = `样式系统: ${headings.length ? '标题树 ' + headings.length + ' 个(' + headings.slice(0, 8).join(' / ') + (headings.length > 8 ? ' …' : '') + ')' : '无标题样式段落'};正文基线 ${baseline[0] ? baseline[0][0] + '(' + baseline[0][1] + ' 段)' : '(无)'}${baseline.length > 1 ? ',另有 ' + (baseline.length - 1) + ' 种偏离基线的正文排版 ⚠ 基线不统一' : ''}`;
  const toolHint = truncated
    ? `\n(有 ${truncated} 段超长已截断:改写/引用前先用 read_blocks 取该段全文,quote 必须来自真实原文;检索用 find_text,大纲用 get_outline,排版审计用 get_style_usage。)`
    : '\n(可用工具:read_blocks 按段取全文、find_text 全文检索、get_outline 大纲、get_style_usage 样式分布。)';
  return `[Word 文档 · ${blocks.length} 段] 每段已标注它的样式/字体/字号/对齐/颜色;要改格式就据此下发带显式 scope 的 setStyle。\n${system}\n格式概览: 字体 ${[...fonts].join('、')} | 字号 ${[...sizes].sort((a, b) => a - b).join('、')}pt${colors.size ? ' | 非黑颜色 ' + [...colors].join('、') : ''}${toolHint}\n逐段:\n${lines.join('\n')}`;
}

export function getRichDocText(root: HTMLElement): string {
  return documentTextFromBlocks(readProjectionBlocks(root), cleanClone(root).textContent ?? '');
}

export function getRichDocContext(root: HTMLElement): string {
  return documentContextFromBlocks(readProjectionBlocks(root), root.innerText || '(空文档)');
}

export function getRichDocSnapshot(root: HTMLElement): RichDocSnapshot {
  return documentSnapshotFromBlocks(readProjectionBlocks(root));
}
