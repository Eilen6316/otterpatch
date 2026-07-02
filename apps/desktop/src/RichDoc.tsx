/**
 * 自控富文本「Word」编辑器 —— 仿 Microsoft Word 的多选项卡功能区(Ribbon)。
 * 复用全站 Excel 功能区的视觉系统(.ribbon/.rgroup/.rbig/.rs/.rcombo/.rstyle),做到「和 Excel 一样广」;
 * 六个选项卡:开始 / 插入 / 布局 / 引用 / 审阅 / 视图,绝大多数命令对 contentEditable【真生效】。
 * 交互全部用 onMouseDown+preventDefault 保住选区(savedRange);弹层点外部关闭。
 * Agent 改动仍由 applyEdit/revert/highlight 完全掌控地落到文档(按 editId 包裹,可逐条还原)。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { useT } from './i18n.js';
import {
  IconUndo, IconRedo, IconClipboard, IconScissors, IconCopy, IconFormatBrush,
  IconFontGrow, IconFontShrink, IconChangeCase, IconClearFormat, IconStrikethrough,
  IconSubscript, IconSuperscript, IconWordArt, IconTextEffect, IconHighlighter, IconFontColor, IconPhonetic, IconEncloseChar,
  IconBulletsRb, IconNumberingRb, IconMultilevelListRb, IconIndentDecrease, IconIndentIncrease,
  IconChineseLayoutRb, IconSortAsc, IconAlignLeft, IconAlignCenter, IconAlignRight, IconAlignJustify,
  IconLineSpacing, IconShadingRb, IconBorders, IconSearch, IconReplace, IconSelect,
  IconCoverPageRb, IconBlankPageRb, IconPageBreakRb, IconTable, IconImage, IconShapes, IconStar,
  IconSmartArt, IconBarChart, IconScreenshot, IconObject, IconAddin, IconVariantsRb, IconHelp,
  IconLink, IconBookmark, IconCrossRef, IconHeader, IconFooter, IconPageNumber, IconTextBox, IconDocPartsRb, IconDropCapRb,
  IconDateTime, IconSignatureLineRb, IconRoot, IconOmega, IconHorizontalRule,
  IconTextDirectionRb, IconMargins, IconOrientation, IconPaperSize, IconColumnsRb, IconSeparator,
  IconLineNumbersRb, IconHyphenationRb, IconGridPaperRb, IconIndentLeftRb, IconIndentRightRb,
  IconSpaceBeforeRb, IconSpaceAfterRb, IconPositionRb, IconWrapTextRb, IconBringForwardRb,
  IconSendBackwardRb, IconSelectionPaneRb, IconAlignRb, IconGroupRb, IconRotateRb,
  IconTocRb, IconAddTextRb, IconUpdateTocRb, IconFootnoteRb, IconEndnoteRb, IconNextFootnoteRb,
  IconShowNotesRb, IconCitationRb, IconManageSourcesRb, IconStylesRb, IconBibliographyRb,
  IconCaptionRb, IconTableOfFiguresRb, IconMarkEntryRb, IconIndexRb, IconUpdateIndexRb,
  IconSpellingRb, IconWordCountRb, IconTranslate, IconLanguage, IconComment, IconShowComments, IconEraser, IconPreviousRb,
  IconNextItemRb, IconTrackChangesRb, IconShowMarkupRb, IconAcceptRb, IconRejectRb,
  IconReadingViewRb, IconPageViewRb, IconWebLayoutRb, IconOutlineRb, IconRulerRb, IconGridlines,
  IconNavPaneRb, IconZoomRb, IconZoom100Rb, IconSinglePageRb, IconMultiPageRb, IconWidthRb, IconCheck,
} from './icons.js';

export interface DocFmt {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; font?: string; size?: number; color?: string;
  // 段落级(Agent 可下发,作用于 quote 所在整段)
  align?: 'left' | 'center' | 'right' | 'justify'; lineSpacing?: number; bgColor?: string;
  block?: 'h1' | 'h2' | 'h3' | 'p' | 'blockquote';
}
const INLINE_FMT = (f: DocFmt): boolean => f.bold != null || f.italic != null || f.underline != null || f.strike != null || f.font != null || f.size != null || f.color != null;
const BLOCK_FMT = (f: DocFmt): boolean => f.align != null || f.lineSpacing != null || f.bgColor != null || f.block != null;

export interface RichDocHandle {
  /** 全文纯文本(供 Agent 定位)。 */
  getText(): string;
  /** 带格式的文档上下文(逐段样式/字体/字号/对齐 + 概览)——让 Agent 看得见排版细节。 */
  getContext(): string;
  /** 落一条 Agent 改动(文本改写 replacement 或格式 fmt),按 editId 包裹,可还原。 */
  applyEdit(editId: string, quote: string, opts: { replacement?: string; fmt?: DocFmt }): boolean;
  /** 按 editId 精确还原该条改动(undoMap 缺失时按 DOM 现场兜底);false=完全找不到可还原目标。 */
  revert(editId: string): boolean;
  /** 选中/滚动到某条改动。 */
  highlight(editId: string): void;
  /** rail 悬停某条 → 点亮文档里对应改动(cid);null 清除。 */
  linkChange(cid: string | null): void;
  /** 滚动定位到该改动并闪一下(rail 点击 / 步进导航)。 */
  activateChange(cid: string): void;
  /** 接受=物理定稿:删 del、解包 ins、剥修订标识(壳降级 <span data-undo> 保住撤销窗口);null 清除态类。 */
  markResolved(cid: string, state: 'accepted' | null): void;
  /** 新提案到达=上一轮撤销窗口关闭:剥 data-undo、清 undoMap,文档回归纯净本体。 */
  closeUndoWindow(): void;
}
/** 上抛给 App 的 Word 选区(与 Excel 的 UniSel 对等,供输入区显示"已选"芯片 + 喂给 Agent 聚焦,含选区格式)。 */
export interface WordSel { text: string; block: string; chars: number; font?: string; size?: number; bold?: boolean; italic?: boolean; align?: string }

/** props 全可选(避免 Record<string,never> 与 ref 冲突)。 */
export interface RichDocProps {
  className?: string;
  onSelection?: (s: WordSel | null) => void;
  onChangeHover?: (cid: string | null) => void; // 文档里悬停某改动 → 点亮 rail 对应条
  onChangeResolve?: (cid: string, verb: 'accept' | 'reject') => void; // 行内卡片 ✓/✕ → 走 rail 的接受/拒绝
}

type IconCmp = (p: { size?: number }) => ReactNode;

const FONTS = ['宋体', '黑体', '微软雅黑', '楷体', '仿宋', '等线', 'Arial', 'Times New Roman', 'Calibri', 'Georgia'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 22, 26, 28, 36, 48, 72];
const LINE_SPACINGS = ['1.0', '1.15', '1.5', '2.0', '2.5', '3.0'];
const HILITES = ['#ffe600', '#a6ff00', '#00ffff', '#ff66cc', '#63d2ff', '#ffaa00', '#ff5555', '#c9c9c9'];
const COLORS = [
  '#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050',
  '#00b0f0', '#0070c0', '#002060', '#7030a0', '#e7492e', '#f0a500', '#2563eb', '#1a7f37', '#8b5cf6', '#0891b2',
];
const CASES: [string, string][] = [['句首字母大写', 'sentence'], ['全部小写', 'lower'], ['全部大写', 'upper'], ['每个单词首字母大写', 'title'], ['切换大小写', 'toggle']];
const EFFECTS: [string, Partial<CSSStyleDeclaration>][] = [
  ['无', {}],
  ['阴影', { textShadow: '1px 1px 2px rgba(0,0,0,.45)' }],
  ['发光', { textShadow: '0 0 6px #2563eb' }],
  ['描边', { WebkitTextStroke: '1px #2563eb', color: 'transparent' } as Partial<CSSStyleDeclaration>],
  ['渐变填充', { background: 'linear-gradient(90deg,#2563eb,#8b5cf6)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } as Partial<CSSStyleDeclaration>],
];
const BULLET_STYLES: [string, string][] = [['●  实心圆点', 'disc'], ['○  空心圆圈', 'circle'], ['■  实心方块', 'square'], ['▪  小方块', "'▪  '"]];
const NUM_STYLES: [string, string][] = [['1. 2. 3.', 'decimal'], ['a. b. c.', 'lower-alpha'], ['i. ii. iii.', 'lower-roman'], ['一、二、三、', 'cjk-ideographic']];
const CN_LAYOUTS: [string, string][] = [['带圈字符', 'enclose'], ['双行合一', 'twolines'], ['字符缩放 80%', 'scale80'], ['字符缩放 150%', 'scale150']];
const BORDERS: [string, string][] = [['无框线', 'none'], ['所有框线', 'all'], ['外侧框线', 'all'], ['上框线', 'top'], ['下框线', 'bottom'], ['左框线', 'left'], ['右框线', 'right']];
const MARGINS: [string, string, string][] = [['普通', '64px 72px', '上下 2.54 · 左右 3.18 cm'], ['窄', '24px 30px', '上下 1.27 · 左右 1.27 cm'], ['适中', '48px 60px', '上下 2.54 · 左右 1.91 cm'], ['宽', '96px 120px', '上下 2.54 · 左右 5.08 cm']];
const PAPERS: Record<string, [number, number]> = { A4: [794, 1123], Letter: [816, 1056], Legal: [816, 1344], A5: [559, 794], A3: [1123, 1587] };
const COLUMNS: [string, number][] = [['一栏', 1], ['两栏', 2], ['三栏', 3]];
const ZOOMS = [50, 75, 100, 125, 150, 200];
const DATE_FMTS = (): [string, string][] => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const wk = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()] ?? '';
  return [
    [`${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`, `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`],
    [`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`, `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`],
    [`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wk}`, `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wk}`],
    [`${p(d.getHours())}:${p(d.getMinutes())}`, `${p(d.getHours())}:${p(d.getMinutes())}`],
  ];
};
const SYMBOLS: Record<string, string[]> = {
  常用: ['—', '–', '·', '…', '、', '。', '“', '”', '‘', '’', '《', '》', '〈', '〉', '「', '」', '『', '』', '【', '】', '§', '¶', '№', '℃', '℉', '™', '©', '®'],
  数学: ['±', '×', '÷', '≠', '≈', '≤', '≥', '∞', '∑', '∏', '∫', '√', '∂', '∆', '∇', 'π', '∈', '∉', '⊂', '⊃', '∪', '∩', '∀', '∃', '°', '′', '″', '‰'],
  货币: ['¥', '$', '€', '£', '¢', '₩', '₫', '₽', '₹', '฿', '₺', '₴'],
  希腊: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'λ', 'μ', 'ξ', 'π', 'ρ', 'σ', 'τ', 'φ', 'χ', 'ψ', 'ω', 'Γ', 'Δ', 'Θ', 'Λ', 'Ξ', 'Π', 'Σ', 'Φ', 'Ω'],
  箭头: ['←', '→', '↑', '↓', '↔', '↕', '⇐', '⇒', '⇑', '⇓', '⇔', '➜', '▶', '◀', '▲', '▼', '★', '☆', '✦', '✓', '✗', '●', '○', '◆', '◇', '■', '□', '♠'],
};
const EQUATIONS = ['a² + b² = c²', '(a + b)² = a² + 2ab + b²', 'E = mc²', 'x = (−b ± √(b² − 4ac)) / 2a', 'a/b', '√x', '∑ᵢ₌₁ⁿ xᵢ', '∫ f(x) dx', 'lim (x→∞)', 'π ≈ 3.14159'];
const SHAPES: [string, string][] = [
  ['矩形', '<rect x="4" y="10" width="112" height="60" rx="4"/>'],
  ['圆角矩形', '<rect x="4" y="10" width="112" height="60" rx="16"/>'],
  ['椭圆', '<ellipse cx="60" cy="40" rx="56" ry="30"/>'],
  ['三角形', '<path d="M60 8 L114 72 L6 72 Z"/>'],
  ['直线', '<path d="M6 40 L114 40"/>'],
  ['箭头', '<path d="M6 40 L104 40 M88 26 L114 40 L88 54"/>'],
];
const WORDARTS = ['rd-wa-1', 'rd-wa-2', 'rd-wa-3', 'rd-wa-4'];
const STYLE_CELLS: [string, string, string][] = [
  ['正文', 'st-body', '正文'], ['无间隔', 'st-body', '无间隔'], ['标题1', 'st-h1', '标题 1'], ['标题2', 'st-h2', '标题 2'],
  ['标题3', 'st-h3', '标题 3'], ['标题', 'st-title', '标题'], ['副标题', 'st-sub', '副标题'], ['引用', 'st-body', '❝ 引用'], ['强调', 'st-sub', '强调'],
];

const DEMO_HTML = `
<h1>项目周报 · 2026 年第 26 周</h1>
<p>本周核心进展:OtterPatch 完成了 Excel 透视图的内联渲染,并新增了"需求模糊时主动澄清"的能力,Agent 在意图不清时会先给用户一张引导选择表。整体进度符合预期。</p>
<p>风险与问题:大模型在超长输出时偶发截断,目前已通过分批与容错解析缓解;Word 工作区的功能区已补齐到接近 Office 的广度——开始/插入/布局/引用/审阅/视图六个选项卡,字体字号、样式、表格、页面设置、目录脚注、字数统计、缩放视图都真生效。</p>
<h2>下周计划</h2>
<p>一、让 Agent 既能改写文字、也能改字体字号等格式;二、补齐行为回归测试;三、用真实模型校准澄清的边界。</p>
<p>备注:本文档为演示数据,你可以圈选任意文字,用顶部功能区手动排版,或让右侧 Agent 帮你改写、润色、统一字体字号。</p>`;

const STORAGE_KEY = 'oa.richdoc';
const TAB_KEY = 'oa.richdoc.tab';
const PAGE_KEY = 'oa.richdoc.page';
const BLOCK_TAGS = /^(P|H1|H2|H3|H4|LI|BLOCKQUOTE|DIV|TD|TH)$/;
const BLOCK_SEL = 'p,h1,h2,h3,h4,li,blockquote';

interface PageState {
  size?: string; orient?: 'portrait' | 'landscape'; margin?: string; columns?: number;
  writing?: 'v'; hyphens?: boolean; lineNums?: boolean; grid?: boolean; ruler?: boolean;
  nav?: boolean; zoom?: number; view?: 'read' | 'web' | 'outline'; spell?: boolean;
  hideComments?: boolean; track?: boolean; lang?: string;
}
interface CmdState { bold: boolean; italic: boolean; underline: boolean; strike: boolean; ul: boolean; ol: boolean; align: string; font: string; size: number }

/** HTML 转义(用户输入拼进 innerHTML 前必转,避免破坏 DOM/注入)。 */
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
/** CSS 属性选择器安全转义(domId 里可能出现任意字符)。 */
const cssq = (s: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));
/** 最近块祖先(跨块命中要拒绝:deleteContents 会把两段搅成一段)。 */
function blockOf(n: Node, root: HTMLElement): Node | null {
  let e: Node | null = n;
  while (e && e !== root) { if (e instanceof HTMLElement && BLOCK_TAGS.test(e.tagName)) return e; e = e.parentNode; }
  return null;
}
/** 去修订投影:克隆后删掉 del(未定的旧文不属于文档本体),其余原样(ins 即"改后")。 */
function cleanClone(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('del').forEach((d) => d.remove());
  return c;
}
const cleanBlockText = (el: HTMLElement): string => cleanClone(el).textContent ?? '';

