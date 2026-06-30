/**
 * 自控富文本「Word」编辑器 —— 取代 Univer Docs(其行内格式命令在嵌入态不生效)。
 * 基于 contentEditable + Selection/Range:工具栏(加粗/字体/字号/颜色/对齐/列表/标题…)真生效;
 * Agent 改动也由本组件【完全掌控】地落到文档:按 editId 包裹一个 <span data-edit>,可逐条精确还原。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { useT } from './i18n.js';
import { IconUndo, IconStrike, IconAlignLeft, IconAlignCenter, IconAlignRight, IconClearFormat } from './icons.js';

export interface DocFmt { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; font?: string; size?: number; color?: string; align?: 'left' | 'center' | 'right' }

export interface RichDocHandle {
  /** 全文纯文本(供 Agent 上下文/定位)。 */
  getText(): string;
  /** 落一条 Agent 改动(文本改写 replacement 或格式 fmt),按 editId 包裹,可还原。 */
  applyEdit(editId: string, quote: string, opts: { replacement?: string; fmt?: DocFmt }): boolean;
  /** 按 editId 精确还原该条改动。 */
  revert(editId: string): void;
  /** 选中/滚动到某条改动。 */
  highlight(editId: string): void;
}

const FONTS = ['宋体', '黑体', '微软雅黑', '楷体', '仿宋', 'Arial', 'Times New Roman'];
const SIZES = [9, 10, 10.5, 12, 14, 16, 18, 22, 26, 36];

const DEMO_HTML = `
<h1>项目周报 · 2026 年第 26 周</h1>
<p>本周核心进展:OtterPatch 完成了 Excel 透视图的内联渲染,并新增了"需求模糊时主动澄清"的能力,Agent 在意图不清时会先给用户一张引导选择表。整体进度符合预期。</p>
<p>风险与问题:大模型在超长输出时偶发截断,目前已通过分批与容错解析缓解;Word 工作区已换成自控富文本编辑器,工具栏的字体/字号/加粗/对齐/列表都真生效。</p>
<h2>下周计划</h2>
<p>一、让 Agent 既能改写文字、也能改字体字号等格式;二、补齐行为回归测试;三、用真实模型校准澄清的边界。</p>
<p>备注:本文档为演示数据,你可以圈选任意文字,用顶部工具栏手动排版,或让右侧 Agent 帮你改写、润色、统一字体字号。</p>`;

const STORAGE_KEY = 'oa.richdoc';

