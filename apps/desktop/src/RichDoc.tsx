/**
 * 自控富文本「Word」编辑器 —— 仿 Microsoft Word 的多选项卡功能区(Ribbon)。
 * 复用全站 Excel 功能区的视觉系统(.ribbon/.rgroup/.rbig/.rs/.rcombo/.rstyle),做到「和 Excel 一样广」;
 * 六个选项卡:开始 / 插入 / 布局 / 引用 / 审阅 / 视图,绝大多数命令对 contentEditable【真生效】。
 * 交互全部用 onMouseDown+preventDefault 保住选区(savedRange);弹层点外部关闭。
 * Agent 改动仍由 applyEdit/revert/highlight 完全掌控地落到文档(按 editId 包裹,可逐条还原)。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useT } from './i18n.js';
import { RichDocRibbon } from './RichDocRibbon.js';
import {
  RichDocChangeCard,
  RichDocNavigationPane,
  RichDocRevisionBar,
  RichDocWordCountDialog,
} from './RichDocReview.js';
import type { RichDocDiffView, RichDocHoverCardState, RichDocWordCount } from './RichDocReview.js';
import {
  RICH_DOC_BLOCK_TAGS as BLOCK_TAGS,
  applyRichDocEdit,
  escapeCssAttribute as cssq,
  findRange,
  styleSpan,
} from './richdoc-editing.js';
import type {
  DocFmt,
  DocTable,
  RichDocEditOptions,
  RichDocUndoEntry,
} from './richdoc-editing.js';
import {
  closeRichDocUndoWindow,
  resolveRichDocRevision,
  revertRichDocRevision,
} from './richdoc-revisions.js';
import type { RichDocRevisionContext } from './richdoc-revisions.js';
import {
  RICH_TEXT_BLOCK_SELECTOR as BLOCK_SEL,
  cleanBlockText,
  cleanClone,
  getRichDocContext,
  getRichDocSnapshot,
  getRichDocText,
  sanitizeHtml,
  visibleBlocks,
} from './richdoc-projection.js';
import type { RichDocSnapshot } from './richdoc-projection.js';
import { dispatchRichDocCommand } from './richdoc-command-dispatch.js';
import type { RichDocCommandContext } from './richdoc-command-dispatch.js';
import { SIZES } from './RichDocMenus.js';
import { RichDocMenuPopup } from './RichDocMenuPopup.js';
import type { RichDocMenuActions } from './RichDocMenuPopup.js';
import { applyRichDocPageState, parseRichDocPageState } from './richdoc-page-state.js';
import type { RichDocPageState } from './richdoc-page-state.js';
import { captureRichDocSelection } from './richdoc-selection.js';
import type { RichDocCommandState as CmdState, WordSel } from './richdoc-selection.js';
import { esc, transformCase } from './richdoc-text-case.js';
import { buildHoverCardState, HOVER_CARD_CLOSE_DELAY_MS, HOVER_CARD_OPEN_DELAY_MS, wrapCursor } from './richdoc-hover-card.js';

export type { WordSel } from './richdoc-selection.js';

export type { DocFmt, DocTable } from './richdoc-editing.js';

export interface RichDocHandle {
  /** 全文纯文本(供 Agent 定位)。 */
  getText(): string;
  /** 带格式的文档上下文(逐段样式/字体/字号/对齐 + 样式系统摘要)——让 Agent 看得见排版细节。 */
  getContext(): string;
  /** 全文快照(逐段全文+样式,清样投影)——随请求上送 serve,供 read_blocks/find_text 等工具按需取,不进 prompt。 */
  getDocSnapshot(): RichDocSnapshot;
  /** 落一条 Agent 改动(文本改写 replacement / 格式 fmt / 删段 removeBlock / 图片 img / 结构化表格 table),按 editId 包裹,可还原。
   *  blockIdx=段号锚(0-based,与 getContext/getDocSnapshot 的"第N段"同序):quote 定位失败或空段落时的兜底通道。 */
  applyEdit(editId: string, quote: string, opts: RichDocEditOptions): boolean;
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
  /** 载入外部 HTML(真实 docx 导入):替换正文、清空修订/撤销状态并持久化。 */
  loadHTML(html: string): void;
}
/** props 全可选(避免 Record<string,never> 与 ref 冲突)。 */
export interface RichDocProps {
  className?: string;
  onSelection?: (s: WordSel | null) => void;
  onChangeHover?: (cid: string | null) => void; // 文档里悬停某改动 → 点亮 rail 对应条
  onChangeResolve?: (cid: string, verb: 'accept' | 'reject') => void; // 行内卡片 ✓/✕ → 走 rail 的接受/拒绝
}

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
  const undoMap = useRef<Map<string, RichDocUndoEntry>>(new Map());

  const [tab, setTab] = useState<number>(() => { const v = parseInt(localStorage.getItem(TAB_KEY) ?? '0', 10); return Number.isFinite(v) && v >= 0 && v < 6 ? v : 0; });
  const [pop, setPop] = useState<{ key: string; x: number; y: number } | null>(null);
  const [st, setSt] = useState<CmdState>({ bold: false, italic: false, underline: false, strike: false, ul: false, ol: false, align: 'left', font: '', size: 0 });
  const [page, setPage] = useState<RichDocPageState>(() => parseRichDocPageState(localStorage.getItem(PAGE_KEY)));
  const pageRef = useRef(page); pageRef.current = page; // imperative handle 里读取当前页面态(闭包安全)
  const [toast, setToast] = useState<string | null>(null);
  const [wc, setWc] = useState<RichDocWordCount | null>(null);
  const [nav, setNav] = useState<{ level: number; text: string; idx: number }[]>([]);
  const [diffView, setDiffView] = useState<RichDocDiffView>('mark'); // Agent 改动四态:原文/修订/清样/改后
  const [hasDiff, setHasDiff] = useState(false); // 文档里是否存在 Agent 改动(决定是否显示修订切换条)
  const [chgCount, setChgCount] = useState(0); // 改动条数(计数器)
  const [stepPos, setStepPos] = useState(0); // 步进导航当前位置(0 基)
  const [docChgs, setDocChgs] = useState<Array<{ cid: string; label: string }>>([]); // 全文/页面级改动(无行内锚点,切换条旁以 chip 呈现)
  const docChgsRef = useRef<Array<{ cid: string; label: string }>>([]); // imperative handle 闭包安全的镜像
  const setDocChanges = (list: Array<{ cid: string; label: string }>): void => { docChgsRef.current = list; setDocChgs(list); };
  const [linkedCid, setLinkedCid] = useState<string | null>(null); // rail 悬停联动(chip 用状态点亮,行内标记走类)
  const [hoverCard, setHoverCard] = useState<RichDocHoverCardState | null>(null); // 逐条改动悬浮卡
  const cardTimer = useRef<number | null>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null); // Office 式即时悬浮提示
  const tipTimer = useRef<number | null>(null);
  const lastFore = useRef('#c00000');
  const lastHi = useRef('#ffe600');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (edRef.current) edRef.current.innerHTML = sanitizeHtml(saved && saved.trim() ? saved : DEMO_HTML);
    { const nx = edRef.current?.querySelectorAll('[data-cid]').length ?? 0; setChgCount(nx); setHasDiff(nx > 0); }
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* 老浏览器忽略 */ }
    const onSel = (): void => {
      const root = edRef.current;
      if (!root) return;
      const capture = captureRichDocSelection(root, window.getSelection());
      if (!capture) return;
      savedRange.current = capture.range;
      if (capture.hasText) root.querySelectorAll('.rd-img-sel').forEach((element) => element.classList.remove('rd-img-sel'));
      selCb.current?.(capture.wordSelection);
      if (capture.commandState) setSt(capture.commandState);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  // 页面级样式(纸张/边距/分栏/缩放/网格/视图…)不进正文 innerHTML,单独持久化并在 [page] 变化时套用
  useEffect(() => {
    const el = edRef.current;
    if (!el) return;
    try { localStorage.setItem(PAGE_KEY, JSON.stringify(page)); } catch { /* 配额忽略 */ }
    applyRichDocPageState(el, page);
  }, [page]);

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 1800); return () => clearTimeout(id); }, [toast]);
  // Agent 改动的三态切换:给 .rd-page 加类,CSS 决定 del/ins 的显隐(原文=只旧、修订=红删绿增、改后=只新)
  useEffect(() => {
    const el = edRef.current; if (!el) return;
    el.classList.toggle('rd-diff-final', diffView === 'final');
    el.classList.toggle('rd-diff-clean', diffView === 'clean');
    el.classList.toggle('rd-diff-orig', diffView === 'orig');
    // 全文/页面级改动的真前后对比:原文=回改前(根样式+页面设置),其余视图=改后
    const toOrig = diffView === 'orig';
    for (const c of docChgsRef.current) {
      const info = undoMap.current.get(c.cid);
      if (!info || info.mode !== 'root') continue;
      const props = toOrig ? info.priorProps : (info.nextProps ?? info.priorProps);
      const s = el.style;
      s.fontWeight = props.fontWeight ?? ''; s.fontStyle = props.fontStyle ?? ''; s.textDecoration = props.textDecoration ?? '';
      s.fontFamily = props.fontFamily ?? ''; s.fontSize = props.fontSize ?? ''; s.color = props.color ?? '';
      s.textAlign = props.textAlign ?? ''; s.lineHeight = props.lineHeight ?? ''; s.backgroundColor = props.backgroundColor ?? '';
      const pg = toOrig ? info.priorPage : info.nextPage;
      if (pg) setPage((p) => ({ ...p, ...pg }));
    }
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
      localStorage.setItem(STORAGE_KEY, sanitizeHtml(c.innerHTML));
    } catch { /* 配额满忽略 */ }
  };
  const notify = (m: string): void => setToast(m);
  const refreshHasDiff = (): void => {
    const marks = edRef.current?.querySelectorAll('[data-cid]').length ?? 0;
    const n = marks + docChgsRef.current.length; // 行内标记 + 全文/页面级 chip 都算改动
    setChgCount(n); setHasDiff(n > 0);
    setStepPos((p) => (marks === 0 ? 0 : Math.min(p, marks - 1))); // 步进只在行内标记间走,钳制游标
  };
  /** 尊重系统"减少动态效果":滚动定位退化为瞬时。 */
  const smoothBehavior = (): ScrollBehavior => (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  // 逐条改动的悬浮卡(复用 .rd-tip 心智):悬停一处改动 → 卡片显示 类型·旧→新·✓/✕
  const openCardFor = (g: HTMLElement): void => {
    if (!g.isConnected) return; // 120ms 延迟里改动可能已被还原,别在脱离节点上开卡(rect 会落到左上角)
    const state = buildHoverCardState(g, { insertText: () => cleanBlockText(g) });
    if (!state) return;
    setHoverCard(state);
    hoverCb.current?.(state.cid);
  };
  const onDocOver = (e: React.MouseEvent): void => {
    const g = (e.target as HTMLElement).closest?.('.rd-chg, [data-edit-block]') as HTMLElement | null; // 块级改动同样有卡片
    if (!g) return;
    if (cardTimer.current) window.clearTimeout(cardTimer.current);
    cardTimer.current = window.setTimeout(() => openCardFor(g), HOVER_CARD_OPEN_DELAY_MS);
  };
  const onEdKey = (e: React.KeyboardEvent): void => { // 键盘可达:Tab 到改动壳(contenteditable=false 可聚焦)后 Enter/空格开卡
    const g = (e.target as HTMLElement).closest?.('.rd-chg, [data-edit-block]') as HTMLElement | null;
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCardFor(g); }
  };
  const onDocOut = (e: React.MouseEvent): void => {
    const from = (e.target as HTMLElement).closest?.('.rd-chg, [data-edit-block]');
    const to = e.relatedTarget as Node | null;
    if (from && to && from.contains(to)) return;
    if (to instanceof HTMLElement && to.closest?.('.rd-cardwrap')) return; // 移到卡片上,别关
    if (cardTimer.current) window.clearTimeout(cardTimer.current);
    cardTimer.current = window.setTimeout(() => { setHoverCard(null); hoverCb.current?.(null); }, HOVER_CARD_CLOSE_DELAY_MS);
  };
  const keepCard = (): void => { if (cardTimer.current) window.clearTimeout(cardTimer.current); };
  const closeCard = (): void => { if (cardTimer.current) window.clearTimeout(cardTimer.current); setHoverCard(null); hoverCb.current?.(null); };
  // 步进导航:上一处/下一处改动,定位并激活
  const step = (dir: number): void => {
    const root = edRef.current; if (!root) return;
    const list = Array.from(root.querySelectorAll('[data-cid]')) as HTMLElement[];
    if (!list.length) return;
    const next = wrapCursor(stepPos, dir, list.length);
    setStepPos(next);
    root.querySelectorAll('.is-active').forEach((e) => e.classList.remove('is-active'));
    const el = list[next]!;
    el.classList.add('is-active');
    el.scrollIntoView({ behavior: smoothBehavior(), block: 'center' });
    el.classList.add('rd-flash'); setTimeout(() => el.classList.remove('rd-flash'), 1200);
  };
  const revisionContextFor = (root: HTMLElement): RichDocRevisionContext => ({
    root,
    undoMap: undoMap.current,
    documentChanges: docChgsRef.current,
    setPage: (patch) => setPage((current) => ({ ...current, ...patch })),
    setDocumentChanges: setDocChanges,
    onMutation: () => { refreshHasDiff(); persist(); },
  });

  useImperativeHandle(ref, (): RichDocHandle => ({
    getText: () => { // 清样投影:喂给 Agent 的永远是"改后本体",del 里的旧文不进上下文
      const root = edRef.current;
      return root ? getRichDocText(root) : '';
    },
    getContext: () => {
      const root = edRef.current;
      return root ? getRichDocContext(root) : '(空文档)';
    },
    getDocSnapshot: () => {
      const root = edRef.current;
      return root ? getRichDocSnapshot(root) : { blocks: [] };
    },
    applyEdit: (editId, quote, opts) => {
      const root = edRef.current;
      if (!root) return false;
      return applyRichDocEdit({
        ...revisionContextFor(root),
        page: pageRef.current,
      }, editId, quote, opts);
    },
    revert: (editId) => {
      const root = edRef.current;
      if (!root) return false;
      return revertRichDocRevision(revisionContextFor(root), editId);
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
      setLinkedCid(cid); // 全文级 chip 的联动点亮
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
      resolveRichDocRevision(revisionContextFor(root), cid, state);
    },
    closeUndoWindow: () => {
      const root = edRef.current; if (!root) return;
      closeRichDocUndoWindow(revisionContextFor(root));
    },
    loadHTML: (html) => { // 真实 docx 导入:整篇替换,修订/撤销状态清零
      const root = edRef.current; if (!root) return;
      root.innerHTML = sanitizeHtml(html);
      undoMap.current.clear();
      setDocChanges([]);
      refreshHasDiff();
      refreshNav();
      persist();
    },
  }), []);

  // ── 基础命令(execCommand + CSS;先恢复选区) ──
  const exec = (cmd: string, val?: string): void => { restoreSel(); document.execCommand(cmd, false, val); persist(); };
  const withSel = (fn: () => void): void => { restoreSel(); fn(); persist(); };
  const insertHTML = (html: string): void => { restoreSel(); document.execCommand('insertHTML', false, sanitizeHtml(html)); persist(); };
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
      else insertHTML(`<a class="rd-object" href="${String(reader.result)}" download="${esc(f.name)}">${esc(f.name)}</a>`);
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
  // 点选图片/对象时记住它,作为「排列」命令的目标;图片同时作为圈选目标上抛(此前图片点了没反应、选不到)
  const onEdClick = (e: React.MouseEvent): void => {
    const root = edRef.current;
    const hit = (e.target as HTMLElement | null)?.closest?.('img,svg,.rd-textbox');
    if (!hit || !root?.contains(hit)) return;
    lastImg.current = hit as HTMLElement;
    if (hit instanceof HTMLImageElement) {
      root.querySelectorAll('.rd-img-sel').forEach((el) => el.classList.remove('rd-img-sel'));
      hit.classList.add('rd-img-sel');
      const bi = visibleBlocks(root).findIndex((b) => b.contains(hit)); // 与 Agent 上下文同一"第N段"序
      selCb.current?.({ text: `[图片${hit.alt ? ' ' + hit.alt : ''}${hit.width ? ' ' + hit.width + '×' + hit.height : ''}]`, block: '图片', chars: 0, ...(bi >= 0 ? { para: bi + 1 } : {}) });
    }
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
          document.execCommand('insertHTML', false, sanitizeHtml(html));
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
    cmtCursor.current = wrapCursor(cmtCursor.current, dir, list.length);
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
  const setView = (v: RichDocPageState['view'] | undefined): void => setPage((p) => ({ ...p, view: v }));
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

  const commandContext: RichDocCommandContext = {
    exec,
    clearFormat: () => { exec('removeFormat'); document.execCommand('formatBlock', false, 'p'); persist(); },
    capturePaint,
    stepFont,
    ruby,
    insertEnclosed,
    styleBlocks,
    insertHTML,
    openImagePicker: () => fileRef.current?.click(),
    takeScreenshot: () => takeScreenshot(),
    insertLink,
    insertBookmark,
    insertCrossReference: insertXref,
    toggleHeaderFooter,
    insertTextbox,
    insertSign,
    openObjectPicker: () => objRef.current?.click(),
    changeImageLayer: zStep,
    notify,
    translate: t,
    updateToc,
    insertNote,
    nextNote,
    showNotes,
    insertBiblio,
    insertCaption,
    insertTableOfFigures: insertTof,
    markIndex,
    buildIndex,
    toggleSpell: () => setPage((p) => ({ ...p, spell: !p.spell })),
    openWordCount,
    translateSelection: () => notify(t('可把选中文字交给右侧 Agent 翻译')),
    addComment,
    deleteComment: delComment,
    navigateComment: navComment,
    toggleComments: () => setPage((p) => ({ ...p, hideComments: !p.hideComments })),
    toggleTrackChanges: () => { setPage((p) => ({ ...p, track: !p.track })); notify(t('修订标记视图') + ' · ' + (page.track ? t('关') : t('开'))); },
    toggleDiffView: () => setDiffView((v) => (v === 'final' ? 'mark' : 'final')),
    acceptChange: resolveChange,
    setView,
    toggleRuler: () => setPage((p) => ({ ...p, ruler: !p.ruler })),
    toggleGrid: () => setPage((p) => ({ ...p, grid: !p.grid })),
    toggleNavigation: toggleNav,
    setZoom: (zoom) => setPage((p) => ({ ...p, zoom })),
    fitZoom,
    openWikipedia: () => { const q = savedRange.current?.toString() ?? ''; window.open('https://zh.wikipedia.org/wiki/Special:Search?search=' + encodeURIComponent(q), '_blank'); },
  };
  const run = (label: string): void => dispatchRichDocCommand(label, commandContext);

  const menuActions: RichDocMenuActions = {
    paste: doPaste,
    setFont,
    setSize,
    changeCase: (mode) => {
      restoreSel();
      const text = window.getSelection()?.toString() ?? '';
      if (text) insertText(transformCase(text, mode));
    },
    exec,
    wrapSelection: wrapSel,
    applyColor: (kind, color) => {
      if (kind === 'foreground') { lastFore.current = color; exec('foreColor', color); }
      else if (kind === 'shade') styleBlocks((element) => { element.style.backgroundColor = color === 'transparent' ? '' : color; });
      else { lastHi.current = color; exec('hiliteColor', color); }
    },
    insertEnclosed,
    sortBlocks: (direction) => {
      restoreSel();
      const blocks = blocksInSel();
      if (blocks.length < 2) { notify(t('请选择多个段落再排序')); return; }
      const parent = blocks[0]!.parentNode;
      [...blocks]
        .sort((a, b) => (a.textContent ?? '').localeCompare(b.textContent ?? '', 'zh-Hans-CN') * direction)
        .forEach((element) => parent?.appendChild(element));
      persist();
    },
    setLineSpacing,
    styleBlocks,
    findNext,
    findReplace,
    clearSelection: () => window.getSelection()?.removeAllRanges(),
    insertCover,
    insertTable,
    insertTablePrompt,
    insertShape,
    insertText,
    insertHTML,
    insertPageNumber: (position) => {
      const header = position === 'header-right';
      toggleHeaderFooter(header ? 'header' : 'footer');
      const box = edRef.current?.querySelector(header ? '.rd-header' : '.rd-footer');
      if (!box) return;
      box.insertAdjacentHTML('beforeend', ' <span class="rd-pagenum">1</span>');
      (box as HTMLElement).style.textAlign = position === 'footer-center' ? 'center' : 'right';
      persist();
    },
    insertWordArt,
    dropCap,
    updatePage: (patch) => setPage((current) => ({ ...current, ...patch })),
    setGridPaper: (mode) => {
      const root = edRef.current;
      if (!root) return;
      if (mode === 'squares') {
        root.style.backgroundImage = 'linear-gradient(#e3e4e7 1px,transparent 1px),linear-gradient(90deg,#e3e4e7 1px,transparent 1px)';
        root.style.backgroundSize = '24px 24px';
      } else if (mode === 'lines') {
        root.style.backgroundImage = 'linear-gradient(#e3e4e7 1px,transparent 1px)';
        root.style.backgroundSize = '100% 30px';
      } else root.style.backgroundImage = '';
    },
    arrangeImage: arrangeImg,
    ungroupSelection: () => {
      restoreSel();
      let element: Node | null = window.getSelection()?.anchorNode ?? null;
      while (element && element !== edRef.current) {
        if (element instanceof HTMLElement && element.classList.contains('rd-group')) {
          const parent = element.parentNode;
          if (parent) { while (element.firstChild) parent.insertBefore(element.firstChild, element); parent.removeChild(element); }
          break;
        }
        element = element.parentNode;
      }
      persist();
    },
    rotateImage: rotateImg,
    buildToc,
    updateToc,
    notify,
    fitZoom,
    run,
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
  const spinRibbonValue = (label: string, direction: number): void => {
    if (label === '左缩进') styleBlocks((el) => { el.style.marginLeft = Math.max(0, parseFloat(el.style.marginLeft || '0') + direction * 2) + 'em'; });
    else if (label === '右缩进') styleBlocks((el) => { el.style.marginRight = Math.max(0, parseFloat(el.style.marginRight || '0') + direction * 2) + 'em'; });
    else if (label === '段前间距') styleBlocks((el) => { el.style.marginTop = Math.max(0, parseFloat(el.style.marginTop || '0') + direction * 6) + 'pt'; });
    else styleBlocks((el) => { el.style.marginBottom = Math.max(0, parseFloat(el.style.marginBottom || '0') + direction * 6) + 'pt'; });
  };

  const wrapCls = 'rd-wrap' + (page.view === 'read' ? ' rd-view-read' : page.view === 'web' ? ' rd-view-web' : page.view === 'outline' ? ' rd-view-outline' : '');
  const zoomPct = Math.round((page.zoom ?? 1) * 100);

  return (
    <div className={wrapCls}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImg} />
      <input ref={objRef} type="file" hidden onChange={onPickObj} />
      <RichDocRibbon
        tab={tab}
        font={st.font}
        fontSize={st.size}
        openMenuKey={pop?.key ?? null}
        foregroundColor={lastFore.current}
        highlightColor={lastHi.current}
        wordCount={edRef.current ? (cleanClone(edRef.current).textContent ?? '').replace(/\s/g, '').length : 0}
        zoomPercent={zoomPct}
        isActive={isActive}
        onTabChange={(index) => { setTab(index); localStorage.setItem(TAB_KEY, String(index)); }}
        onCommand={run}
        onOpenMenu={openPop}
        onApplyStyle={applyStyle}
        onApplyColor={(color, value) => color === 'fore' ? exec('foreColor', value) : exec('hiliteColor', value)}
        onSpin={spinRibbonValue}
        onMouseOver={onRibbonOver}
        onMouseOut={onRibbonOut}
        onMouseDownCapture={() => { if (tipTimer.current) window.clearTimeout(tipTimer.current); setTip(null); }}
      />

      {page.ruler ? <div className="rd-ruler" /> : null}
      <div className="rd-stage">
        <RichDocRevisionBar
          visible={hasDiff}
          active={diffView}
          changeCount={chgCount}
          stepPosition={stepPos}
          documentChanges={docChgs}
          linkedChangeId={linkedCid}
          onPick={setDiffView}
          onStep={step}
          onResolve={(changeId, verb) => resolveCb.current?.(changeId, verb)}
        />
        {page.nav ? <RichDocNavigationPane items={nav} onNavigate={navTo} /> : null}
        <div className="rd-scroll" onScroll={() => { setTip(null); if (cardTimer.current) window.clearTimeout(cardTimer.current); setHoverCard(null); }}>
          <div className="rd-page" ref={edRef} contentEditable suppressContentEditableWarning onInput={() => { persist(); refreshHasDiff(); if (page.nav) refreshNav(); }} onMouseUp={onEdMouseUp} onClick={onEdClick} onMouseOver={onDocOver} onMouseOut={onDocOut} onKeyDown={onEdKey} />
        </div>
      </div>

      {pop ? (
        <>
          <div className="drop-backdrop" onMouseDown={() => setPop(null)} />
          <div className="dropdown rd-pop" style={{ left: pop.x, top: pop.y }}><RichDocMenuPopup menuKey={pop.key} page={page} actions={menuActions} onClose={() => setPop(null)} /></div>
        </>
      ) : null}

      <RichDocWordCountDialog count={wc} onClose={() => setWc(null)} />
      <RichDocChangeCard
        card={hoverCard}
        onKeep={keepCard}
        onClose={closeCard}
        onResolve={(changeId, verb) => { resolveCb.current?.(changeId, verb); closeCard(); }}
      />
      {tip ? <div className="rd-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div> : null}
      {toast ? <div className="rd-toast">{toast}</div> : null}
    </div>
  );
});

export default RichDoc;