/** 在 root 的文本里找到 quote 的 Range(跨文本节点);from=起始字符偏移(供"查找下一个");跨块命中自动跳到下一处。 */
function findRange(root: HTMLElement, quote: string, from = 0): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let acc = '';
  let n: Node | null;
  while ((n = walker.nextNode())) { nodes.push({ node: n as Text, start: acc.length }); acc += (n as Text).data; }
  let idx = acc.indexOf(quote, from);
  while (idx >= 0) {
    const end = idx + quote.length;
    let sNode: Text | undefined, sOff = 0, eNode: Text | undefined, eOff = 0;
    for (const { node, start } of nodes) {
      const len = node.data.length;
      if (sNode === undefined && idx >= start && idx < start + len) { sNode = node; sOff = idx - start; }
      if (end > start && end <= start + len) { eNode = node; eOff = end - start; }
    }
    if (sNode && eNode && blockOf(sNode, root) === blockOf(eNode, root)) { // 同块才算命中:文本节点拼接没有段界,"上段尾+下段头"会假匹配
      const r = document.createRange();
      r.setStart(sNode, sOff);
      r.setEnd(eNode, eOff);
      return r;
    }
    idx = acc.indexOf(quote, idx + 1);
  }
  return null;
}

/** 宽松定位:先精确;失败则按"空白折叠"匹配(容忍换行/多空格差异),把归一化命中映射回原始 Range。 */
function findRangeLoose(root: HTMLElement, quote: string): Range | null {
  const exact = findRange(root, quote);
  if (exact) return exact;
  const nq = quote.replace(/\s+/g, ' ').trim();
  if (!nq) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const cells: { node: Text; off: number; ch: string }[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) { const d = (n as Text).data; for (let i = 0; i < d.length; i++) cells.push({ node: n as Text, off: i, ch: d[i]! }); }
  let norm = '';
  const map: number[] = []; // 归一化下标 → cells 下标
  let prevWs = false;
  for (let i = 0; i < cells.length; i++) {
    const ch = cells[i]!.ch;
    if (/\s/.test(ch)) { if (!prevWs) { norm += ' '; map.push(i); } prevWs = true; }
    else { norm += ch; map.push(i); prevWs = false; }
  }
  let idx = norm.indexOf(nq);
  while (idx >= 0) {
    const startCell = cells[map[idx]!]!;
    const endCell = cells[map[idx + nq.length - 1]!]!;
    if (blockOf(startCell.node, root) === blockOf(endCell.node, root)) { // 同块守卫(与 findRange 一致)
      const r = document.createRange();
      r.setStart(startCell.node, startCell.off);
      r.setEnd(endCell.node, endCell.off + 1);
      return r;
    }
    idx = norm.indexOf(nq, idx + 1);
  }
  return null;
}

/** rgb(…) → #rrggbb(供喂给 Agent 的格式概览)。 */
function rgbToHex(rgb: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return rgb;
  const h = (x: string): string => Number(x).toString(16).padStart(2, '0');
  return ('#' + h(m[1]!) + h(m[2]!) + h(m[3]!)).toLowerCase();
}
/** 元素样式 → 简明中文格式串(段落/选区概览用)。 */
function fmtBrief(el: HTMLElement): { font: string; size: number; color: string; bold: boolean; italic: boolean; align: string } {
  const cs = getComputedStyle(el);
  return {
    font: cs.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '',
    size: Math.round(parseFloat(cs.fontSize) * 0.75 * 10) / 10,
    color: rgbToHex(cs.color),
    bold: parseInt(cs.fontWeight, 10) >= 600,
    italic: cs.fontStyle === 'italic',
    align: cs.textAlign === 'center' ? '居中' : cs.textAlign === 'right' ? '右对齐' : cs.textAlign === 'justify' || cs.textAlign === 'justify-all' ? '两端对齐' : '左对齐',
  };
}

function styleSpan(span: HTMLElement, fmt: DocFmt): void {
  if (fmt.bold) span.style.fontWeight = 'bold';
  if (fmt.italic) span.style.fontStyle = 'italic';
  if (fmt.underline) span.style.textDecoration = (span.style.textDecoration ? span.style.textDecoration + ' ' : '') + 'underline';
  if (fmt.strike) span.style.textDecoration = (span.style.textDecoration ? span.style.textDecoration + ' ' : '') + 'line-through';
  if (fmt.font) span.style.fontFamily = fmt.font;
  if (fmt.size) span.style.fontSize = fmt.size + 'pt';
  if (fmt.color) span.style.color = fmt.color;
}

/** 段落级样式(对齐/行距/底纹)落到块元素上;block(标题/正文/引用)换标签由调用方处理。 */
function styleBlockEl(el: HTMLElement, fmt: DocFmt): void {
  if (fmt.align) { el.style.textAlign = fmt.align; if (fmt.align === 'justify') el.style.textAlignLast = 'justify'; }
  if (fmt.lineSpacing) el.style.lineHeight = String(fmt.lineSpacing);
  if (fmt.bgColor) el.style.backgroundColor = fmt.bgColor;
}

const transformCase = (txt: string, mode: string): string => {
  switch (mode) {
    case 'upper': return txt.toUpperCase();
    case 'lower': return txt.toLowerCase();
    case 'title': return txt.replace(/\b\w/g, (c) => c.toUpperCase());
    case 'sentence': return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
    case 'toggle': return txt.split('').map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
    default: return txt;
  }
};