/** 在 root 的文本里找到 quote 的 Range(跨文本节点)。 */
function findRange(root: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let acc = '';
  let n: Node | null;
  while ((n = walker.nextNode())) { nodes.push({ node: n as Text, start: acc.length }); acc += (n as Text).data; }
  const idx = acc.indexOf(quote);
  if (idx < 0) return null;
  const end = idx + quote.length;
  let sNode: Text | undefined, sOff = 0, eNode: Text | undefined, eOff = 0;
  for (const { node, start } of nodes) {
    const len = node.data.length;
    if (sNode === undefined && idx >= start && idx < start + len) { sNode = node; sOff = idx - start; }
    if (end > start && end <= start + len) { eNode = node; eOff = end - start; }
  }
  if (!sNode || !eNode) return null;
  const r = document.createRange();
  r.setStart(sNode, sOff);
  r.setEnd(eNode, eOff);
  return r;
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

const RichDoc = forwardRef<RichDocHandle, Record<string, never>>(function RichDoc(_props, ref) {
  const t = useT();
  const edRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null); // 工具栏控件(下拉/取色器)会夺走焦点丢选区,故随时记下编辑器内的选区以便恢复
  // editId → 还原信息:替换的 DOM 片段(改前内容)或全文样式
  const undoMap = useRef<Map<string, { mode: 'span'; prior: DocumentFragment } | { mode: 'root'; priorStyle: string }>>(new Map());

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (edRef.current) edRef.current.innerHTML = saved && saved.trim() ? saved : DEMO_HTML;
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* 老浏览器忽略 */ }
    const onSel = (): void => {
      const s = window.getSelection();
      if (s && s.rangeCount && edRef.current && s.anchorNode && edRef.current.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  /** 恢复最近一次编辑器内选区(点工具栏控件后用)。 */
  const restoreSel = (): void => {
    edRef.current?.focus();
    const r = savedRange.current;
    if (!r) return;
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  };

  const persist = (): void => { try { if (edRef.current) localStorage.setItem(STORAGE_KEY, edRef.current.innerHTML); } catch { /* 配额满忽略 */ } };

  useImperativeHandle(ref, (): RichDocHandle => ({
    getText: () => edRef.current?.innerText ?? '',
    applyEdit: (editId, quote, opts) => {
      const root = edRef.current;
      if (!root) return false;
      // 全文格式:直接改根容器样式,记录改前内联样式以还原
      if (!quote && opts.fmt) {
        undoMap.current.set(editId, { mode: 'root', priorStyle: root.getAttribute('style') ?? '' });
        styleSpan(root, opts.fmt);
        persist();
        return true;
      }
      const range = findRange(root, quote);
      if (!range) return false;
      const span = document.createElement('span');
      span.setAttribute('data-edit', editId);
      if (opts.fmt) styleSpan(span, opts.fmt);
      span.textContent = opts.replacement ?? quote; // 文本改写=新文字;格式=原文(只加样式)
      const prior = range.cloneContents(); // 改前内容,供还原
      range.deleteContents();
      range.insertNode(span);
      undoMap.current.set(editId, { mode: 'span', prior });
      persist();
      return true;
    },
    revert: (editId) => {
      const root = edRef.current;
      const info = undoMap.current.get(editId);
      if (!root || !info) return;
      if (info.mode === 'root') { if (info.priorStyle) root.setAttribute('style', info.priorStyle); else root.removeAttribute('style'); }
      else {
        const span = root.querySelector(`[data-edit="${editId}"]`);
        if (span && span.parentNode) span.parentNode.replaceChild(info.prior.cloneNode(true), span);
      }
      undoMap.current.delete(editId);
      persist();
    },
    highlight: (editId) => {
      const span = edRef.current?.querySelector(`[data-edit="${editId}"]`) as HTMLElement | null;
      if (!span) return;
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      span.classList.add('rd-flash');
      setTimeout(() => span.classList.remove('rd-flash'), 1200);
    },
  }), []);

  // ── 工具栏:对当前选区真实生效(execCommand + CSS;先恢复选区) ──
  const exec = (cmd: string, val?: string): void => { restoreSel(); document.execCommand(cmd, false, val); persist(); };
  const setFont = (f: string): void => { if (f) exec('fontName', f); };
  /** 字号(pt):execCommand fontSize 只支持 1-7,故临时关 styleWithCSS 让其产出 <font size=7>,再换成 CSS pt。 */
  const setSize = (pt: string): void => {
    if (!pt) return;
    const root = edRef.current; if (!root) return;
    restoreSel();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontSize', false, '7');
    document.execCommand('styleWithCSS', false, 'true');
    root.querySelectorAll('font[size="7"]').forEach((f) => {
      const s = document.createElement('span');
      s.style.fontSize = pt + 'pt';
      s.innerHTML = (f as HTMLElement).innerHTML;
      f.replaceWith(s);
    });
    persist();
  };
  const Btn = ({ cmd, val, title, children }: { cmd: string; val?: string; title: string; children: ReactNode }): ReactNode => (
    <button className="rd-btn" title={title} onMouseDown={(e) => { e.preventDefault(); exec(cmd, val); }}>{children}</button>
  );

  return (
    <div className="rd-wrap">
      <div className="rd-toolbar">
        <Btn cmd="undo" title={t('撤销')}><IconUndo size={15} /></Btn>
        <Btn cmd="redo" title={t('重做')}><span className="rd-gl flip">↶</span></Btn>
        <span className="rd-sep" />
        <Btn cmd="bold" title={t('加粗')}><b>B</b></Btn>
        <Btn cmd="italic" title={t('斜体')}><i>I</i></Btn>
        <Btn cmd="underline" title={t('下划线')}><u>U</u></Btn>
        <Btn cmd="strikeThrough" title={t('删除线')}><IconStrike size={15} /></Btn>
        <span className="rd-sep" />
        <select className="rd-sel" title={t('字体')} defaultValue="" onChange={(e) => { setFont(e.target.value); e.currentTarget.selectedIndex = 0; }}>
          <option value="">{t('字体')}</option>
          {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="rd-sel sm" title={t('字号')} defaultValue="" onChange={(e) => { setSize(e.target.value); e.currentTarget.selectedIndex = 0; }}>
          <option value="">{t('字号')}</option>
          {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="rd-sel" title={t('样式')} defaultValue="" onChange={(e) => { if (e.target.value) exec('formatBlock', e.target.value); e.currentTarget.selectedIndex = 0; }}>
          <option value="">{t('样式')}</option>
          <option value="p">{t('正文')}</option>
          <option value="h1">{t('标题1')}</option>
          <option value="h2">{t('标题2')}</option>
        </select>
        <label className="rd-color" title={t('字体颜色')}>A<input type="color" onChange={(e) => exec('foreColor', e.target.value)} /></label>
        <label className="rd-color hl" title={t('高亮')}>▌<input type="color" defaultValue="#ffe600" onChange={(e) => exec('hiliteColor', e.target.value)} /></label>
        <span className="rd-sep" />
        <Btn cmd="justifyLeft" title={t('左对齐')}><IconAlignLeft size={15} /></Btn>
        <Btn cmd="justifyCenter" title={t('居中')}><IconAlignCenter size={15} /></Btn>
        <Btn cmd="justifyRight" title={t('右对齐')}><IconAlignRight size={15} /></Btn>
        <Btn cmd="insertUnorderedList" title={t('项目符号')}><span className="rd-gl">•≡</span></Btn>
        <Btn cmd="insertOrderedList" title={t('编号')}><span className="rd-gl">1.≡</span></Btn>
        <span className="rd-sep" />
        <Btn cmd="removeFormat" title={t('清除格式')}><IconClearFormat size={15} /></Btn>
      </div>
      <div className="rd-scroll">
        <div className="rd-page" ref={edRef} contentEditable suppressContentEditableWarning onInput={persist} />
      </div>
    </div>
  );
});

export default RichDoc;
