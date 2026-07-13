import { visibleBlockFor, visibleBlocks } from './richdoc-projection.js';

export interface DocFmt {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  font?: string;
  size?: number;
  color?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  lineSpacing?: number;
  bgColor?: string;
  block?: 'h1' | 'h2' | 'h3' | 'p' | 'blockquote';
  columns?: number;
  margin?: 'narrow' | 'normal' | 'moderate' | 'wide';
  orient?: 'portrait' | 'landscape';
}

export interface DocTable {
  rows: string[][];
  headerRows: number;
  at: 'before' | 'after' | 'end';
}

export interface RichDocEditOptions {
  replacement?: string;
  fmt?: DocFmt;
  blockIdx?: number;
  removeBlock?: boolean;
  img?: { action: 'remove' | 'resize'; width?: number };
  table?: DocTable;
}

export interface RichDocRevisionPageState {
  columns?: number;
  margin?: string;
  orient?: 'portrait' | 'landscape';
}

export interface RichDocDocumentChange {
  cid: string;
  label: string;
}

export type RichDocUndoEntry =
  | { mode: 'span'; prior: DocumentFragment; el: HTMLElement }
  | { mode: 'root'; priorProps: Record<string, string>; nextProps?: Record<string, string>; priorPage?: RichDocRevisionPageState; nextPage?: RichDocRevisionPageState }
  | { mode: 'block'; prior: Element; el: HTMLElement; acceptedAnchor?: Comment }
  | { mode: 'insertBlock'; el: HTMLElement };

export interface RichDocEditContext {
  root: HTMLElement;
  undoMap: Map<string, RichDocUndoEntry>;
  page: RichDocRevisionPageState;
  documentChanges: readonly RichDocDocumentChange[];
  setPage(patch: RichDocRevisionPageState): void;
  setDocumentChanges(changes: RichDocDocumentChange[]): void;
  onMutation(): void;
}

export const RICH_DOC_BLOCK_TAGS = /^(P|H1|H2|H3|H4|LI|BLOCKQUOTE|DIV|TD|TH)$/;

const MARGIN_LABELS: Record<NonNullable<DocFmt['margin']>, string> = {
  normal: '普通',
  narrow: '窄',
  moderate: '适中',
  wide: '宽',
};

const hasInlineFormat = (format: DocFmt): boolean => format.bold != null
  || format.italic != null
  || format.underline != null
  || format.strike != null
  || format.font != null
  || format.size != null
  || format.color != null;

const hasBlockFormat = (format: DocFmt): boolean => format.align != null
  || format.lineSpacing != null
  || format.bgColor != null
  || format.block != null;

const hasPageFormat = (format: DocFmt): boolean => format.columns != null
  || format.margin != null
  || format.orient != null;

const asElement = (node: Node | null): HTMLElement | null => node?.nodeType === 1 ? node as HTMLElement : null;

const nearestBlock = (node: Node, root: HTMLElement): HTMLElement | null => {
  let current: Node | null = node;
  while (current && current !== root) {
    const element = asElement(current);
    if (element && RICH_DOC_BLOCK_TAGS.test(element.tagName)) return element;
    current = current.parentNode;
  }
  return null;
};