const RichDoc = forwardRef<RichDocHandle, RichDocProps>(function RichDoc({ onSelection, onChangeHover, onChangeResolve }, ref) {
  const t = useT();
  const selCb = useRef(onSelection); selCb.current = onSelection;
  const hoverCb = useRef(onChangeHover); hoverCb.current = onChangeHover;
  const resolveCb = useRef(onChangeResolve); resolveCb.current = onChangeResolve;
  const edRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const objRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null); // 工具栏控件会夺焦丢选区,随时记下编辑器内选区以恢复
  const painter = useRef<DocFmt | null>(null); // 格式刷源格式
  const cmtCursor = useRef(0); // 批注导航游标
  const lastImg = useRef<HTMLElement | null>(null); // 最近点选的图片/对象(排列命令的目标)
  const undoMap = useRef<Map<string, { mode: 'span'; prior: DocumentFragment; el: HTMLElement } | { mode: 'root'; priorProps: Record<string, string> } | { mode: 'block'; prior: Element; el: HTMLElement }>>(new Map());

  const [tab, setTab] = useState<number>(() => { const v = parseInt(localStorage.getItem(TAB_KEY) ?? '0', 10); return Number.isFinite(v) && v >= 0 && v < 6 ? v : 0; });
  const [pop, setPop] = useState<{ key: string; x: number; y: number } | null>(null);
  const [st, setSt] = useState<CmdState>({ bold: false, italic: false, underline: false, strike: false, ul: false, ol: false, align: 'left', font: '', size: 0 });
  const [page, setPage] = useState<PageState>(() => { try { return JSON.parse(localStorage.getItem(PAGE_KEY) ?? '{}') as PageState; } catch { return {}; } });
  const [toast, setToast] = useState<string | null>(null);
  const [wc, setWc] = useState<{ chars: number; noSpace: number; cjk: number; words: number; paras: number } | null>(null);
  const [nav, setNav] = useState<{ level: number; text: string; idx: number }[]>([]);
  const [diffView, setDiffView] = useState<'orig' | 'mark' | 'clean' | 'final'>('mark'); // Agent 改动四态:原文/修订/清样/改后
  const [hasDiff, setHasDiff] = useState(false); // 文档里是否存在 Agent 改动(决定是否显示修订切换条)
  const [chgCount, setChgCount] = useState(0); // 改动条数(计数器)
  const [stepPos, setStepPos] = useState(0); // 步进导航当前位置(0 基)
  const [hoverCard, setHoverCard] = useState<{ cid: string; kind: string; oldText: string; newText: string; glyph: string; x: number; y: number; below: boolean } | null>(null); // 逐条改动悬浮卡
  const cardTimer = useRef<number | null>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null); // Office 式即时悬浮提示
  const tipTimer = useRef<number | null>(null);
  const lastFore = useRef('#c00000');
  const lastHi = useRef('#ffe600');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (edRef.current) edRef.current.innerHTML = saved && saved.trim() ? saved : DEMO_HTML;
    { const nx = edRef.current?.querySelectorAll('[data-cid]').length ?? 0; setChgCount(nx); setHasDiff(nx > 0); }
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* 老浏览器忽略 */ }
    const onSel = (): void => {
      const s = window.getSelection();
      if (!(s && s.rangeCount && edRef.current && s.anchorNode && edRef.current.contains(s.anchorNode))) return;
      savedRange.current = s.getRangeAt(0).cloneRange();
      // 上抛选区芯片:选中文字→给 App(显示"已选"+喂 Agent);折叠→清空
      const selTxt = s.toString();
      if (selTxt && selTxt.trim()) {
        let be: Node | null = s.anchorNode;
        while (be && be !== edRef.current) { if (be instanceof HTMLElement && BLOCK_TAGS.test(be.tagName)) break; be = be.parentNode; }
        const tag = be instanceof HTMLElement ? be.tagName : '';
        const blockLabel = /^H[1-3]$/.test(tag) ? '标题' : tag === 'BLOCKQUOTE' ? '引用' : tag === 'LI' ? '列表项' : '正文';
        let ae: Node | null = s.anchorNode; if (ae && ae.nodeType === 3) ae = ae.parentElement;
        const fb = ae instanceof HTMLElement ? fmtBrief(ae) : null;
        selCb.current?.({ text: selTxt.length > 400 ? selTxt.slice(0, 400) + '…' : selTxt, block: blockLabel, chars: selTxt.length, ...(fb ? { font: fb.font, size: fb.size, bold: fb.bold, italic: fb.italic, align: fb.align } : {}) });
      } else selCb.current?.(null);
      try {
        let el: Node | null = s.anchorNode;
        if (el && el.nodeType === 3) el = el.parentElement;
        const ff = el instanceof HTMLElement ? getComputedStyle(el).fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '' : '';
        const px = el instanceof HTMLElement ? parseFloat(getComputedStyle(el).fontSize) : 16;
        setSt({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strike: document.queryCommandState('strikeThrough'),
          ul: document.queryCommandState('insertUnorderedList'),
          ol: document.queryCommandState('insertOrderedList'),
          align: document.queryCommandState('justifyCenter') ? 'center' : document.queryCommandState('justifyRight') ? 'right' : document.queryCommandState('justifyFull') ? 'justify' : 'left',
          font: ff,
          size: Math.round(px * 0.75 * 10) / 10,
        });
      } catch { /* queryCommandState 偶发异常忽略 */ }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  // 页面级样式(纸张/边距/分栏/缩放/网格/视图…)不进正文 innerHTML,单独持久化并在 [page] 变化时套用
  useEffect(() => {
    const el = edRef.current;
    if (!el) return;
    try { localStorage.setItem(PAGE_KEY, JSON.stringify(page)); } catch { /* 配额忽略 */ }
    // 尺寸 / 方向
    if (page.size || page.orient) {
      const dim = PAPERS[page.size ?? 'A4'] ?? PAPERS.A4!;
      const land = page.orient === 'landscape';
      el.style.width = (land ? dim[1] : dim[0]) + 'px';
      el.style.minHeight = (land ? dim[0] : dim[1]) + 'px';
    } else { el.style.width = ''; el.style.minHeight = ''; }
    el.style.padding = page.margin ? (MARGINS.find((m) => m[0] === page.margin)?.[1] ?? '') : '';
    el.style.columnCount = page.columns && page.columns > 1 ? String(page.columns) : '';
    el.style.columnGap = page.columns && page.columns > 1 ? '2.4em' : '';
    el.style.writingMode = page.writing === 'v' ? 'vertical-rl' : '';
    el.style.hyphens = page.hyphens ? 'auto' : '';
    const lg = page.lang ?? (page.hyphens ? 'en' : ''); // 校对语言:用户所选优先,断字兜底 en
    if (lg) el.setAttribute('lang', lg); else el.removeAttribute('lang');
    el.spellcheck = !!page.spell;
    el.classList.toggle('rd-grid', !!page.grid);
    el.classList.toggle('rd-linenumbers', !!page.lineNums);
    el.classList.toggle('rd-hide-comments', !!page.hideComments);
    el.classList.toggle('rd-track', !!page.track);
    // 缩放:用 CSS zoom(Chromium/Electron 原生),真实参与布局与滚动,避免 transform 的水平裁剪/滚动长度失真
    const z = page.zoom && page.zoom > 0 ? page.zoom : 1;
    el.style.zoom = z !== 1 ? String(z) : '';
  }, [page]);

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 1800); return () => clearTimeout(id); }, [toast]);
  // Agent 改动的三态切换:给 .rd-page 加类,CSS 决定 del/ins 的显隐(原文=只旧、修订=红删绿增、改后=只新)
  useEffect(() => {
    const el = edRef.current; if (!el) return;
    el.classList.toggle('rd-diff-final', diffView === 'final');
    el.classList.toggle('rd-diff-clean', diffView === 'clean');
    el.classList.toggle('rd-diff-orig', diffView === 'orig');
  }, [diffView, hasDiff]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { setPop(null); setWc(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => () => { if (cardTimer.current) window.clearTimeout(cardTimer.current); if (tipTimer.current) window.clearTimeout(tipTimer.current); }, []); // 卸载清定时器,别在幽灵上开卡

  const restoreSel = (): void => {
    edRef.current?.focus();
    const r = savedRange.current;
    if (!r) return;
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  };
  const persist = (): void => {
    try {
      const el = edRef.current; if (!el) return;
      const c = el.cloneNode(true) as HTMLElement; // 存洗净克隆:瞬态类(到达脉冲/高亮/联动)不进持久层,重开不复播
      c.querySelectorAll('.is-new, .is-active, .is-linked, .rd-flash, .rd-settle').forEach((x) => x.classList.remove('is-new', 'is-active', 'is-linked', 'rd-flash', 'rd-settle'));
      localStorage.setItem(STORAGE_KEY, c.innerHTML);
    } catch { /* 配额满忽略 */ }
  };
  const notify = (m: string): void => setToast(m);
  const refreshHasDiff = (): void => {
    const n = edRef.current?.querySelectorAll('[data-cid]').length ?? 0;
    setChgCount(n); setHasDiff(n > 0);
    setStepPos((p) => (n === 0 ? 0 : Math.min(p, n - 1))); // 改动增删后钳制步进游标,计数器不指空
  };
  /** 尊重系统"减少动态效果":滚动定位退化为瞬时。 */
  const smoothBehavior = (): ScrollBehavior => (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  // 逐条改动的悬浮卡(复用 .rd-tip 心智):悬停一处改动 → 卡片显示 类型·旧→新·✓/✕
  const openCardFor = (g: HTMLElement): void => {
    if (!g.isConnected) return; // 120ms 延迟里改动可能已被还原,别在脱离节点上开卡(rect 会落到左上角)
    const cid = g.getAttribute('data-cid'); if (!cid) return;
    const kind = g.getAttribute('data-kind') ?? 'replace';
    const del = g.querySelector('del'); const ins = g.querySelector('ins');
    const r = g.getBoundingClientRect();
    const cut = (s: string): string => (s.length > 48 ? s.slice(0, 48) + '…' : s);
    const below = r.top < 150; // 视口顶端放不下 → 卡片翻到改动下方
    setHoverCard({ cid, kind, oldText: cut(del?.textContent ?? ''), newText: cut(kind === 'format' ? (g.textContent ?? '') : (ins?.textContent ?? '')), glyph: g.getAttribute('data-glyph') ?? '', x: Math.round(r.left + r.width / 2), y: Math.round(below ? r.bottom : r.top), below });
    hoverCb.current?.(cid);
  };
  const onDocOver = (e: React.MouseEvent): void => {
    const g = (e.target as HTMLElement).closest?.('.rd-chg, [data-edit-block]') as HTMLElement | null; // 块级改动同样有卡片
    if (!g) return;
    if (cardTimer.current) window.clearTimeout(cardTimer.current);
    cardTimer.current = window.setTimeout(() => openCardFor(g), 120);
  };
  const onEdKey = (e: React.KeyboardEvent): void => { // 键盘可达:Tab 到改动壳(contenteditable=false 可聚焦)后 Enter/空格开卡
    const g = (e.target as HTMLElement).closest?.('.rd-chg') as HTMLElement | null;
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCardFor(g); }
  };
  const onDocOut = (e: React.MouseEvent): void => {
    const from = (e.target as HTMLElement).closest?.('.rd-chg, [data-edit-block]');
    const to = e.relatedTarget as Node | null;
    if (from && to && from.contains(to)) return;
    if (to instanceof HTMLElement && to.closest?.('.rd-cardwrap')) return; // 移到卡片上,别关
    if (cardTimer.current) window.clearTimeout(cardTimer.current);
    cardTimer.current = window.setTimeout(() => { setHoverCard(null); hoverCb.current?.(null); }, 90);
  };
  const keepCard = (): void => { if (cardTimer.current) window.clearTimeout(cardTimer.current); };
  const closeCard = (): void => { if (cardTimer.current) window.clearTimeout(cardTimer.current); setHoverCard(null); hoverCb.current?.(null); };
  // 步进导航:上一处/下一处改动,定位并激活
  const step = (dir: number): void => {
    const root = edRef.current; if (!root) return;
    const list = Array.from(root.querySelectorAll('[data-cid]')) as HTMLElement[];
    if (!list.length) return;
    const next = (stepPos + dir + list.length) % list.length;
    setStepPos(next);
    root.querySelectorAll('.is-active').forEach((e) => e.classList.remove('is-active'));
    const el = list[next]!;
    el.classList.add('is-active');
    el.scrollIntoView({ behavior: smoothBehavior(), block: 'center' });
    el.classList.add('rd-flash'); setTimeout(() => el.classList.remove('rd-flash'), 1200);
  };

  useImperativeHandle(ref, (): RichDocHandle => ({
    getText: () => { // 清样投影:喂给 Agent 的永远是"改后本体",del 里的旧文不进上下文(否则新旧连体会污染下一轮的 quote)
      const root = edRef.current; if (!root) return '';
      const blocks = Array.from(root.querySelectorAll(BLOCK_SEL)) as HTMLElement[];
      if (!blocks.length) return (cleanClone(root).textContent ?? '').trim();
      return blocks.map((b) => cleanBlockText(b).replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    },
    getContext: () => {
      const root = edRef.current; if (!root) return '(空文档)';
      const blocks = Array.from(root.querySelectorAll('p,h1,h2,h3,h4,li,blockquote')) as HTMLElement[];
      if (!blocks.length) return root.innerText || '(空文档)';
      const fonts = new Set<string>(); const sizes = new Set<number>(); const colors = new Set<string>();
      const lines = blocks.map((el, i) => {
        const b = fmtBrief(el);
        if (b.font) fonts.add(b.font); sizes.add(b.size); if (b.color !== '#000000' && b.color !== '#1f2430') colors.add(b.color);
        const tag = el.tagName.toLowerCase();
        const style = tag === 'h1' ? '标题1' : tag === 'h2' ? '标题2' : tag === 'h3' ? '标题3' : tag === 'h4' ? '标题4' : tag === 'blockquote' ? '引用' : tag === 'li' ? '列表项' : '正文';
        const txt = cleanBlockText(el).replace(/\s+/g, ' ').trim(); // 同样走清样投影,别把 del 旧文标进段落概览
        const marks = [style, `${b.font} ${b.size}pt`, b.color !== '#000000' && b.color !== '#1f2430' ? b.color : '', b.bold ? '加粗' : '', b.italic ? '斜体' : '', b.align !== '左对齐' ? b.align : ''].filter(Boolean).join(' · ');
        return `第${i + 1}段 [${marks}]: ${txt.length > 90 ? txt.slice(0, 90) + '…' : txt}`;
      });
      return `[Word 文档 · ${blocks.length} 段] 每段已标注它的样式/字体/字号/对齐/颜色;要改格式就据此下发 setStyle。\n格式概览: 字体 ${[...fonts].join('、')} | 字号 ${[...sizes].sort((a, b) => a - b).join('、')}pt${colors.size ? ' | 非黑颜色 ' + [...colors].join('、') : ''}\n逐段:\n${lines.join('\n')}`;
    },
    applyEdit: (editId, quote, opts) => {
      const root = edRef.current;
      if (!root) return false;
      if (root.querySelector(`[data-cid="${cssq(editId)}"]`)) return true; // 幂等:同一改动只落一次(刷新后重复接受/重放不叠标记)
      const fmt = opts.fmt;
      // 全文格式(无 quote):字符级改根内联样式;段落级(对齐/行距/底纹)也落根(继承给各段);block 对全文无意义,忽略
      if (!quote && fmt) {
        const s = root.style;
        undoMap.current.set(editId, { mode: 'root', priorProps: {
          fontWeight: s.fontWeight, fontStyle: s.fontStyle, textDecoration: s.textDecoration, fontFamily: s.fontFamily, fontSize: s.fontSize, color: s.color,
          textAlign: s.textAlign, lineHeight: s.lineHeight, backgroundColor: s.backgroundColor,
        } });
        styleSpan(root, fmt);
        styleBlockEl(root, fmt);
        persist();
        return true;
      }
      const range = findRangeLoose(root, quote); // 宽松定位:容忍模型 quote 的空白/换行差异,edit 才真落地
      if (!range) return false;
      // 拒绝落进未定修订内部:嵌套标记会毁掉 flatten/revert 的对称性(服务端锚点校验负责修复此类 quote)
      const inRev = (nd: Node): boolean => { let e: Node | null = nd; while (e && e !== root) { if (e instanceof HTMLElement && (e.classList.contains('rd-chg') || e.tagName === 'DEL' || e.tagName === 'INS')) return true; e = e.parentNode; } return false; };
      if (inRev(range.startContainer) || inRev(range.endContainer)) return false;
      // 段落级格式(且非文本改写):快照整段以便还原,套用后打 data-edit-block 标记
      if (opts.replacement == null && fmt && BLOCK_FMT(fmt)) {
        let blk: Node | null = range.startContainer;
        while (blk && blk !== root) { if (blk instanceof HTMLElement && BLOCK_TAGS.test(blk.tagName)) break; blk = blk.parentNode; }
        if (blk instanceof HTMLElement && blk !== root) {
          const prior = blk.cloneNode(true) as Element;
          if (INLINE_FMT(fmt)) { // 字符级部分:把 quote 包进内联 span
            const sp = document.createElement('span'); styleSpan(sp, fmt);
            try { range.surroundContents(sp); } catch { sp.appendChild(range.extractContents()); range.insertNode(sp); }
          }
          let target: HTMLElement = blk; // 换段落标签(标题/正文/引用)
          if (fmt.block && blk.tagName.toLowerCase() !== fmt.block) {
            target = document.createElement(fmt.block);
            while (blk.firstChild) target.appendChild(blk.firstChild);
            blk.replaceWith(target);
          }
          styleBlockEl(target, fmt);
          target.setAttribute('data-edit-block', editId); target.setAttribute('data-cid', editId); target.setAttribute('data-kind', 'format'); target.setAttribute('data-glyph', '¶');
          undoMap.current.set(editId, { mode: 'block', prior, el: target }); // 存 el:同段多次改 或 跨回合 editId 撞名时仍能精确还原
          persist();
          return true;
        }
        // 找不到块 → 落回内联 span 处理
      }
      // 文本改写 → 一个 .rd-chg 组(data-edit/data-cid 只打在组上,revert 才干净)含 del(旧)+ ins(新);纯字符级格式 → .rd-chg.rd-fmt 第三通道
      const prior = range.cloneContents();
      const oldText = range.toString();
      const cutA = (s: string): string => (s.length > 60 ? s.slice(0, 60) + '…' : s);
      if (opts.replacement != null) {
        const kind = oldText && opts.replacement ? 'replace' : opts.replacement ? 'insert' : 'delete';
        const grp = document.createElement('span');
        grp.className = 'rd-chg is-new'; grp.setAttribute('data-edit', editId); grp.setAttribute('data-cid', editId); grp.setAttribute('data-kind', kind); grp.setAttribute('tabindex', '0');
        grp.setAttribute('contenteditable', 'false'); // 原子化:光标进不去,打字/Ctrl+Z 不会撕开修订对
        grp.setAttribute('aria-label', `${kind === 'replace' ? '替换' : kind === 'insert' ? '插入' : '删除'}:${cutA(oldText)}${oldText && opts.replacement ? ' → ' : ''}${cutA(opts.replacement)}`);
        if (oldText) { const del = document.createElement('del'); del.className = 'rd-del'; del.textContent = oldText; grp.appendChild(del); }
        if (opts.replacement) { const ins = document.createElement('ins'); ins.className = 'rd-ins'; if (fmt) styleSpan(ins, fmt); ins.textContent = opts.replacement; grp.appendChild(ins); }
        range.deleteContents();
        range.insertNode(grp);
        undoMap.current.set(editId, { mode: 'span', prior, el: grp });
        window.setTimeout(() => grp.classList.remove('is-new'), 1000);
      } else {
        const glyph = fmt?.bold ? 'B' : fmt?.italic ? 'I' : fmt?.underline ? 'U' : fmt?.strike ? 'S' : (fmt?.color || fmt?.bgColor) ? '◆' : fmt?.size ? 'A±' : fmt?.font ? 'A' : '~';
        const span = document.createElement('span');
        span.className = 'rd-chg rd-fmt is-new'; span.setAttribute('data-edit', editId); span.setAttribute('data-cid', editId); span.setAttribute('data-kind', 'format'); span.setAttribute('data-glyph', glyph); span.setAttribute('tabindex', '0');
        span.setAttribute('contenteditable', 'false');
        span.setAttribute('aria-label', `改格式(${glyph}):${cutA(oldText || quote)}`);
        if (fmt) styleSpan(span, fmt);
        span.appendChild(range.extractContents()); // 搬移而非重建文本:quote 里的链接/加粗/脚注等内联结构原样保留
        range.insertNode(span);
        undoMap.current.set(editId, { mode: 'span', prior, el: span });
        window.setTimeout(() => span.classList.remove('is-new'), 1000);
      }
      refreshHasDiff();
      persist();
      return true;
    },
    revert: (editId) => {
      const root = edRef.current;
      if (!root) return false;
      const info = undoMap.current.get(editId);
      if (info) {
        if (info.mode === 'root') {
          const s = root.style; const pp = info.priorProps;
          s.fontWeight = pp.fontWeight ?? ''; s.fontStyle = pp.fontStyle ?? ''; s.textDecoration = pp.textDecoration ?? '';
          s.fontFamily = pp.fontFamily ?? ''; s.fontSize = pp.fontSize ?? ''; s.color = pp.color ?? '';
          s.textAlign = pp.textAlign ?? ''; s.lineHeight = pp.lineHeight ?? ''; s.backgroundColor = pp.backgroundColor ?? '';
        } else if (info.mode === 'block') {
          const cur = info.el && root.contains(info.el) ? info.el : root.querySelector(`[data-edit-block="${cssq(editId)}"]`);
          if (cur && cur.parentNode) cur.parentNode.replaceChild(info.prior.cloneNode(true), cur);
        } else {
          // 文本改动可能是一对 del+ins(同一 data-edit),整体用原片段替回;定稿后(data-undo)el 引用仍指向同一节点
          const els = Array.from(root.querySelectorAll(`[data-edit="${cssq(editId)}"], [data-undo="${cssq(editId)}"]`)) as HTMLElement[];
          if (els.length && els[0]!.parentNode) { els[0]!.parentNode.insertBefore(info.prior.cloneNode(true), els[0]!); els.forEach((e) => e.remove()); }
          else if (info.el && info.el.parentNode) { info.el.parentNode.insertBefore(info.prior.cloneNode(true), info.el); info.el.remove(); }
        }
        undoMap.current.delete(editId);
        refreshHasDiff();
        persist();
        return true;
      }
      // 兜底(刷新后 undoMap 已失):按 DOM 现场退回——文本=回 del 旧文;格式=解包放弃;块级=剥标记清样式(尽力而为)
      const els = Array.from(root.querySelectorAll(`[data-cid="${cssq(editId)}"]`)) as HTMLElement[];
      if (!els.length) return false;
      for (const el of els) {
        if (el.hasAttribute('data-edit-block')) {
          ['data-edit-block', 'data-cid', 'data-kind', 'data-glyph'].forEach((a) => el.removeAttribute(a));
          el.style.textAlign = ''; el.style.textAlignLast = ''; el.style.lineHeight = ''; el.style.backgroundColor = '';
        } else if (el.classList.contains('rd-fmt')) {
          el.replaceWith(...Array.from(el.childNodes));
        } else {
          const del = el.querySelector('del');
          if (del) el.replaceWith(...Array.from(del.childNodes)); else el.remove();
        }
      }
      refreshHasDiff();
      persist();
      return true;
    },
    highlight: (editId) => {
      const root = edRef.current; if (!root) return;
      root.querySelectorAll('.is-active').forEach((e) => e.classList.remove('is-active'));
      const info = undoMap.current.get(editId);
      const el = (info && 'el' in info && info.el && root.contains(info.el) ? info.el : root.querySelector(`[data-cid="${cssq(editId)}"], [data-edit="${cssq(editId)}"], [data-edit-block="${cssq(editId)}"]`)) as HTMLElement | null;
      if (!el) return;
      el.classList.add('is-active');
      el.scrollIntoView({ behavior: smoothBehavior(), block: 'center' });
      el.classList.add('rd-flash');
      setTimeout(() => el.classList.remove('rd-flash'), 1200);
    },
    linkChange: (cid) => {
      const root = edRef.current; if (!root) return;
      root.querySelectorAll('.is-linked').forEach((e) => e.classList.remove('is-linked'));
      if (cid) root.querySelector(`[data-cid="${cssq(cid)}"]`)?.classList.add('is-linked');
    },
    activateChange: (cid) => {
      const root = edRef.current; if (!root) return;
      root.querySelectorAll('.is-active').forEach((e) => e.classList.remove('is-active'));
      const el = root.querySelector(`[data-cid="${cssq(cid)}"]`) as HTMLElement | null;
      if (!el) return;
      el.classList.add('is-active');
      el.scrollIntoView({ behavior: smoothBehavior(), block: 'center' });
      el.classList.add('rd-flash'); setTimeout(() => el.classList.remove('rd-flash'), 1200);
    },
    markResolved: (cid, state) => {
      const root = edRef.current; if (!root) return;
      const els = Array.from(root.querySelectorAll(`[data-cid="${cssq(cid)}"]`)) as HTMLElement[];
      if (!els.length) return;
      if (state !== 'accepted') { els.forEach((e) => e.classList.remove('is-accepted', 'is-rejected')); return; }
      // 接受=物理定稿(不是加类化妆):del 删掉、ins 解包,修订标识剥净 —— 文档回归本体,上下文/字数/查找全部自然干净
      const stripRev = (el: HTMLElement): void => { ['data-edit', 'data-cid', 'data-kind', 'data-glyph', 'tabindex', 'contenteditable', 'aria-label'].forEach((a) => el.removeAttribute(a)); };
      for (const el of els) {
        if (el.hasAttribute('data-edit-block')) {
          el.removeAttribute('data-edit-block'); stripRev(el); // 段落样式已在块上,剥标记即定稿
        } else if (el.classList.contains('rd-fmt')) {
          stripRev(el); // 格式:退化成普通样式 span;data-undo 保住"整轮撤销"窗口
          el.className = 'rd-settle'; el.setAttribute('data-undo', cid);
          window.setTimeout(() => el.classList.remove('rd-settle'), 400);
        } else {
          el.querySelectorAll('del').forEach((d) => d.remove());
          el.querySelectorAll('ins').forEach((i) => {
            const st = i.getAttribute('style'); // 带样式的 ins 降级成样式 span,不带的直接解包
            if (st) { const sp = document.createElement('span'); sp.setAttribute('style', st); while (i.firstChild) sp.appendChild(i.firstChild); i.replaceWith(sp); }
            else i.replaceWith(...Array.from(i.childNodes));
          });
          stripRev(el);
          el.className = 'rd-settle'; el.setAttribute('data-undo', cid);
          window.setTimeout(() => el.classList.remove('rd-settle'), 400);
        }
      }
      refreshHasDiff();
      persist();
    },
    closeUndoWindow: () => { // 新提案到达=上一轮撤销窗口关闭:剥 data-undo,裸 span 顺手解包,文档零残留
      const root = edRef.current; if (!root) return;
      root.querySelectorAll('[data-undo]').forEach((el) => {
        el.removeAttribute('data-undo');
        if (el.tagName === 'SPAN' && !el.attributes.length) el.replaceWith(...Array.from(el.childNodes));
      });
      undoMap.current.clear();
      persist();
    },
  }), []);

  // ── 基础命令(execCommand + CSS;先恢复选区) ──
  const exec = (cmd: string, val?: string): void => { restoreSel(); document.execCommand(cmd, false, val); persist(); };
  const withSel = (fn: () => void): void => { restoreSel(); fn(); persist(); };
  const insertHTML = (html: string): void => { restoreSel(); document.execCommand('insertHTML', false, html); persist(); };
  const insertText = (txt: string): void => { restoreSel(); document.execCommand('insertText', false, txt); persist(); };
  const setFont = (f: string): void => { if (f) exec('fontName', f); };

  const applySizePt = (pt: number): void => {
    const root = edRef.current; if (!root) return;
    restoreSel();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontSize', false, '7');
    document.execCommand('styleWithCSS', false, 'true');
    const spans: HTMLElement[] = [];
    root.querySelectorAll('font[size="7"]').forEach((f) => {
      const s = document.createElement('span');
      s.style.fontSize = pt + 'pt';
      while (f.firstChild) s.appendChild(f.firstChild); // 搬移而非克隆,保留内联结构
      f.replaceWith(s);
      spans.push(s);
    });
    if (spans.length) { // 重新选中调整后的文本,保证连续排版(再加粗/换色/继续调号)真生效
      const r = document.createRange();
      r.setStartBefore(spans[0]!);
      r.setEndAfter(spans[spans.length - 1]!);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      savedRange.current = r.cloneRange();
    }
    persist();
  };
  const setSize = (pt: string): void => { if (pt) applySizePt(parseFloat(pt)); };
  const currentPt = (): number => {
    const s = window.getSelection();
    let el: Node | null = s?.anchorNode ?? null;
    if (el && el.nodeType === 3) el = el.parentElement;
    if (!(el instanceof HTMLElement)) return 12;
    return parseFloat(getComputedStyle(el).fontSize) * 0.75;
  };
  const stepFont = (dir: number): void => {
    const cur = currentPt();
    let target: number;
    if (dir > 0) target = SIZES.find((s) => s > cur + 0.1) ?? SIZES[SIZES.length - 1]!;
    else { const smaller = SIZES.filter((s) => s < cur - 0.1); target = smaller.length ? smaller[smaller.length - 1]! : SIZES[0]!; }
    applySizePt(target);
  };

  /** 选区涉及的段落块(找不到块则回溯最近块祖先)。 */
  const blocksInSel = (): HTMLElement[] => {
    const root = edRef.current; if (!root) return [];
    const s = window.getSelection();
    const range = s && s.rangeCount ? s.getRangeAt(0) : null;
    if (!range) return [];
    let blocks = (Array.from(root.querySelectorAll(BLOCK_SEL)) as HTMLElement[]).filter((el) => range.intersectsNode(el));
    if (blocks.length === 0) {
      let e: Node | null = range.startContainer;
      while (e && e !== root) { if (e instanceof HTMLElement && BLOCK_TAGS.test(e.tagName)) { blocks = [e]; break; } e = e.parentNode; }
    }
    return blocks;
  };
  const styleBlocks = (fn: (el: HTMLElement) => void): void => { restoreSel(); blocksInSel().forEach(fn); persist(); };
  const caretBlock = (): HTMLElement | null => {
    const s = window.getSelection();
    let e: Node | null = s?.anchorNode ?? null;
    const root = edRef.current;
    while (e && e !== root) { if (e instanceof HTMLElement && BLOCK_TAGS.test(e.tagName)) return e; e = e.parentNode; }
    return null;
  };

  const setLineSpacing = (v: string): void => { if (v) styleBlocks((el) => { el.style.lineHeight = v; }); };

  /** 划选包裹一个自定义 span(surroundContents,失败则 extract 兜底)。 */
  const wrapSel = (style: (s: HTMLElement) => void, cls?: string): void => {
    restoreSel();
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) { notify(t('请先选择文本')); return; }
    const range = s.getRangeAt(0);
    const span = document.createElement('span');
    if (cls) span.className = cls;
    style(span);
    try { range.surroundContents(span); }
    catch { span.appendChild(range.extractContents()); range.insertNode(span); }
    persist();
  };

  const insertTablePrompt = (): void => {
    const spec = window.prompt(t('表格尺寸(行,列)'), '3,3');
    if (!spec) return;
    const m = spec.split(/[\s,，xX×*]+/).map((x) => parseInt(x.trim(), 10));
    const rows = m[0], cols = m[1];
    if (!rows || !cols || rows > 50 || cols > 20) return;
    insertTable(rows, cols);
  };
  const insertTable = (rows: number, cols: number): void => {
    let html = '<table class="rd-tbl"><tbody>';
    for (let i = 0; i < rows; i++) { html += '<tr>'; for (let j = 0; j < cols; j++) html += '<td><br></td>'; html += '</tr>'; }
    html += '</tbody></table><p><br></p>';
    insertHTML(html);
  };

  const insertLink = (): void => {
    restoreSel();
    const url = window.prompt(t('链接地址'), 'https://');
    if (!url) return;
    document.execCommand('createLink', false, url);
    edRef.current?.querySelectorAll('a[href]:not([target])').forEach((a) => a.setAttribute('target', '_blank'));
    persist();
  };

  const onPickImg = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (): void => { insertHTML(`<img src="${String(reader.result)}" alt="" />`); };
    reader.readAsDataURL(f);
  };
  const onPickObj = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      if (f.type.startsWith('image/')) insertHTML(`<img src="${String(reader.result)}" alt="" />`);
      else insertHTML(`<a class="rd-object" href="${String(reader.result)}" download="${f.name}">📎 ${f.name}</a>`);
    };
    reader.readAsDataURL(f);
  };

  const findNext = (term: string): void => {
    const root = edRef.current; if (!root || !term) return;
    let from = 0; // 从光标后开始找,找不到再从头(循环),这样"查找下一个"能逐个命中
    const cur = window.getSelection();
    if (cur && cur.rangeCount && cur.anchorNode && root.contains(cur.anchorNode)) {
      const pre = document.createRange();
      pre.selectNodeContents(root);
      pre.setEnd(cur.getRangeAt(0).endContainer, cur.getRangeAt(0).endOffset);
      from = pre.toString().length;
    }
    let r = findRange(root, term, from);
    if (!r) r = findRange(root, term, 0);
    if (!r) { notify(t('未找到匹配')); return; }
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
    savedRange.current = r.cloneRange();
    (r.startContainer.parentElement ?? root).scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const findReplace = (): void => {
    const root = edRef.current; if (!root) return;
    const find = window.prompt(t('查找内容'));
    if (!find) return;
    const repl = window.prompt(t('替换为'), '') ?? '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) { const p = (n as Text).parentElement; if (p && p.closest('del')) continue; texts.push(n as Text); } // 已删除的旧文不参与替换
    let count = 0;
    for (const tn of texts) if (tn.data.includes(find)) { count += tn.data.split(find).length - 1; tn.data = tn.data.split(find).join(repl); }
    persist();
    notify(count ? `${t('已替换')} ${count}` : t('未找到匹配'));
  };

  const capturePaint = (): void => {
    const s = window.getSelection();
    let el: Node | null = s?.anchorNode ?? null;
    if (el && el.nodeType === 3) el = el.parentElement;
    if (!(el instanceof HTMLElement)) return;
    const cs = getComputedStyle(el);
    painter.current = {
      bold: parseInt(cs.fontWeight, 10) >= 600, italic: cs.fontStyle === 'italic',
      underline: cs.textDecorationLine.includes('underline'), strike: cs.textDecorationLine.includes('line-through'),
      font: cs.fontFamily, size: Math.round(parseFloat(cs.fontSize) * 0.75 * 10) / 10, color: cs.color,
    };
    edRef.current?.classList.add('rd-painting');
    notify(t('格式刷已就绪,划选目标文字套用'));
  };
  // 点选图片/对象时记住它,作为「排列」命令(旋转/位置/层次…)的目标
  const onEdClick = (e: React.MouseEvent): void => {
    const hit = (e.target as HTMLElement | null)?.closest?.('img,svg,.rd-textbox');
    if (hit && edRef.current?.contains(hit)) lastImg.current = hit as HTMLElement;
  };
  const onEdMouseUp = (): void => {
    const fmt = painter.current;
    if (!fmt) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const range = s.getRangeAt(0);
    const span = document.createElement('span');
    styleSpan(span, fmt);
    try { range.surroundContents(span); } catch { span.appendChild(range.extractContents()); range.insertNode(span); }
    painter.current = null;
    edRef.current?.classList.remove('rd-painting');
    persist();
  };

  const doPaste = async (mode: 'rich' | 'merge' | 'text'): Promise<void> => {
    restoreSel();
    try {
      if (mode === 'text') { const txt = await navigator.clipboard.readText(); document.execCommand('insertText', false, txt); persist(); return; }
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (it.types.includes('text/html')) {
          const blob = await it.getType('text/html');
          let html = await blob.text();
          if (mode === 'merge') html = html.replace(/style="[^"]*"/g, '').replace(/<(font|span)[^>]*>/gi, '<$1>');
          document.execCommand('insertHTML', false, html);
          persist();
          return;
        }
      }
      const txt = await navigator.clipboard.readText();
      document.execCommand('insertText', false, txt);
      persist();
    } catch { notify(t('无法读取剪贴板,请用 Ctrl+V')); }
  };

  const takeScreenshot = async (): Promise<void> => {
    try {
      const media = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c: unknown) => Promise<MediaStream> };
      if (!media?.getDisplayMedia) { notify(t('当前环境不支持屏幕截图')); return; }
      const stream = await media.getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      stream.getTracks().forEach((tk) => tk.stop());
      insertHTML(`<img src="${canvas.toDataURL('image/png')}" alt="screenshot" />`);
    } catch { notify(t('已取消截图')); }
  };

  // ── 插入类构件 ──
  const insertCover = (variant: string): void => {
    const root = edRef.current; if (!root) return;
    const y = new Date();
    const html = `<div class="rd-cover ${variant}" contenteditable="true"><div class="rd-cover-kicker">OTTERPATCH · 文档</div><div class="rd-cover-title">文档标题</div><div class="rd-cover-sub">副标题 / 摘要</div><div class="rd-cover-meta">作者姓名 · ${y.getFullYear()}年${y.getMonth() + 1}月${y.getDate()}日</div></div><div class="rd-pagebreak" contenteditable="false"></div>`;
    root.insertAdjacentHTML('afterbegin', html);
    persist();
    if (page.nav) refreshNav(); // 封面里若含标题,导航需重新索引,避免位置错位
    notify(t('已插入封面'));
  };
  const insertShape = (svg: string): void => insertHTML(`<svg class="rd-shape" contenteditable="false" width="120" height="80" viewBox="0 0 120 80" fill="none" stroke="#2563eb" stroke-width="1.7">${svg}</svg>`);
  const insertWordArt = (cls: string): void => {
    const s = window.getSelection();
    if (s && !s.isCollapsed) wrapSel(() => { /* class 载体 */ }, `rd-wordart ${cls}`);
    else insertHTML(`<span class="rd-wordart ${cls}">艺术字</span>`);
  };
  const insertTextbox = (): void => insertHTML('<div class="rd-textbox" contenteditable="true">在此键入文本</div><p><br></p>');
  const insertSign = (): void => insertHTML('<div class="rd-signline" contenteditable="false"><span class="x">✕</span><span class="ln"></span><small>签名</small></div>');
  const insertEnclosed = (): void => wrapSel(() => { /* class 载体 */ }, 'rd-enclosed');
  const dropCap = (mode: string): void => {
    restoreSel();
    const blk = caretBlock();
    if (!blk) { notify(t('请把光标放在段落中')); return; }
    blk.querySelectorAll('.rd-dropcap').forEach((d) => { const p = d.parentNode; if (p) { while (d.firstChild) p.insertBefore(d.firstChild, d); p.removeChild(d); } });
    blk.normalize();
    if (mode !== '无') {
      // 只包裹首个字符所在的文本节点,保留段落里其余的加粗/链接/图片/脚注等内联结构(勿用 innerHTML 重建)
      const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
      const tn = walker.nextNode() as Text | null;
      if (tn && tn.data.length) {
        tn.splitText(1); // tn 保留首字符
        const span = document.createElement('span');
        span.className = 'rd-dropcap' + (mode === '悬挂' ? ' hang' : '');
        tn.parentNode?.insertBefore(span, tn);
        span.appendChild(tn);
      }
    }
    persist();
  };
  const ruby = (): void => {
    restoreSel();
    const s = window.getSelection();
    const base = s?.toString() ?? '';
    if (!base) { notify(t('请先选择文字')); return; }
    const py = window.prompt(t('拼音/注音'), '');
    if (py == null) return;
    document.execCommand('insertHTML', false, `<ruby>${esc(base)}<rt>${esc(py)}</rt></ruby>`);
    persist();
  };

  // ── 目录 / 脚注 / 题注 / 索引 ──
  const buildToc = (): void => {
    const root = edRef.current; if (!root) return;
    restoreSel();
    const heads = Array.from(root.querySelectorAll('h1,h2,h3')) as HTMLElement[];
    if (!heads.length) { notify(t('未找到标题,先用样式设置标题')); return; }
    let rows = '';
    heads.forEach((h, i) => { const id = (h.id = 'heading-' + i); const lv = parseInt(h.tagName.slice(1), 10); rows += `<a href="#${id}" style="padding-left:${(lv - 1) * 16}px">${esc(h.textContent ?? '')}</a>`; });
    document.execCommand('insertHTML', false, `<nav class="rd-toc" contenteditable="false"><div class="rd-toc-h">目录</div>${rows}</nav><p><br></p>`);
    persist();
  };
  const updateToc = (): void => {
    const root = edRef.current; if (!root) return;
    const toc = root.querySelector('.rd-toc');
    if (!toc) { notify(t('未找到目录,请先插入目录')); return; }
    const heads = Array.from(root.querySelectorAll('h1,h2,h3')) as HTMLElement[];
    let rows = '<div class="rd-toc-h">目录</div>';
    heads.forEach((h, i) => { const id = (h.id = 'heading-' + i); const lv = parseInt(h.tagName.slice(1), 10); rows += `<a href="#${id}" style="padding-left:${(lv - 1) * 16}px">${esc(h.textContent ?? '')}</a>`; });
    toc.innerHTML = rows;
    persist();
    notify(t('目录已更新'));
  };
  const insertNote = (kind: 'fn' | 'en'): void => {
    const root = edRef.current; if (!root) return;
    restoreSel();
    const cls = kind === 'fn' ? 'rd-footnotes' : 'rd-endnotes';
    const refCls = kind === 'fn' ? 'rd-fnref' : 'rd-enref';
    let ol = root.querySelector('.' + cls) as HTMLOListElement | null;
    const num = (ol?.children.length ?? 0) + 1;
    const roman = kind === 'en';
    const label = roman ? ['ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ', 'ⅶ', 'ⅷ', 'ⅸ', 'ⅹ'][num - 1] ?? String(num) : String(num);
    const uid = `${cls}-${num}-${Date.now()}`; // 唯一 id:即使删除过备注也不会撞号
    document.execCommand('insertHTML', false, `<sup class="${refCls}" id="ref-${uid}"><a href="#${uid}">${label}</a></sup>`);
    if (!ol) {
      root.insertAdjacentHTML('beforeend', `<${'ol'} class="${cls}"></ol>`);
      ol = root.querySelector('.' + cls) as HTMLOListElement | null;
    }
    if (ol) { const li = document.createElement('li'); li.id = uid; li.innerHTML = (kind === 'fn' ? '脚注内容…' : '尾注内容…'); ol.appendChild(li); }
    persist();
    notify(kind === 'fn' ? t('已插入脚注') : t('已插入尾注'));
  };
  const nextNote = (): void => {
    const root = edRef.current; if (!root) return;
    const refs = Array.from(root.querySelectorAll('.rd-fnref,.rd-enref')) as HTMLElement[];
    if (!refs.length) { notify(t('文档中暂无脚注')); return; }
    const cur = savedRange.current?.startContainer ?? null;
    const target = refs.find((r) => !cur || (r.compareDocumentPosition(cur) & Node.DOCUMENT_POSITION_PRECEDING)) ?? refs[0]!;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('rd-flash'); setTimeout(() => target.classList.remove('rd-flash'), 1200);
  };
  const showNotes = (): void => {
    const el = edRef.current?.querySelector('.rd-footnotes,.rd-endnotes') as HTMLElement | null;
    if (!el) { notify(t('文档中暂无备注')); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('rd-flash'); setTimeout(() => el.classList.remove('rd-flash'), 1200);
  };
  const insertCaption = (): void => {
    restoreSel();
    const labelTxt = (window.prompt(t('题注标签(图/表/公式)'), '图') ?? '').trim();
    if (!labelTxt) return;
    const root = edRef.current;
    // 用 JS 计数(勿把用户输入拼进选择器,否则含引号会抛 SyntaxError 令插入静默失败)
    const num = root ? Array.from(root.querySelectorAll('.rd-caption')).filter((c) => c.getAttribute('data-label') === labelTxt).length + 1 : 1;
    const text = window.prompt(t('题注文字'), '') ?? '';
    const L = esc(labelTxt);
    document.execCommand('insertHTML', false, `<figcaption class="rd-caption" id="cap-${num}-${Date.now()}" data-label="${L}">${L} ${num}　${esc(text)}</figcaption>`);
    persist();
  };
  const insertTof = (): void => {
    const root = edRef.current; if (!root) return;
    restoreSel();
    const caps = Array.from(root.querySelectorAll('.rd-caption')) as HTMLElement[];
    if (!caps.length) { notify(t('未找到题注')); return; }
    let rows = '<div class="rd-toc-h">图表目录</div>';
    caps.forEach((c, i) => { const id = c.id || (c.id = 'cap-' + i); rows += `<a href="#${id}">${c.textContent ?? ''}</a>`; });
    document.execCommand('insertHTML', false, `<nav class="rd-toc rd-tof" contenteditable="false">${rows}</nav><p><br></p>`);
    persist();
  };
  const markIndex = (): void => {
    restoreSel();
    const s = window.getSelection();
    const term = s?.toString() ?? '';
    if (!term) { notify(t('请先选择要标记的文字')); return; }
    wrapSel((el) => { el.setAttribute('data-term', term); }, 'rd-idx');
    notify(t('已标记索引项') + ' · ' + term);
  };
  const buildIndex = (rebuild: boolean): void => {
    const root = edRef.current; if (!root) return;
    if (rebuild) { const ex = root.querySelector('.rd-index'); if (!ex) { notify(t('未找到索引,请先插入索引')); return; } ex.remove(); }
    else restoreSel();
    const marks = Array.from(root.querySelectorAll('.rd-idx')) as HTMLElement[];
    if (!marks.length) { notify(t('暂无索引条目')); return; }
    const terms = Array.from(new Set(marks.map((m) => m.getAttribute('data-term') ?? m.textContent ?? ''))).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    const html = `<section class="rd-index"><h2>索引</h2>${terms.map((tm) => `<div>${tm}</div>`).join('')}</section>`;
    if (rebuild) root.insertAdjacentHTML('beforeend', html); else document.execCommand('insertHTML', false, html);
    persist();
    notify(t('索引已生成'));
  };
  const insertBiblio = (): void => insertHTML('<section class="rd-biblio"><h2>参考文献</h2><ol><li>作者. 标题[M]. 出版社, 年份.</li></ol></section><p><br></p>');
  const insertCitation = (): void => insertHTML('<span class="rd-cite">(作者, 2026)</span>');

  // ── 页眉页脚 / 书签 / 交叉引用 ──
  const toggleHeaderFooter = (which: 'header' | 'footer'): void => {
    const root = edRef.current; if (!root) return;
    const cls = which === 'header' ? 'rd-header' : 'rd-footer';
    const ex = root.querySelector('.' + cls) as HTMLElement | null;
    if (ex) { if (!(ex.textContent ?? '').trim()) { ex.remove(); persist(); return; } ex.scrollIntoView({ block: 'center' }); return; }
    const el = document.createElement('div');
    el.className = cls; el.setAttribute('contenteditable', 'true');
    el.textContent = which === 'header' ? '页眉' : '页脚';
    if (which === 'header') root.insertBefore(el, root.firstChild); else root.appendChild(el);
    persist();
  };
  const insertBookmark = (): void => {
    restoreSel();
    const name = window.prompt(t('书签名称'), 'bm1');
    if (!name) return;
    const safe = name.replace(/[^\w一-龥-]/g, '-'); // 仅留安全字符,避免破坏 id 属性
    document.execCommand('insertHTML', false, `<a class="rd-bookmark" id="bm-${safe}"></a>`);
    persist();
    notify(t('已添加书签'));
  };
  const insertXref = (): void => {
    const root = edRef.current; if (!root) return;
    restoreSel();
    const heads = Array.from(root.querySelectorAll('h1,h2,h3')) as HTMLElement[];
    if (!heads.length) { notify(t('暂无可引用的标题')); return; }
    const list = heads.map((h, i) => `${i + 1}. ${h.textContent ?? ''}`).join('\n');
    const pick = window.prompt(t('交叉引用 — 输入序号') + '\n' + list, '1');
    const idx = pick ? parseInt(pick, 10) - 1 : -1;
    const h = heads[idx];
    if (!h) return;
    const id = h.id || (h.id = 'heading-x' + idx);
    document.execCommand('insertHTML', false, `<a class="rd-xref" href="#${id}">${esc(h.textContent ?? '')}</a>`);
    persist();
  };

  // ── 批注 / 修订 ──
  const addComment = (): void => {
    restoreSel();
    const s = window.getSelection();
    if (!s || s.isCollapsed) { notify(t('请先选择要批注的文字')); return; }
    const note = window.prompt(t('批注内容'), '');
    if (note == null) return;
    const id = 'c' + Date.now();
    wrapSel((el) => { el.setAttribute('data-cid', id); el.setAttribute('title', note); }, 'rd-comment');
  };
  const delComment = (): void => {
    restoreSel();
    let e: Node | null = window.getSelection()?.anchorNode ?? null;
    while (e && e !== edRef.current) { if (e instanceof HTMLElement && e.classList.contains('rd-comment')) break; e = e.parentNode; }
    const span = e instanceof HTMLElement && e.classList.contains('rd-comment') ? e : (edRef.current?.querySelectorAll('.rd-comment')[cmtCursor.current] as HTMLElement | undefined);
    if (!span || !span.parentNode) { notify(t('未定位到批注')); return; }
    while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
    span.parentNode.removeChild(span);
    persist();
    notify(t('已删除批注'));
  };
  const navComment = (dir: number): void => {
    const list = Array.from(edRef.current?.querySelectorAll('.rd-comment') ?? []) as HTMLElement[];
    if (!list.length) { notify(t('文档中暂无批注')); return; }
    cmtCursor.current = (cmtCursor.current + dir + list.length) % list.length;
    const el = list[cmtCursor.current]!;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('rd-flash'); setTimeout(() => el.classList.remove('rd-flash'), 1200);
  };
  const resolveChange = (accept: boolean): void => {
    const root = edRef.current; if (!root) return;
    restoreSel();
    let e: Node | null = window.getSelection()?.anchorNode ?? null;
    while (e && e !== root) { if (e instanceof HTMLElement && (e.tagName === 'INS' || e.tagName === 'DEL')) break; e = e.parentNode; }
    let node = e instanceof HTMLElement && (e.tagName === 'INS' || e.tagName === 'DEL') ? e : (root.querySelector('ins,del') as HTMLElement | null);
    if (!node) { notify(t('没有可处理的修订')); return; }
    const isIns = node.tagName === 'INS';
    if ((accept && isIns) || (!accept && !isIns)) { if (node.parentNode) { while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node); node.parentNode.removeChild(node); } }
    else node.remove();
    persist();
    notify(accept ? t('已接受修订') : t('已拒绝修订'));
  };

  // ── 排列(图片/对象) ──
  const selImg = (): HTMLElement | null => {
    const root = edRef.current; if (!root) return null;
    if (lastImg.current && root.contains(lastImg.current)) return lastImg.current; // 最近点选的对象(Word 式:点图选图)
    const s = window.getSelection();
    if (s && s.rangeCount) { const found = (Array.from(root.querySelectorAll('img,svg,.rd-textbox')) as HTMLElement[]).find((x) => s.containsNode(x, true)); if (found) return found; }
    return root.querySelector('img,svg') as HTMLElement | null;
  };
  const arrangeImg = (fn: (el: HTMLElement) => void): void => { const el = selImg(); if (!el) { notify(t('请先选中图片/对象')); return; } fn(el); persist(); };
  const zStep = (d: number): void => arrangeImg((el) => { el.style.position = 'relative'; el.style.zIndex = String((parseInt(getComputedStyle(el).zIndex, 10) || 0) + d); });
  const rotateImg = (kind: string): void => arrangeImg((el) => {
    const cur = el.style.transform || '';
    if (kind === 'right') el.style.transform = cur + ' rotate(90deg)';
    else if (kind === 'left') el.style.transform = cur + ' rotate(-90deg)';
    else if (kind === 'flipH') el.style.transform = cur + ' scaleX(-1)';
    else el.style.transform = cur + ' scaleY(-1)';
  });

  // ── 视图 / 缩放 ──
  const setView = (v: PageState['view'] | undefined): void => setPage((p) => ({ ...p, view: v }));
  const fitZoom = (mode: 'page' | 'width' | number): void => {
    const el = edRef.current; const sc = el?.parentElement;
    if (!el || !sc) return;
    if (typeof mode === 'number') { setPage((p) => ({ ...p, zoom: mode })); return; }
    el.style.zoom = ''; // 先复位到 100% 以取真实尺寸
    const z = mode === 'width' ? (sc.clientWidth - 52) / el.offsetWidth : Math.min((sc.clientHeight - 52) / el.offsetHeight, (sc.clientWidth - 52) / el.offsetWidth);
    setPage((p) => ({ ...p, zoom: Math.max(0.2, Math.round(z * 100) / 100) }));
  };
  const openWordCount = (): void => {
    const root = edRef.current; if (!root) return;
    const sel = savedRange.current?.toString() ?? '';
    const txt = sel || (cleanClone(root).textContent ?? ''); // 字数按清样投影算,del 旧文不虚增
    const noSpace = txt.replace(/\s/g, '');
    const cjk = (txt.match(/[一-龥]/g) ?? []).length;
    const words = cjk + (txt.replace(/[一-龥]/g, ' ').match(/[A-Za-z0-9]+/g) ?? []).length;
    const paras = root.querySelectorAll(BLOCK_SEL).length;
    setWc({ chars: txt.length, noSpace: noSpace.length, cjk, words, paras });
  };
  const refreshNav = (): void => {
    const root = edRef.current; if (!root) return;
    const heads = Array.from(root.querySelectorAll('h1,h2,h3')) as HTMLElement[];
    setNav(heads.map((h, i) => ({ level: parseInt(h.tagName.slice(1), 10), text: h.textContent ?? '(空标题)', idx: i })));
  };
  const toggleNav = (): void => { setPage((p) => { const on = !p.nav; if (on) setTimeout(refreshNav, 0); return { ...p, nav: on }; }); };
  const navTo = (i: number): void => { const h = (edRef.current?.querySelectorAll('h1,h2,h3')[i]) as HTMLElement | undefined; h?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  // 样式画廊
  const applyStyle = (name: string): void => {
    restoreSel();
    const blocks = blocksInSel();
    const stripCls = (el: HTMLElement): void => el.classList.remove('rd-nospacing', 'rd-title', 'rd-subtitle');
    switch (name) {
      case '正文': document.execCommand('formatBlock', false, 'p'); document.execCommand('removeFormat'); blocks.forEach(stripCls); break;
      case '无间隔': document.execCommand('formatBlock', false, 'p'); blocksInSel().forEach((el) => { stripCls(el); el.classList.add('rd-nospacing'); }); break;
      case '标题1': document.execCommand('formatBlock', false, 'h1'); break;
      case '标题2': document.execCommand('formatBlock', false, 'h2'); break;
      case '标题3': document.execCommand('formatBlock', false, 'h3'); break;
      case '标题': document.execCommand('formatBlock', false, 'h1'); blocksInSel().forEach((el) => { stripCls(el); el.classList.add('rd-title'); }); break;
      case '副标题': document.execCommand('formatBlock', false, 'p'); blocksInSel().forEach((el) => { stripCls(el); el.classList.add('rd-subtitle'); }); break;
      case '引用': document.execCommand('formatBlock', false, 'blockquote'); break;
      case '强调': wrapSel(() => { /* class 载体 */ }, 'rd-emphasis'); break;
      default: break;
    }
    persist();
    if (page.nav) refreshNav();
  };

  const openPop = (key: string, el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    setPop({ key, x: Math.min(r.left, window.innerWidth - 260), y: r.bottom + 4 });
    if (tipTimer.current) window.clearTimeout(tipTimer.current);
    setTip(null);
  };

  // ── Office 式即时悬浮提示:委托到功能区,读 [data-cmd] 的 aria-label,短延迟显示 ──
  const onRibbonOver = (e: React.MouseEvent): void => {
    const el = (e.target as HTMLElement).closest?.('[data-cmd]') as HTMLElement | null;
    if (!el) return;
    const label = el.getAttribute('aria-label') ?? '';
    if (!label) return;
    if (tipTimer.current) window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      setTip({ text: label, x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom + 7) });
    }, 130);
  };
  const onRibbonOut = (e: React.MouseEvent): void => {
    const from = (e.target as HTMLElement).closest?.('[data-cmd]');
    const to = e.relatedTarget as Node | null;
    if (from && to && from.contains(to)) return; // 仍在同一按钮内移动,不关
    if (tipTimer.current) window.clearTimeout(tipTimer.current);
    setTip(null);
  };

  // ── 直接动作分发(非弹层项) ──
  const run = (label: string): void => {
    switch (label) {
      case '撤销': exec('undo'); break;
      case '重做': exec('redo'); break;
      case '剪切': exec('cut'); break;
      case '复制': exec('copy'); break;
      case '格式刷': capturePaint(); break;
      case '增大字号': stepFont(1); break;
      case '减小字号': stepFont(-1); break;
      case '清除格式': exec('removeFormat'); document.execCommand('formatBlock', false, 'p'); persist(); break;
      case '加粗': exec('bold'); break;
      case '斜体': exec('italic'); break;
      case '下划线': exec('underline'); break;
      case '删除线': exec('strikeThrough'); break;
      case '下标': exec('subscript'); break;
      case '上标': exec('superscript'); break;
      case '拼音指南': ruby(); break;
      case '带圈字符': insertEnclosed(); break;
      case '项目符号': exec('insertUnorderedList'); break;
      case '编号': exec('insertOrderedList'); break;
      case '减少缩进': exec('outdent'); break;
      case '增加缩进': exec('indent'); break;
      case '左对齐': exec('justifyLeft'); break;
      case '居中': exec('justifyCenter'); break;
      case '右对齐': exec('justifyRight'); break;
      case '两端对齐': exec('justifyFull'); break;
      case '分散对齐': styleBlocks((el) => { el.style.textAlign = 'justify'; el.style.textAlignLast = 'justify'; }); break;
      case '空白页': insertHTML('<div class="rd-pagebreak" contenteditable="false"></div><p><br></p><div class="rd-pagebreak" contenteditable="false"></div>'); break;
      case '分页': insertHTML('<div class="rd-pagebreak" contenteditable="false"></div>'); break;
      case '图片': fileRef.current?.click(); break;
      case '屏幕截图': void takeScreenshot(); break;
      case '链接': insertLink(); break;
      case '书签': insertBookmark(); break;
      case '交叉引用': insertXref(); break;
      case '页眉': toggleHeaderFooter('header'); break;
      case '页脚': toggleHeaderFooter('footer'); break;
      case '文本框': insertTextbox(); break;
      case '签名行': insertSign(); break;
      case '对象': objRef.current?.click(); break;
      case '水平线': exec('insertHorizontalRule'); break;
      case '上移一层': zStep(1); break;
      case '下移一层': zStep(-1); break;
      case '选择窗格': notify(t('对象选择窗格暂不可用')); break;
      case '更新目录': updateToc(); break;
      case '插入脚注': insertNote('fn'); break;
      case '插入尾注': insertNote('en'); break;
      case '下一条脚注': nextNote(); break;
      case '显示备注': showNotes(); break;
      case '书目': insertBiblio(); break;
      case '管理源': notify(t('源管理暂用文档内直接编辑')); break;
      case '插入题注': insertCaption(); break;
      case '插入表目录': insertTof(); break;
      case '标记条目': markIndex(); break;
      case '插入索引': buildIndex(false); break;
      case '更新索引': buildIndex(true); break;
      case '拼写和语法': setPage((p) => ({ ...p, spell: !p.spell })); break;
      case '字数统计': openWordCount(); break;
      case '翻译': notify(t('可把选中文字交给右侧 Agent 翻译')); break;
      case '新建批注': addComment(); break;
      case '删除': delComment(); break;
      case '上一条': navComment(-1); break;
      case '下一条': navComment(1); break;
      case '显示批注': setPage((p) => ({ ...p, hideComments: !p.hideComments })); break;
      case '修订': setPage((p) => ({ ...p, track: !p.track })); notify(t('修订标记视图') + ' · ' + (page.track ? t('关') : t('开'))); break;
      case '显示标记': setDiffView((v) => (v === 'final' ? 'mark' : 'final')); break; // 与四态切换条同一状态源,不再双头管理
      case '接受': resolveChange(true); break;
      case '拒绝': resolveChange(false); break;
      case '阅读视图': setView('read'); break;
      case '页面视图': setView(undefined); break;
      case 'Web 版式': setView('web'); break;
      case '大纲': setView('outline'); break;
      case '标尺': setPage((p) => ({ ...p, ruler: !p.ruler })); break;
      case '网格线': setPage((p) => ({ ...p, grid: !p.grid })); break;
      case '导航窗格': toggleNav(); break;
      case '100%': setPage((p) => ({ ...p, zoom: 1 })); break;
      case '单页': fitZoom('page'); break;
      case '页宽': fitZoom('width'); break;
      case '多页': setPage((p) => ({ ...p, zoom: 0.5 })); break;
      case '获取加载项': case '我的加载项': notify(t('加载项市场开发中')); break;
      case '维基百科': { const q = savedRange.current?.toString() ?? ''; window.open('https://zh.wikipedia.org/wiki/Special:Search?search=' + encodeURIComponent(q), '_blank'); break; }
      default: notify(t('执行') + ' · ' + t(label));
    }
  };

  // ── 弹层内容 ──
  const PopItem = ({ label, sub, onPick, check }: { label: string; sub?: string; onPick: () => void; check?: boolean }): ReactNode => (
    <button className="drop-item" onMouseDown={(e) => { e.preventDefault(); onPick(); setPop(null); }}>
      {check ? <IconCheck size={13} /> : null}<span>{t(label)}</span>{sub ? <em className="di-sub">{sub}</em> : null}
    </button>
  );
  const closeAfter = (fn: () => void): void => { fn(); setPop(null); };

  const renderPop = (key: string): ReactNode => {
    switch (key) {
      case '粘贴': return <div className="drop-list">
        <PopItem label="保留源格式粘贴" onPick={() => void doPaste('rich')} />
        <PopItem label="合并格式" onPick={() => void doPaste('merge')} />
        <PopItem label="只保留文本" onPick={() => void doPaste('text')} />
      </div>;
      case '字体': return <div className="drop-list">{FONTS.map((f) => <button key={f} className="drop-item" style={{ fontFamily: f }} onMouseDown={(e) => { e.preventDefault(); closeAfter(() => setFont(f)); }}>{f}</button>)}</div>;
      case '字号': return <div className="drop-list">{SIZES.map((sz) => <PopItem key={sz} label={String(sz)} onPick={() => setSize(String(sz))} />)}</div>;
      case '更改大小写': return <div className="drop-list">{CASES.map(([lb, mode]) => <PopItem key={mode} label={lb} onPick={() => { restoreSel(); const txt = window.getSelection()?.toString() ?? ''; if (txt) insertText(transformCase(txt, mode)); }} />)}</div>;
      case '文本效果': return <div className="drop-list">{EFFECTS.map(([lb, style]) => <button key={lb} className="drop-item" onMouseDown={(e) => { e.preventDefault(); closeAfter(() => lb === '无' ? exec('removeFormat') : wrapSel((sp) => Object.assign(sp.style, style))); }}>{t(lb)}</button>)}</div>;
      case '突出显示': case '底纹': case '字体颜色': {
        const isFore = key === '字体颜色';
        const isShade = key === '底纹';
        const palette = key === '突出显示' ? HILITES : COLORS;
        const apply = (c: string): void => {
          if (isFore) { lastFore.current = c; exec('foreColor', c); }
          else if (isShade) styleBlocks((el) => { el.style.backgroundColor = c === 'transparent' ? '' : c; });
          else { lastHi.current = c; exec('hiliteColor', c); }
        };
        return <div>
          <div className="drop-colors">{palette.map((c) => <button key={c} className="swatch" style={{ background: c }} title={c} onMouseDown={(e) => { e.preventDefault(); closeAfter(() => apply(c)); }} />)}</div>
          <div className="drop-list">
            <PopItem label={isShade ? '无填充' : '无颜色'} onPick={() => apply('transparent')} />
            {isFore ? <label className="drop-item drop-sec" onMouseDown={(e) => e.preventDefault()}>{t('更多颜色…')}<input type="color" style={{ marginLeft: 8 }} onChange={(e) => closeAfter(() => apply(e.target.value))} /></label> : null}
          </div>
        </div>;
      }
      case '多级列表': return <div className="drop-list"><PopItem label="转为编号列表" onPick={() => exec('insertOrderedList')} /><PopItem label="增加一级(缩进)" onPick={() => exec('indent')} /><PopItem label="减少一级" onPick={() => exec('outdent')} /></div>;
      case '中文版式': return <div className="drop-list">{CN_LAYOUTS.map(([lb, mode]) => <PopItem key={mode} label={lb} onPick={() => {
        if (mode === 'enclose') insertEnclosed();
        else if (mode === 'twolines') wrapSel((sp) => { sp.style.display = 'inline-block'; sp.style.lineHeight = '1'; sp.style.fontSize = '.6em'; sp.style.whiteSpace = 'pre-line'; });
        else wrapSel((sp) => { sp.style.display = 'inline-block'; sp.style.transform = `scaleX(${mode === 'scale80' ? 0.8 : 1.5})`; });
      }} />)}</div>;
      case '排序': return <div className="drop-list">{[['升序', 1], ['降序', -1]].map(([lb, dir]) => <PopItem key={lb as string} label={lb as string} onPick={() => {
        restoreSel();
        const blocks = blocksInSel();
        if (blocks.length < 2) { notify(t('请选择多个段落再排序')); return; }
        const parent = blocks[0]!.parentNode;
        const sorted = [...blocks].sort((a, b) => (a.textContent ?? '').localeCompare(b.textContent ?? '', 'zh-Hans-CN') * (dir as number));
        sorted.forEach((el) => parent?.appendChild(el));
        persist();
      }} />)}</div>;
      case '行距': return <div className="drop-list">{LINE_SPACINGS.map((v) => <PopItem key={v} label={v} onPick={() => setLineSpacing(v)} />)}<div className="drop-sec"><PopItem label="增加段前间距" onPick={() => styleBlocks((el) => { el.style.marginTop = (parseFloat(el.style.marginTop || '0') + 6) + 'pt'; })} /><PopItem label="增加段后间距" onPick={() => styleBlocks((el) => { el.style.marginBottom = (parseFloat(el.style.marginBottom || '0') + 6) + 'pt'; })} /></div></div>;
      case '边框': return <div className="drop-list">{BORDERS.map(([lb, side]) => <PopItem key={lb} label={lb} onPick={() => styleBlocks((el) => {
        el.style.border = ''; el.style.borderTop = el.style.borderBottom = el.style.borderLeft = el.style.borderRight = '';
        const b = '1px solid #333';
        if (side === 'all') el.style.border = b;
        else if (side === 'top') el.style.borderTop = b;
        else if (side === 'bottom') el.style.borderBottom = b;
        else if (side === 'left') el.style.borderLeft = b;
        else if (side === 'right') el.style.borderRight = b;
        if (side !== 'none') el.style.padding = '2px 6px';
      })} />)}</div>;
      case '查找': return <div className="rd-find"><input className="rd-find-in" placeholder={t('查找内容')} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') findNext((e.target as HTMLInputElement).value); }} /><button className="rd-find-btn" onMouseDown={(e) => { e.preventDefault(); const inp = (e.currentTarget.previousSibling as HTMLInputElement); findNext(inp.value); }}>{t('查找下一个')}</button></div>;
      case '替换': return <div className="drop-list"><PopItem label="打开查找和替换" onPick={findReplace} /></div>;
      case '选择': return <div className="drop-list"><PopItem label="全选" onPick={() => exec('selectAll')} /><PopItem label="取消选择" onPick={() => window.getSelection()?.removeAllRanges()} /></div>;
      case '封面': return <div className="drop-gallery"><div className="dg-title">{t('封面样式')}</div><div className="dg-cells" style={{ width: 300 }}>{['rd-cover--a', 'rd-cover--b', 'rd-cover--c'].map((v, i) => <button key={v} className="dgcell" style={{ height: 76 }} onMouseDown={(e) => { e.preventDefault(); closeAfter(() => insertCover(v)); }}>{t('封面')} {i + 1}</button>)}</div></div>;
      case '表格': return <TableGrid onPick={(r, c) => closeAfter(() => insertTable(r, c))} onMore={() => closeAfter(insertTablePrompt)} />;
      case '形状': return <div className="drop-gallery"><div className="dg-cells" style={{ gridTemplateColumns: 'repeat(3,1fr)', width: 180 }}>{SHAPES.map(([name, svg]) => <button key={name} className="dgcell" title={t(name)} style={{ padding: 6 }} onMouseDown={(e) => { e.preventDefault(); closeAfter(() => insertShape(svg)); }}><svg width="46" height="30" viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="4">{/* preview */}</svg><span style={{ display: 'block', fontSize: 10 }}>{t(name)}</span></button>)}</div></div>;
      case '图标': return <SymGrid sets={{ 图标: SYMBOLS.箭头 ?? [] }} onPick={(ch) => closeAfter(() => insertText(ch))} />;
      case 'SmartArt': return <div className="drop-list">{['流程', '列表', '循环', '层次'].map((k) => <PopItem key={k} label={'SmartArt · ' + k} onPick={() => insertHTML(`<div class="rd-smartart" contenteditable="false"><span>${k}①</span><span>${k}②</span><span>${k}③</span></div>`)} />)}</div>;
      case '图表': return <div className="drop-list">{['柱形图', '折线图', '饼图'].map((k) => <PopItem key={k} label={k} onPick={() => insertHTML(`<div class="rd-chart" contenteditable="false">${k === '饼图' ? '<svg width="120" height="90" viewBox="0 0 42 42"><circle r="16" cx="21" cy="21" fill="#2563eb"/><path d="M21 5 A16 16 0 0 1 37 21 L21 21 Z" fill="#8b5cf6"/></svg>' : '<svg width="140" height="90" viewBox="0 0 140 90"><rect x="16" y="40" width="18" height="42" fill="#2563eb"/><rect x="46" y="24" width="18" height="58" fill="#60a5fa"/><rect x="76" y="52" width="18" height="30" fill="#8b5cf6"/><rect x="106" y="14" width="18" height="68" fill="#2563eb"/></svg>'}<div class="rd-chart-cap">${k} · 示意</div></div><p><br></p>`)} />)}</div>;
      case '页码': return <div className="drop-list">{['页脚居中', '页脚居右', '页眉居右'].map((k) => <PopItem key={k} label={k} onPick={() => { toggleHeaderFooter(k.startsWith('页眉') ? 'header' : 'footer'); const cls = k.startsWith('页眉') ? 'rd-header' : 'rd-footer'; const box = edRef.current?.querySelector('.' + cls); if (box) { box.insertAdjacentHTML('beforeend', ' <span class="rd-pagenum">1</span>'); (box as HTMLElement).style.textAlign = k.endsWith('居右') ? 'right' : 'center'; persist(); } }} />)}</div>;
      case '文档部件': return <div className="drop-list">{[['作者', '作者姓名'], ['文档标题', document.title || '实训报告'], ['当前日期', DATE_FMTS()[1]?.[1] ?? '']].map(([lb, val]) => <PopItem key={lb} label={lb!} onPick={() => insertText(val!)} />)}</div>;
      case '艺术字': return <div className="drop-gallery"><div className="dg-cells" style={{ gridTemplateColumns: 'repeat(2,1fr)', width: 220 }}>{WORDARTS.map((c, i) => <button key={c} className={'dgcell rd-wordart ' + c} style={{ fontSize: 18, padding: 10 }} onMouseDown={(e) => { e.preventDefault(); closeAfter(() => insertWordArt(c)); }}>A{i + 1}</button>)}</div></div>;
      case '首字下沉': return <div className="drop-list">{['无', '下沉', '悬挂'].map((m) => <PopItem key={m} label={m} onPick={() => dropCap(m)} />)}</div>;
      case '日期和时间': return <div className="drop-list">{DATE_FMTS().map(([lb, val]) => <PopItem key={lb} label={lb} onPick={() => insertText(val)} />)}</div>;
      case '公式': return <div className="drop-list">{EQUATIONS.map((eq) => <button key={eq} className="drop-item" onMouseDown={(e) => { e.preventDefault(); closeAfter(() => insertHTML(`<span class="rd-eq">${eq}</span>`)); }}>{eq}</button>)}</div>;
      case '符号': return <SymGrid sets={SYMBOLS} onPick={(ch) => closeAfter(() => insertText(ch))} />;
      case '文字方向': return <div className="drop-list"><PopItem label="水平" check={page.writing !== 'v'} onPick={() => setPage((p) => ({ ...p, writing: undefined }))} /><PopItem label="垂直(从右向左)" check={page.writing === 'v'} onPick={() => setPage((p) => ({ ...p, writing: 'v' }))} /></div>;
      case '页边距': return <div className="drop-list">{MARGINS.map(([lb, , sub]) => <PopItem key={lb} label={lb} sub={sub} check={page.margin === lb} onPick={() => setPage((p) => ({ ...p, margin: lb }))} />)}<div className="drop-sec"><PopItem label="恢复默认" onPick={() => setPage((p) => ({ ...p, margin: undefined }))} /></div></div>;
      case '纸张方向': return <div className="drop-list"><PopItem label="纵向" check={page.orient !== 'landscape'} onPick={() => setPage((p) => ({ ...p, orient: 'portrait' }))} /><PopItem label="横向" check={page.orient === 'landscape'} onPick={() => setPage((p) => ({ ...p, orient: 'landscape' }))} /></div>;
      case '纸张大小': return <div className="drop-list">{Object.keys(PAPERS).map((k) => <PopItem key={k} label={k} sub={`${PAPERS[k]![0]}×${PAPERS[k]![1]}`} check={(page.size ?? 'A4') === k} onPick={() => setPage((p) => ({ ...p, size: k }))} />)}</div>;
      case '栏': return <div className="drop-list">{COLUMNS.map(([lb, n]) => <PopItem key={lb} label={lb} check={(page.columns ?? 1) === n} onPick={() => setPage((p) => ({ ...p, columns: n }))} />)}</div>;
      case '分隔符': return <div className="drop-list"><PopItem label="分页符" onPick={() => insertHTML('<div class="rd-pagebreak" contenteditable="false"></div>')} /><PopItem label="分栏符" onPick={() => insertHTML('<span style="break-after:column"></span>')} /><PopItem label="自动换行符" onPick={() => insertHTML('<br>')} /></div>;
      case '行号': return <div className="drop-list"><PopItem label="无" check={!page.lineNums} onPick={() => setPage((p) => ({ ...p, lineNums: false }))} /><PopItem label="连续" check={!!page.lineNums} onPick={() => setPage((p) => ({ ...p, lineNums: true }))} /></div>;
      case '断字': return <div className="drop-list"><PopItem label="无" check={!page.hyphens} onPick={() => setPage((p) => ({ ...p, hyphens: false }))} /><PopItem label="自动" check={!!page.hyphens} onPick={() => setPage((p) => ({ ...p, hyphens: true }))} /></div>;
      case '稿纸设置': return <div className="drop-list"><PopItem label="方格式稿纸" onPick={() => { if (edRef.current) { edRef.current.style.backgroundImage = 'linear-gradient(#e3e4e7 1px,transparent 1px),linear-gradient(90deg,#e3e4e7 1px,transparent 1px)'; edRef.current.style.backgroundSize = '24px 24px'; } }} /><PopItem label="行线式稿纸" onPick={() => { if (edRef.current) { edRef.current.style.backgroundImage = 'linear-gradient(#e3e4e7 1px,transparent 1px)'; edRef.current.style.backgroundSize = '100% 30px'; } }} /><PopItem label="非稿纸文档" onPick={() => { if (edRef.current) edRef.current.style.backgroundImage = ''; }} /></div>;
      case '位置': return <div className="drop-list"><PopItem label="居左环绕" onPick={() => arrangeImg((el) => { el.style.cssText += ';float:left;margin:4px 12px 4px 0'; })} /><PopItem label="居中" onPick={() => arrangeImg((el) => { el.style.cssText += ';display:block;float:none;margin:8px auto'; })} /><PopItem label="居右环绕" onPick={() => arrangeImg((el) => { el.style.cssText += ';float:right;margin:4px 0 4px 12px'; })} /></div>;
      case '环绕文字': return <div className="drop-list"><PopItem label="嵌入型" onPick={() => arrangeImg((el) => { el.style.float = 'none'; el.style.display = 'inline'; })} /><PopItem label="四周型" onPick={() => arrangeImg((el) => { el.style.float = 'left'; el.style.margin = '4px 12px'; })} /><PopItem label="上下型" onPick={() => arrangeImg((el) => { el.style.float = 'none'; el.style.display = 'block'; el.style.margin = '8px 0'; })} /></div>;
      case '对齐': return <div className="drop-list"><PopItem label="左对齐" onPick={() => arrangeImg((el) => { el.style.display = 'block'; el.style.margin = '4px auto 4px 0'; })} /><PopItem label="水平居中" onPick={() => arrangeImg((el) => { el.style.display = 'block'; el.style.margin = '4px auto'; })} /><PopItem label="右对齐" onPick={() => arrangeImg((el) => { el.style.display = 'block'; el.style.margin = '4px 0 4px auto'; })} /></div>;
      case '组合': return <div className="drop-list"><PopItem label="组合" onPick={() => wrapSel((sp) => { sp.style.display = 'inline-block'; }, 'rd-group')} /><PopItem label="取消组合" onPick={() => { restoreSel(); let e: Node | null = window.getSelection()?.anchorNode ?? null; while (e && e !== edRef.current) { if (e instanceof HTMLElement && e.classList.contains('rd-group')) { const p = e.parentNode; if (p) { while (e.firstChild) p.insertBefore(e.firstChild, e); p.removeChild(e); } break; } e = e.parentNode; } persist(); }} /></div>;
      case '旋转': return <div className="drop-list"><PopItem label="向右旋转 90°" onPick={() => rotateImg('right')} /><PopItem label="向左旋转 90°" onPick={() => rotateImg('left')} /><PopItem label="水平翻转" onPick={() => rotateImg('flipH')} /><PopItem label="垂直翻转" onPick={() => rotateImg('flipV')} /></div>;
      case '目录': return <div className="drop-gallery"><div className="dg-title">{t('自动目录')}</div><div className="drop-list"><PopItem label="插入自动目录" onPick={buildToc} /><PopItem label="更新目录" onPick={updateToc} /></div></div>;
      case '添加文字': return <div className="drop-list">{[['级别 1', 'h1'], ['级别 2', 'h2'], ['级别 3', 'h3'], ['不在目录中显示', 'p']].map(([lb, tag]) => <PopItem key={lb} label={lb!} onPick={() => exec('formatBlock', tag!)} />)}</div>;
      case '插入引文': return <div className="drop-list"><PopItem label="(作者, 2026)" onPick={insertCitation} /><PopItem label="添加新源…" onPick={() => notify(t('可在文档内直接编辑引文'))} /></div>;
      case '样式': return <div className="drop-list">{['GB/T 7714', 'APA', 'MLA', 'Chicago', 'IEEE'].map((s) => <PopItem key={s} label={s} onPick={() => notify(t('引文样式') + ' · ' + s)} />)}</div>;
      case '语言': return <div className="drop-list">{[['中文(简体)', 'zh-CN'], ['English', 'en-US'], ['日本語', 'ja-JP']].map(([lb, code]) => <PopItem key={code} label={lb!} check={(page.lang ?? 'zh-CN') === code} onPick={() => setPage((p) => ({ ...p, lang: code }))} />)}</div>;
      case '缩放': return <div className="drop-list">{ZOOMS.map((z) => <PopItem key={z} label={z + '%'} check={Math.round((page.zoom ?? 1) * 100) === z} onPick={() => setPage((p) => ({ ...p, zoom: z / 100 }))} />)}<div className="drop-sec"><PopItem label="页宽" onPick={() => fitZoom('width')} /><PopItem label="整页" onPick={() => fitZoom('page')} /></div></div>;
      default: return <div className="drop-list"><PopItem label={key} onPick={() => run(key)} /></div>;
    }
  };

  // ── 单元格渲染 ──
  const isActive = (label: string): boolean => (
    (label === '加粗' && st.bold) || (label === '斜体' && st.italic) || (label === '下划线' && st.underline) || (label === '删除线' && st.strike) ||
    (label === '项目符号' && st.ul) || (label === '编号' && st.ol) ||
    (label === '左对齐' && st.align === 'left') || (label === '居中' && st.align === 'center') || (label === '右对齐' && st.align === 'right') || (label === '两端对齐' && st.align === 'justify') ||
    (label === '标尺' && !!page.ruler) || (label === '网格线' && !!page.grid) || (label === '导航窗格' && !!page.nav) ||
    (label === '拼写和语法' && !!page.spell) || (label === '修订' && !!page.track) ||
    (label === '阅读视图' && page.view === 'read') || (label === '页面视图' && !page.view) || (label === 'Web 版式' && page.view === 'web') || (label === '大纲' && page.view === 'outline')
  );
  const MENU = new Set(['粘贴', '字体', '字号', '更改大小写', '文本效果', '多级列表', '中文版式', '排序', '行距', '底纹', '边框', '查找', '替换', '选择', '封面', '表格', '形状', '图标', 'SmartArt', '图表', '页码', '文档部件', '艺术字', '首字下沉', '日期和时间', '公式', '符号', '文字方向', '页边距', '纸张方向', '纸张大小', '栏', '分隔符', '行号', '断字', '稿纸设置', '位置', '环绕文字', '对齐', '组合', '旋转', '目录', '添加文字', '插入引文', '样式', '语言', '缩放']);
  const GLYPH: Record<string, ReactNode> = { 加粗: <b>B</b>, 斜体: <i>I</i>, 下划线: <u>U</u> };

  const clickCell = (label: string, e: React.MouseEvent<HTMLElement>): void => { e.preventDefault(); if (MENU.has(label)) openPop(label, e.currentTarget); else run(label); };

  const Big = ({ label, icon }: { label: string; icon: IconCmp }): ReactNode => {
    const Ico = icon;
    return <button className="rbig" aria-label={t(label)} data-cmd={label} onMouseDown={(e) => clickCell(label, e)}><span className="rbig-ic"><Ico size={20} /></span><span className="rbig-lb">{t(label)}{MENU.has(label) ? ' ▾' : ''}</span></button>;
  };
  const Small = ({ label, icon, accent }: { label: string; icon?: IconCmp; accent?: 'red' | 'amber' }): ReactNode => {
    const Ico = icon;
    const g = GLYPH[label];
    return <button className={'rs' + (g ? ' biu biu-' + (label === '加粗' ? 'b' : label === '斜体' ? 'i' : 'u') : '') + (accent === 'red' ? ' ic-red' : accent === 'amber' ? ' ic-amber' : '') + (isActive(label) ? ' on' : '')} aria-label={t(label)} data-cmd={label} onMouseDown={(e) => clickCell(label, e)}>
      {g ?? (Ico ? <Ico size={15} /> : t(label))}{MENU.has(label) ? <span className="caret">▾</span> : null}
    </button>;
  };
  const Combo = ({ label, cls }: { label: string; cls: string }): ReactNode => {
    const val = label === '字体' ? (st.font || t('字体')) : label === '字号' ? (st.size ? String(st.size) : t('字号')) : t(label);
    return <button className={'rcombo ' + cls + (pop?.key === label ? ' open' : '')} aria-label={t(label)} data-cmd={label} onMouseDown={(e) => { e.preventDefault(); openPop(label, e.currentTarget); }}><span className="rc-val">{val}</span><span className="caret">▾</span></button>;
  };
  const SplitColor = ({ label, icon, color }: { label: string; icon: IconCmp; color: 'fore' | 'hi' }): ReactNode => {
    const Ico = icon;
    const cur = color === 'fore' ? lastFore.current : lastHi.current;
    const apply = (): void => color === 'fore' ? exec('foreColor', cur) : exec('hiliteColor', cur);
    return <span className="rd-split" aria-label={t(label)} data-cmd={label}>
      <button className={'rd-split-main' + (color === 'fore' ? ' ic-red' : ' ic-amber')} onMouseDown={(e) => { e.preventDefault(); apply(); }}><Ico size={15} /><span className="rd-underbar" style={{ background: cur }} /></button>
      <button className="rd-split-caret" onMouseDown={(e) => { e.preventDefault(); openPop(label, e.currentTarget); }}>▾</button>
    </span>;
  };
  const Spin = ({ label, icon }: { label: string; icon: IconCmp }): ReactNode => {
    const Ico = icon;
    const step = (d: number): void => {
      if (label === '左缩进') styleBlocks((el) => { el.style.marginLeft = Math.max(0, parseFloat(el.style.marginLeft || '0') + d * 2) + 'em'; });
      else if (label === '右缩进') styleBlocks((el) => { el.style.marginRight = Math.max(0, parseFloat(el.style.marginRight || '0') + d * 2) + 'em'; });
      else if (label === '段前间距') styleBlocks((el) => { el.style.marginTop = Math.max(0, parseFloat(el.style.marginTop || '0') + d * 6) + 'pt'; });
      else styleBlocks((el) => { el.style.marginBottom = Math.max(0, parseFloat(el.style.marginBottom || '0') + d * 6) + 'pt'; });
    };
    return <span className="rd-num" aria-label={t(label)} data-cmd={label}><span className="rd-num-ic"><Ico size={13} /></span><span className="rd-num-lb">{t(label)}</span><button onMouseDown={(e) => { e.preventDefault(); step(-1); }}>−</button><button onMouseDown={(e) => { e.preventDefault(); step(1); }}>＋</button></span>;
  };

  type Cell =
    | { k: 'big'; label: string; icon: IconCmp }
    | { k: 'row'; items: { label: string; icon?: IconCmp; accent?: 'red' | 'amber' }[] }
    | { k: 'combo'; label: string; cls: string }
    | { k: 'split'; label: string; icon: IconCmp; color: 'fore' | 'hi' }
    | { k: 'styles' }
    | { k: 'spin'; label: string; icon: IconCmp };
  interface Grp { name: string; cells: Cell[] }
  interface TabDef { name: string; groups: Grp[] }

  const TABS: TabDef[] = [
    { name: '开始', groups: [
      { name: '剪贴板', cells: [{ k: 'big', label: '粘贴', icon: IconClipboard }, { k: 'row', items: [{ label: '剪切', icon: IconScissors }, { label: '复制', icon: IconCopy }, { label: '格式刷', icon: IconFormatBrush }] }] },
      { name: '字体', cells: [
        { k: 'combo', label: '字体', cls: 'font' }, { k: 'combo', label: '字号', cls: 'size' },
        { k: 'row', items: [{ label: '增大字号', icon: IconFontGrow }, { label: '减小字号', icon: IconFontShrink }, { label: '更改大小写', icon: IconChangeCase }, { label: '清除格式', icon: IconClearFormat }] },
        { k: 'row', items: [{ label: '加粗' }, { label: '斜体' }, { label: '下划线' }, { label: '删除线', icon: IconStrikethrough }, { label: '下标', icon: IconSubscript }, { label: '上标', icon: IconSuperscript }, { label: '文本效果', icon: IconTextEffect }, { label: '拼音指南', icon: IconPhonetic }, { label: '带圈字符', icon: IconEncloseChar }] },
        { k: 'split', label: '字体颜色', icon: IconFontColor, color: 'fore' }, { k: 'split', label: '突出显示', icon: IconHighlighter, color: 'hi' },
      ] },
      { name: '段落', cells: [
        { k: 'row', items: [{ label: '项目符号', icon: IconBulletsRb }, { label: '编号', icon: IconNumberingRb }, { label: '多级列表', icon: IconMultilevelListRb }, { label: '减少缩进', icon: IconIndentDecrease }, { label: '增加缩进', icon: IconIndentIncrease }, { label: '中文版式', icon: IconChineseLayoutRb }, { label: '排序', icon: IconSortAsc }] },
        { k: 'row', items: [{ label: '左对齐', icon: IconAlignLeft }, { label: '居中', icon: IconAlignCenter }, { label: '右对齐', icon: IconAlignRight }, { label: '两端对齐', icon: IconAlignJustify }, { label: '行距', icon: IconLineSpacing }, { label: '底纹', icon: IconShadingRb }, { label: '边框', icon: IconBorders }] },
      ] },
      { name: '样式', cells: [{ k: 'styles' }] },
      { name: '编辑', cells: [{ k: 'row', items: [{ label: '查找', icon: IconSearch }, { label: '替换', icon: IconReplace }, { label: '选择', icon: IconSelect }] }] },
    ] },
    { name: '插入', groups: [
      { name: '页面', cells: [{ k: 'big', label: '封面', icon: IconCoverPageRb }, { k: 'row', items: [{ label: '空白页', icon: IconBlankPageRb }, { label: '分页', icon: IconPageBreakRb }] }] },
      { name: '表格', cells: [{ k: 'big', label: '表格', icon: IconTable }] },
      { name: '插图', cells: [{ k: 'row', items: [{ label: '图片', icon: IconImage }, { label: '形状', icon: IconShapes }, { label: '图标', icon: IconStar }, { label: 'SmartArt', icon: IconSmartArt }, { label: '图表', icon: IconBarChart }, { label: '屏幕截图', icon: IconScreenshot }] }] },
      { name: '加载项', cells: [{ k: 'row', items: [{ label: '获取加载项', icon: IconAddin }, { label: '我的加载项', icon: IconVariantsRb }, { label: '维基百科', icon: IconHelp }] }] },
      { name: '链接', cells: [{ k: 'row', items: [{ label: '链接', icon: IconLink }, { label: '书签', icon: IconBookmark }, { label: '交叉引用', icon: IconCrossRef }] }] },
      { name: '页眉页脚', cells: [{ k: 'row', items: [{ label: '页眉', icon: IconHeader }, { label: '页脚', icon: IconFooter }, { label: '页码', icon: IconPageNumber }] }] },
      { name: '文本', cells: [{ k: 'row', items: [{ label: '文本框', icon: IconTextBox }, { label: '文档部件', icon: IconDocPartsRb }, { label: '艺术字', icon: IconWordArt }, { label: '首字下沉', icon: IconDropCapRb }, { label: '签名行', icon: IconSignatureLineRb }, { label: '日期和时间', icon: IconDateTime }, { label: '对象', icon: IconObject }] }] },
      { name: '符号', cells: [{ k: 'row', items: [{ label: '公式', icon: IconRoot }, { label: '符号', icon: IconOmega }, { label: '水平线', icon: IconHorizontalRule }] }] },
    ] },
    { name: '布局', groups: [
      { name: '页面设置', cells: [
        { k: 'big', label: '页边距', icon: IconMargins },
        { k: 'row', items: [{ label: '文字方向', icon: IconTextDirectionRb }, { label: '纸张方向', icon: IconOrientation }, { label: '纸张大小', icon: IconPaperSize }, { label: '栏', icon: IconColumnsRb }] },
        { k: 'row', items: [{ label: '分隔符', icon: IconSeparator }, { label: '行号', icon: IconLineNumbersRb }, { label: '断字', icon: IconHyphenationRb }] },
      ] },
      { name: '稿纸', cells: [{ k: 'big', label: '稿纸设置', icon: IconGridPaperRb }] },
      { name: '段落', cells: [{ k: 'spin', label: '左缩进', icon: IconIndentLeftRb }, { k: 'spin', label: '右缩进', icon: IconIndentRightRb }, { k: 'spin', label: '段前间距', icon: IconSpaceBeforeRb }, { k: 'spin', label: '段后间距', icon: IconSpaceAfterRb }] },
      { name: '排列', cells: [{ k: 'row', items: [{ label: '位置', icon: IconPositionRb }, { label: '环绕文字', icon: IconWrapTextRb }, { label: '上移一层', icon: IconBringForwardRb }, { label: '下移一层', icon: IconSendBackwardRb }, { label: '选择窗格', icon: IconSelectionPaneRb }, { label: '对齐', icon: IconAlignRb }, { label: '组合', icon: IconGroupRb }, { label: '旋转', icon: IconRotateRb }] }] },
    ] },
    { name: '引用', groups: [
      { name: '目录', cells: [{ k: 'big', label: '目录', icon: IconTocRb }, { k: 'row', items: [{ label: '添加文字', icon: IconAddTextRb }, { label: '更新目录', icon: IconUpdateTocRb }] }] },
      { name: '脚注', cells: [{ k: 'row', items: [{ label: '插入脚注', icon: IconFootnoteRb }, { label: '插入尾注', icon: IconEndnoteRb }, { label: '下一条脚注', icon: IconNextFootnoteRb }, { label: '显示备注', icon: IconShowNotesRb }] }] },
      { name: '引文与书目', cells: [{ k: 'row', items: [{ label: '插入引文', icon: IconCitationRb }, { label: '管理源', icon: IconManageSourcesRb }, { label: '样式', icon: IconStylesRb }, { label: '书目', icon: IconBibliographyRb }] }] },
      { name: '题注', cells: [{ k: 'row', items: [{ label: '插入题注', icon: IconCaptionRb }, { label: '插入表目录', icon: IconTableOfFiguresRb }, { label: '交叉引用', icon: IconCrossRef }] }] },
      { name: '索引', cells: [{ k: 'row', items: [{ label: '标记条目', icon: IconMarkEntryRb }, { label: '插入索引', icon: IconIndexRb }, { label: '更新索引', icon: IconUpdateIndexRb }] }] },
    ] },
    { name: '审阅', groups: [
      { name: '校对', cells: [{ k: 'big', label: '字数统计', icon: IconWordCountRb }, { k: 'row', items: [{ label: '拼写和语法', icon: IconSpellingRb }] }] },
      { name: '语言', cells: [{ k: 'row', items: [{ label: '翻译', icon: IconTranslate }, { label: '语言', icon: IconLanguage }] }] },
      { name: '批注', cells: [{ k: 'row', items: [{ label: '新建批注', icon: IconComment }, { label: '删除', icon: IconEraser }, { label: '上一条', icon: IconPreviousRb }, { label: '下一条', icon: IconNextItemRb }, { label: '显示批注', icon: IconShowComments }] }] },
      { name: '修订', cells: [{ k: 'big', label: '修订', icon: IconTrackChangesRb }, { k: 'row', items: [{ label: '显示标记', icon: IconShowMarkupRb }, { label: '接受', icon: IconAcceptRb }, { label: '拒绝', icon: IconRejectRb }] }] },
    ] },
    { name: '视图', groups: [
      { name: '视图', cells: [{ k: 'row', items: [{ label: '阅读视图', icon: IconReadingViewRb }, { label: '页面视图', icon: IconPageViewRb }, { label: 'Web 版式', icon: IconWebLayoutRb }, { label: '大纲', icon: IconOutlineRb }] }] },
      { name: '显示', cells: [{ k: 'row', items: [{ label: '标尺', icon: IconRulerRb }, { label: '网格线', icon: IconGridlines }, { label: '导航窗格', icon: IconNavPaneRb }] }] },
      { name: '缩放', cells: [{ k: 'big', label: '缩放', icon: IconZoomRb }, { k: 'row', items: [{ label: '100%', icon: IconZoom100Rb }, { label: '单页', icon: IconSinglePageRb }, { label: '页宽', icon: IconWidthRb }, { label: '多页', icon: IconMultiPageRb }] }] },
    ] },
  ];

  const renderCell = (cell: Cell, i: number): ReactNode => {
    switch (cell.k) {
      case 'big': return <Big key={i} label={cell.label} icon={cell.icon} />;
      case 'combo': return <Combo key={i} label={cell.label} cls={cell.cls} />;
      case 'split': return <SplitColor key={i} label={cell.label} icon={cell.icon} color={cell.color} />;
      case 'spin': return <Spin key={i} label={cell.label} icon={cell.icon} />;
      case 'styles': return <div className="rstyles" key={i}>{STYLE_CELLS.map(([name, kind, sample]) => <button key={name} className={'rstyle ' + kind} aria-label={t(name)} data-cmd={name} onMouseDown={(e) => { e.preventDefault(); applyStyle(name); }}>{t(sample)}</button>)}</div>;
      case 'row': return <div className="rsmall-grid" key={i}>{cell.items.map((it) => <Small key={it.label} label={it.label} icon={it.icon} accent={it.accent} />)}</div>;
      default: return null;
    }
  };

  const wrapCls = 'rd-wrap' + (page.view === 'read' ? ' rd-view-read' : page.view === 'web' ? ' rd-view-web' : page.view === 'outline' ? ' rd-view-outline' : '');
  const zoomPct = Math.round((page.zoom ?? 1) * 100);
  const active = TABS[tab] ?? TABS[0]!;

  return (
    <div className={wrapCls}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImg} />
      <input ref={objRef} type="file" hidden onChange={onPickObj} />
      <div className="ribbon rd-ribbon" onMouseOver={onRibbonOver} onMouseOut={onRibbonOut} onMouseDownCapture={() => { if (tipTimer.current) window.clearTimeout(tipTimer.current); setTip(null); }}>
        <div className="ribbon-tabs">
          {TABS.map((tb, i) => <button key={tb.name} className={'rtab' + (i === tab ? ' on' : '')} onClick={() => { setTab(i); localStorage.setItem(TAB_KEY, String(i)); }}>{t(tb.name)}</button>)}
          <span className="rd-tabs-grow" />
          <button className="rd-chip" aria-label={t('字数统计')} data-cmd="字数统计" onMouseDown={(e) => { e.preventDefault(); openWordCount(); }}><IconWordCountRb size={13} />{t('字数')} {(edRef.current ? (cleanClone(edRef.current).textContent ?? '').replace(/\s/g, '').length : 0)}</button>
          <button className="rd-chip" aria-label={t('缩放')} data-cmd="缩放" onMouseDown={(e) => { e.preventDefault(); openPop('缩放', e.currentTarget); }}>{zoomPct}%</button>
        </div>
        <div className="ribbon-bar">
          {active.groups.map((g) => (
            <div className="rgroup" key={g.name}>
              <div className="rgbody">{g.cells.map((c, i) => renderCell(c, i))}</div>
              <div className="rgname">{t(g.name)}</div>
            </div>
          ))}
        </div>
      </div>

      {page.ruler ? <div className="rd-ruler" /> : null}
      <div className="rd-stage">
        {hasDiff ? (
          <div className="rd-difftoggle" role="group" aria-label="Agent 修订视图">
            <span className="rd-dt-lb"><span className="rd-dt-dot" />Agent 修订</span>
            {chgCount > 0 ? <span className="rd-dt-count">{Math.min(stepPos + 1, chgCount)}<i>/</i>{chgCount}</span> : null}
            <div className="rd-dt-seg-wrap" data-active={diffView}>
              <span className="rd-dt-thumb" />
              {([['orig', '原文'], ['mark', '修订'], ['clean', '清样'], ['final', '改后']] as const).map(([v, lb]) => (
                <button key={v} className={'rd-dt-seg' + (diffView === v ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); setDiffView(v); }} title={v === 'orig' ? '只看改前' : v === 'mark' ? '红删绿增对照' : v === 'clean' ? '清样:只留改后 + 左侧改动条' : '只看改后'}>{lb}</button>
              ))}
            </div>
            <span className="rd-dt-nav">
              <button className="rd-dt-step" onMouseDown={(e) => { e.preventDefault(); step(-1); }} aria-label="上一处" title="上一处">‹</button>
              <button className="rd-dt-step" onMouseDown={(e) => { e.preventDefault(); step(1); }} aria-label="下一处" title="下一处">›</button>
            </span>
          </div>
        ) : null}
        {page.nav ? (
          <aside className="rd-nav">
            <div className="rd-nav-h">{t('导航')}</div>
            <div className="rd-nav-list">
              {nav.length === 0 ? <div className="rd-nav-empty">{t('暂无标题')}</div> : nav.map((h) => <button key={h.idx} className={'rd-nav-i lv' + h.level} onClick={() => navTo(h.idx)}>{h.text}</button>)}
            </div>
          </aside>
        ) : null}
        <div className="rd-scroll" onScroll={() => { setTip(null); if (cardTimer.current) window.clearTimeout(cardTimer.current); setHoverCard(null); }}>
          <div className="rd-page" ref={edRef} contentEditable suppressContentEditableWarning onInput={() => { persist(); refreshHasDiff(); if (page.nav) refreshNav(); }} onMouseUp={onEdMouseUp} onClick={onEdClick} onMouseOver={onDocOver} onMouseOut={onDocOut} onKeyDown={onEdKey} />
        </div>
      </div>

      {pop ? (
        <>
          <div className="drop-backdrop" onMouseDown={() => setPop(null)} />
          <div className="dropdown rd-pop" style={{ left: pop.x, top: pop.y }}>{renderPop(pop.key)}</div>
        </>
      ) : null}

      {wc ? (
        <>
          <div className="drop-backdrop" onMouseDown={() => setWc(null)} />
          <div className="rd-wc">
            <div className="rd-wc-h">{t('字数统计')}</div>
            {[['页数', '1'], ['字数', String(wc.words)], ['字符数(不计空格)', String(wc.noSpace)], ['字符数(计空格)', String(wc.chars)], ['中文字符', String(wc.cjk)], ['段落数', String(wc.paras)]].map(([k, v]) => (
              <div className="rd-wc-row" key={k}><span>{t(k!)}</span><b>{v}</b></div>
            ))}
            <button className="rd-wc-close" onMouseDown={(e) => { e.preventDefault(); setWc(null); }}>{t('关闭')}</button>
          </div>
        </>
      ) : null}

      {hoverCard ? (
        <div className={'rd-cardwrap' + (hoverCard.below ? ' below' : '')} style={{ left: hoverCard.x, top: hoverCard.y }} onMouseEnter={keepCard} onMouseLeave={closeCard}>
          <div className="rd-card">
            <div className="rd-card-h"><span className="rd-card-dot" /><span className="rd-card-kind">{({ replace: '替换', insert: '插入', delete: '删除', format: '改格式' } as Record<string, string>)[hoverCard.kind] ?? '改动'}</span></div>
            {hoverCard.kind === 'format' ? (
              <div className="rd-card-fmt"><span className="rd-fmt-chip">{hoverCard.glyph}</span>{hoverCard.newText}</div>
            ) : (
              <div className="rd-card-diff">{hoverCard.oldText ? <span className="rd-card-old">{hoverCard.oldText}</span> : null}{hoverCard.oldText && hoverCard.newText ? <span className="rd-card-arw">→</span> : null}{hoverCard.newText ? <span className="rd-card-new">{hoverCard.newText}</span> : null}</div>
            )}
            <div className="rd-card-acts">
              <button className="rd-cbtn no" onMouseDown={(e) => { e.preventDefault(); resolveCb.current?.(hoverCard.cid, 'reject'); closeCard(); }}>✕ 拒绝</button>
              <button className="rd-cbtn ok" onMouseDown={(e) => { e.preventDefault(); resolveCb.current?.(hoverCard.cid, 'accept'); closeCard(); }}>✓ 接受</button>
            </div>
          </div>
        </div>
      ) : null}
      {tip ? <div className="rd-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div> : null}
      {toast ? <div className="rd-toast">{toast}</div> : null}
    </div>
  );
});