export const escapeCssAttribute = (value: string): string => {
  const css = globalThis.CSS;
  return css?.escape ? css.escape(value) : value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

/** Find a quote across text nodes, while rejecting matches that cross document blocks. */
export function findRange(root: HTMLElement, quote: string, from = 0): Range | null {
  if (!quote) return null;
  const ownerDocument = root.ownerDocument;
  const walker = ownerDocument.createTreeWalker(root, 4);
  const nodes: Array<{ node: Text; start: number }> = [];
  let accumulated = '';
  let current: Node | null;
  while ((current = walker.nextNode())) {
    nodes.push({ node: current as Text, start: accumulated.length });
    accumulated += (current as Text).data;
  }
  let index = accumulated.indexOf(quote, from);
  while (index >= 0) {
    const end = index + quote.length;
    let startNode: Text | undefined;
    let startOffset = 0;
    let endNode: Text | undefined;
    let endOffset = 0;
    for (const entry of nodes) {
      const length = entry.node.data.length;
      if (!startNode && index >= entry.start && index < entry.start + length) {
        startNode = entry.node;
        startOffset = index - entry.start;
      }
      if (end > entry.start && end <= entry.start + length) {
        endNode = entry.node;
        endOffset = end - entry.start;
      }
    }
    if (startNode && endNode && nearestBlock(startNode, root) === nearestBlock(endNode, root)) {
      const range = ownerDocument.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    }
    index = accumulated.indexOf(quote, index + 1);
  }
  return null;
}

/** Fall back to whitespace-collapsed matching and map the normalized hit back to a DOM range. */
function findRangeLoose(root: HTMLElement, quote: string): Range | null {
  const exact = findRange(root, quote);
  if (exact) return exact;
  const normalizedQuote = quote.replace(/\s+/g, ' ').trim();
  if (!normalizedQuote) return null;
  const ownerDocument = root.ownerDocument;
  const walker = ownerDocument.createTreeWalker(root, 4);
  const cells: Array<{ node: Text; offset: number; char: string }> = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const data = (current as Text).data;
    for (let index = 0; index < data.length; index++) cells.push({ node: current as Text, offset: index, char: data[index]! });
  }
  let normalized = '';
  const sourceIndexes: number[] = [];
  let previousWasWhitespace = false;
  for (let index = 0; index < cells.length; index++) {
    const char = cells[index]!.char;
    if (/\s/.test(char)) {
      if (!previousWasWhitespace) { normalized += ' '; sourceIndexes.push(index); }
      previousWasWhitespace = true;
    } else {
      normalized += char;
      sourceIndexes.push(index);
      previousWasWhitespace = false;
    }
  }
  let index = normalized.indexOf(normalizedQuote);
  while (index >= 0) {
    const startCell = cells[sourceIndexes[index]!]!;
    const endCell = cells[sourceIndexes[index + normalizedQuote.length - 1]!]!;
    if (nearestBlock(startCell.node, root) === nearestBlock(endCell.node, root)) {
      const range = ownerDocument.createRange();
      range.setStart(startCell.node, startCell.offset);
      range.setEnd(endCell.node, endCell.offset + 1);
      return range;
    }
    index = normalized.indexOf(normalizedQuote, index + 1);
  }
  return null;
}

export function styleSpan(element: HTMLElement, format: DocFmt): void {
  if (format.bold) element.style.fontWeight = 'bold';
  if (format.italic) element.style.fontStyle = 'italic';
  if (format.underline) element.style.textDecoration = (element.style.textDecoration ? element.style.textDecoration + ' ' : '') + 'underline';
  if (format.strike) element.style.textDecoration = (element.style.textDecoration ? element.style.textDecoration + ' ' : '') + 'line-through';
  if (format.font) element.style.fontFamily = format.font;
  if (format.size) element.style.fontSize = format.size + 'pt';
  if (format.color) element.style.color = format.color;
}

function styleBlock(element: HTMLElement, format: DocFmt): void {
  // Justification must not stretch the final line; that would be Word's distinct "distribute" alignment.
  if (format.align) { element.style.textAlign = format.align; element.style.textAlignLast = 'auto'; }
  if (format.lineSpacing) element.style.lineHeight = String(format.lineSpacing);
  if (format.bgColor) element.style.backgroundColor = format.bgColor;
}

export function isValidDocTable(value: unknown): value is DocTable {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DocTable>;
  if (!Array.isArray(candidate.rows) || candidate.rows.length === 0 || candidate.rows.length > 100) return false;
  const width = Array.isArray(candidate.rows[0]) ? candidate.rows[0].length : 0;
  if (width === 0 || width > 20) return false;
  if (candidate.at !== 'before' && candidate.at !== 'after' && candidate.at !== 'end') return false;
  if (!Number.isInteger(candidate.headerRows) || candidate.headerRows! < 0 || candidate.headerRows! > candidate.rows.length) return false;
  return candidate.rows.every((row) => Array.isArray(row)
    && row.length === width
    && row.every((cell) => typeof cell === 'string' && cell.length <= 10_000));
}

export function documentFormatLabel(format: DocFmt): string {
  return [
    format.font,
    format.size ? format.size + 'pt' : '',
    format.bold != null ? (format.bold ? '加粗' : '取消加粗') : '',
    format.color ?? '',
    format.align === 'justify' ? '两端对齐' : format.align === 'center' ? '居中' : '',
    format.lineSpacing ? '行距 ' + format.lineSpacing : '',
    format.columns != null ? (format.columns <= 1 ? '单栏' : format.columns + ' 栏') : '',
    format.margin ? MARGIN_LABELS[format.margin] + '边距' : '',
    format.orient ? (format.orient === 'landscape' ? '横向纸张' : '纵向纸张') : '',
  ].filter(Boolean).join(' · ') || '全文格式';
}