/** 表格网格选择器:悬停高亮 N×M。 */
function TableGrid({ onPick, onMore }: { onPick: (r: number, c: number) => void; onMore: () => void }): ReactNode {
  const t = useT();
  const [hot, setHot] = useState<[number, number]>([0, 0]);
  const ROWS = 8, COLS = 10;
  return (
    <div>
      <div className="rd-tgrid" onMouseLeave={() => setHot([0, 0])}>
        {Array.from({ length: ROWS * COLS }, (_, i) => {
          const r = Math.floor(i / COLS) + 1, c = (i % COLS) + 1;
          const on = r <= hot[0] && c <= hot[1];
          return <i key={i} className={on ? 'hot' : ''} onMouseEnter={() => setHot([r, c])} onMouseDown={(e) => { e.preventDefault(); onPick(r, c); }} />;
        })}
      </div>
      <div className="rd-tgrid-cap">{hot[0] ? `${hot[1]} × ${hot[0]} ${t('表格')}` : t('插入表格')}</div>
      <div className="drop-list"><button className="drop-item drop-sec" onMouseDown={(e) => { e.preventDefault(); onMore(); }}>{t('插入表格…')}</button></div>
    </div>
  );
}

/** 符号网格,带分类页签。 */
function SymGrid({ sets, onPick }: { sets: Record<string, string[]>; onPick: (ch: string) => void }): ReactNode {
  const t = useT();
  const keys = Object.keys(sets);
  const [cat, setCat] = useState(keys[0] ?? '');
  return (
    <div>
      <div className="rd-symtabs">{keys.map((k) => <button key={k} className={'rd-symtab' + (k === cat ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); setCat(k); }}>{t(k)}</button>)}</div>
      <div className="rd-symgrid">{(sets[cat] ?? []).map((ch, i) => <button key={ch + i} onMouseDown={(e) => { e.preventDefault(); onPick(ch); }}>{ch}</button>)}</div>
    </div>
  );
}

export default RichDoc;