function makeTableElement(ownerDocument: Document, spec: DocTable): HTMLTableElement {
  const table = ownerDocument.createElement('table');
  table.className = 'rd-tbl';
  const head = spec.headerRows > 0 ? table.createTHead() : null;
  const body = table.createTBody();
  spec.rows.forEach((cells, rowIndex) => {
    const row = (rowIndex < spec.headerRows ? head : body)!.insertRow();
    cells.forEach((value) => {
      const cell = ownerDocument.createElement(rowIndex < spec.headerRows ? 'th' : 'td');
      cell.textContent = value;
      row.appendChild(cell);
    });
  });
  return table;
}

function removeArrivalClass(root: HTMLElement, element: HTMLElement, delay: number): void {
  const view = root.ownerDocument.defaultView;
  if (view) view.setTimeout(() => element.classList.remove('is-new'), delay);
  else globalThis.setTimeout(() => element.classList.remove('is-new'), delay);
}

function styleSnapshot(root: HTMLElement): Record<string, string> {
  const style = root.style;
  return {
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textDecoration: style.textDecoration,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    color: style.color,
    textAlign: style.textAlign,
    lineHeight: style.lineHeight,
    backgroundColor: style.backgroundColor,
  };
}

function isInsideRevision(node: Node, root: HTMLElement): boolean {
  let current: Node | null = node;
  while (current && current !== root) {
    const element = asElement(current);
    if (element && (element.classList.contains('rd-chg') || element.tagName === 'DEL' || element.tagName === 'INS')) return true;
    current = current.parentNode;
  }
  return false;
}

/** Apply one Agent edit and register the exact DOM snapshot needed for rejection/undo. */
export function applyRichDocEdit(context: RichDocEditContext, editId: string, quote: string, options: RichDocEditOptions): boolean {
  const { root, undoMap } = context;
  const ownerDocument = root.ownerDocument;
  if (root.querySelector(`[data-cid="${escapeCssAttribute(editId)}"]`)) return true;

  if (options.table) {
    if (!isValidDocTable(options.table)) return false;
    const spec = options.table;
    const width = spec.rows[0]!.length;
    let anchor: HTMLElement | undefined;
    if (spec.at !== 'end') {
      const range = quote ? findRangeLoose(root, quote) : null;
      anchor = range ? visibleBlockFor(root, range.startContainer) : undefined;
      if (!anchor && options.blockIdx != null) anchor = visibleBlocks(root)[options.blockIdx];
      if (!anchor) return false;
    }
    const table = makeTableElement(ownerDocument, spec);
    table.classList.add('rd-chg-blkins', 'is-new');
    table.setAttribute('data-edit-block', editId);
    table.setAttribute('data-cid', editId);
    table.setAttribute('data-kind', 'insert');
    table.setAttribute('data-glyph', '+表');
    table.setAttribute('tabindex', '0');
    table.setAttribute('contenteditable', 'false');
    table.setAttribute('aria-label', `插入 ${spec.rows.length}×${width} 表格`);
    if (spec.at === 'end') root.appendChild(table);
    else if (spec.at === 'before') anchor!.before(table);
    else anchor!.after(table);
    undoMap.set(editId, { mode: 'insertBlock', el: table });
    removeArrivalClass(root, table, 1000);
    context.onMutation();
    return true;
  }

  const format = options.fmt;
  if (!quote && format && options.blockIdx == null && !options.removeBlock && !options.img) {
    if (undoMap.has(editId) || context.documentChanges.some((change) => change.cid === editId)) return true;
    const priorProps = styleSnapshot(root);
    styleSpan(root, format);
    styleBlock(root, format);
    const nextProps = styleSnapshot(root);
    const priorPage: RichDocRevisionPageState = {
      columns: context.page.columns,
      margin: context.page.margin,
      orient: context.page.orient,
    };
    let nextPage: RichDocRevisionPageState | undefined;
    if (hasPageFormat(format)) {
      nextPage = {
        columns: format.columns != null ? format.columns : context.page.columns,
        margin: format.margin ? MARGIN_LABELS[format.margin] : context.page.margin,
        orient: format.orient ?? context.page.orient,
      };
      context.setPage(nextPage);
    }
    undoMap.set(editId, { mode: 'root', priorProps, nextProps, priorPage, ...(nextPage ? { nextPage } : {}) });
    context.setDocumentChanges([...context.documentChanges, { cid: editId, label: documentFormatLabel(format) }]);
    context.onMutation();
    return true;
  }

  let range = quote ? findRangeLoose(root, quote) : null;
  if (!range && options.blockIdx != null) {
    const block = visibleBlocks(root)[options.blockIdx];
    if (block) { range = ownerDocument.createRange(); range.selectNodeContents(block); }
  }
  if (!range || isInsideRevision(range.startContainer, root) || isInsideRevision(range.endContainer, root)) return false;

  if (options.img) {
    const block = nearestBlock(range.startContainer, root);
    if (!block) return false;
    const image = block.querySelector('img');
    if (!image) return false;
    const prior = block.cloneNode(true) as Element;
    if (options.img.action === 'remove') image.remove();
    else if (options.img.width) {
      image.style.width = options.img.width + 'px';
      image.style.height = 'auto';
      image.removeAttribute('width');
      image.removeAttribute('height');
    }
    block.setAttribute('data-edit-block', editId);
    block.setAttribute('data-cid', editId);
    block.setAttribute('data-kind', 'format');
    block.setAttribute('data-glyph', options.img.action === 'remove' ? '✕图' : '图±');
    undoMap.set(editId, { mode: 'block', prior, el: block });
    context.onMutation();
    return true;
  }

  if (options.removeBlock) {
    const block = nearestBlock(range.startContainer, root);
    if (!block) return false;
    const prior = block.cloneNode(true) as Element;
    block.classList.add('rd-chg-blkdel');
    block.setAttribute('data-edit-block', editId);
    block.setAttribute('data-cid', editId);
    block.setAttribute('data-kind', 'remove');
    block.setAttribute('data-glyph', '✕段');
    undoMap.set(editId, { mode: 'block', prior, el: block });
    context.onMutation();
    return true;
  }

  if (options.replacement == null && format && hasBlockFormat(format)) {
    const block = nearestBlock(range.startContainer, root);
    if (block) {
      const prior = block.cloneNode(true) as Element;
      if (hasInlineFormat(format)) {
        const span = ownerDocument.createElement('span');
        styleSpan(span, format);
        try { range.surroundContents(span); } catch { span.appendChild(range.extractContents()); range.insertNode(span); }
      }
      let target = block;
      if (format.block && block.tagName.toLowerCase() !== format.block) {
        target = ownerDocument.createElement(format.block);
        while (block.firstChild) target.appendChild(block.firstChild);
        block.replaceWith(target);
      }
      styleBlock(target, format);
      target.setAttribute('data-edit-block', editId);
      target.setAttribute('data-cid', editId);
      target.setAttribute('data-kind', 'format');
      target.setAttribute('data-glyph', '¶');
      undoMap.set(editId, { mode: 'block', prior, el: target });
      context.onMutation();
      return true;
    }
  }

  const prior = range.cloneContents();
  const oldText = range.toString();
  const abbreviate = (value: string): string => value.length > 60 ? value.slice(0, 60) + '…' : value;
  if (options.replacement != null) {
    const kind = oldText && options.replacement ? 'replace' : options.replacement ? 'insert' : 'delete';
    const group = ownerDocument.createElement('span');
    group.className = 'rd-chg is-new';
    group.setAttribute('data-edit', editId);
    group.setAttribute('data-cid', editId);
    group.setAttribute('data-kind', kind);
    group.setAttribute('tabindex', '0');
    group.setAttribute('contenteditable', 'false');
    group.setAttribute('aria-label', `${kind === 'replace' ? '替换' : kind === 'insert' ? '插入' : '删除'}:${abbreviate(oldText)}${oldText && options.replacement ? ' → ' : ''}${abbreviate(options.replacement)}`);
    if (oldText) {
      const deleted = ownerDocument.createElement('del');
      deleted.className = 'rd-del';
      deleted.textContent = oldText;
      group.appendChild(deleted);
    }
    if (options.replacement) {
      const inserted = ownerDocument.createElement('ins');
      inserted.className = 'rd-ins';
      if (format) styleSpan(inserted, format);
      inserted.textContent = options.replacement;
      group.appendChild(inserted);
    }
    range.deleteContents();
    range.insertNode(group);
    undoMap.set(editId, { mode: 'span', prior, el: group });
    removeArrivalClass(root, group, 1000);
  } else {
    const glyph = format?.bold ? 'B' : format?.italic ? 'I' : format?.underline ? 'U' : format?.strike ? 'S'
      : (format?.color || format?.bgColor) ? '◆' : format?.size ? 'A±' : format?.font ? 'A' : '~';
    const span = ownerDocument.createElement('span');
    span.className = 'rd-chg rd-fmt is-new';
    span.setAttribute('data-edit', editId);
    span.setAttribute('data-cid', editId);
    span.setAttribute('data-kind', 'format');
    span.setAttribute('data-glyph', glyph);
    span.setAttribute('tabindex', '0');
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('aria-label', `改格式(${glyph}):${abbreviate(oldText || quote)}`);
    if (format) styleSpan(span, format);
    span.appendChild(range.extractContents());
    range.insertNode(span);
    undoMap.set(editId, { mode: 'span', prior, el: span });
    removeArrivalClass(root, span, 1000);
  }
  context.onMutation();
  return true;
}
