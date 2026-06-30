/**
 * 真实 Univer Docs 文档实例 —— 取代此前 Word 的占位/假功能区。
 * 给到的是带【可用工具栏(字体/字号/加粗/样式…)】的真编辑器,用户能手动排版;
 * Agent 则通过 Univer Facade 驱动:文本改写(setSelection + insertText 替换区间)、
 * 格式(executeCommand 的 doc.command.set-inline-format-* 系列)—— 即"结构化的 OOXML 编辑",
 * 可审阅、可落盘,而非执行原始代码。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createUniver, defaultTheme, LocaleType, merge } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import docsZhCN from '@univerjs/preset-docs-core/locales/zh-CN';
import '@univerjs/preset-docs-core/lib/index.css';

const BRAND_PRIMARY = '#2563eb';

export interface DocFmt { bold?: boolean; italic?: boolean; underline?: boolean; font?: string; size?: number; color?: string; align?: 'left' | 'center' | 'right' }

export interface DocHandle {
  /** 全文纯文本(段落以换行分隔),供 Agent 上下文/定位。 */
  getText(): string;
  /** 文本改写:把首个命中的 quote 替换为 replacement(setSelection + 区间 insertText)。 */
  applyReplace(quote: string, replacement: string): boolean;
  /** 撤销文本改写:replacement → quote。 */
  revertReplace(quote: string, replacement: string): boolean;
  /** 套用格式:quote 为空=全文,否则作用于命中片段(走 doc.command.set-inline-format-*)。
   *  返回作用区间的【改前样式】,供"拒绝"时原样还原(再调一次 applyFormat 传回它即可)。 */
  applyFormat(quote: string | null, fmt: DocFmt): DocFmt | null;
  /** 审阅定位:把命中片段选中(滚动到视图)。 */
  highlight(text: string): void;
}

/** 段落数组 → 合法的 Univer 文档数据(dataStream 以 \r 分段、\n 收尾;paragraphs 记每个 \r 位置)。 */
function buildDocData(paras: string[]): Record<string, unknown> {
  let ds = '';
  const paragraphs: Array<{ startIndex: number }> = [];
  for (const p of paras) {
    ds += p;
    paragraphs.push({ startIndex: ds.length });
    ds += '\r';
  }
  ds += '\n';
  return {
    id: 'otterpatch-doc',
    body: { dataStream: ds, paragraphs, sectionBreaks: [{ startIndex: ds.length - 1 }] },
    documentStyle: { pageSize: { width: 595, height: 842 }, marginTop: 60, marginBottom: 60, marginLeft: 64, marginRight: 64 },
  };
}

const DEMO_PARAS = [
  '项目周报 · 2026 年第 26 周',
  '本周核心进展:OtterPatch 完成了 Excel 透视图的内联渲染,并新增了"需求模糊时主动澄清"的能力,Agent 在意图不清时会先给用户一张引导选择表。整体进度符合预期。',
  '风险与问题:大模型在超长输出时偶发截断,目前已通过分批与容错解析缓解;Word 工作区已换成真正的 Univer 文档编辑器,工具栏与字体/字号/样式均可用。',
  '下周计划:一、让 Agent 既能改写文字、也能改字体字号等格式;二、补齐行为回归测试;三、用真实模型校准澄清的边界。',
  '备注:本文档为演示数据,你可以圈选任意段落,用顶部工具栏手动排版,或让右侧 Agent 帮你改写、润色、统一字体字号。',
];

interface TextRun { st: number; ed: number; ts?: { ff?: string; fs?: number; bl?: number; it?: number; ul?: { s?: number }; cl?: { rgb?: string } } }
interface DocApi {
  getActiveDocument?: () => {
    getSnapshot?: () => { body?: { dataStream?: string; textRuns?: TextRun[] } };
    setSelection?: (s: number, e: number) => void;
    insertText?: (t: string, o?: { startOffset?: number; endOffset?: number }) => Promise<boolean>;
    insertParagraph?: (t?: string) => Promise<boolean>;
  } | null;
  executeCommand?: (id: string, params?: unknown) => Promise<boolean>;
}

/** 读取某偏移处的字符样式(从 snapshot.body.textRuns)→ DocFmt,作为"改前样式"。 */
function styleAt(textRuns: TextRun[] | undefined, offset: number): DocFmt {
  const run = (textRuns ?? []).find((r) => r.st <= offset && offset < r.ed) ?? (textRuns ?? []).find((r) => r.ed === offset);
  const ts = run?.ts ?? {};
  return { bold: ts.bl === 1, italic: ts.it === 1, underline: ts.ul?.s === 1, font: ts.ff, size: ts.fs, color: ts.cl?.rgb };
}

const UniverDoc = forwardRef<DocHandle, { onReady?: () => void }>(function UniverDoc({ onReady }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<DocApi | null>(null);

  const docText = (): string => {
    const ds = apiRef.current?.getActiveDocument?.()?.getSnapshot?.()?.body?.dataStream ?? '';
    return ds.replace(/\r/g, '\n').replace(/\n+$/g, '');
  };
  const rangeOf = (quote: string): { ds: string; i: number } | null => {
    const ds = apiRef.current?.getActiveDocument?.()?.getSnapshot?.()?.body?.dataStream ?? '';
    const i = quote ? ds.indexOf(quote) : -1;
    return { ds, i };
  };

  useImperativeHandle(
    ref,
    (): DocHandle => {
      const handle: DocHandle = {
      getText: docText,
      applyReplace: (quote, replacement) => {
        const doc = apiRef.current?.getActiveDocument?.();
        const r = rangeOf(quote);
        if (!doc || !r || r.i < 0) return false;
        doc.setSelection?.(r.i, r.i + quote.length);
        void doc.insertText?.(replacement, { startOffset: r.i, endOffset: r.i + quote.length });
        return true;
      },
      revertReplace: (quote, replacement) => {
        const doc = apiRef.current?.getActiveDocument?.();
        const r = rangeOf(replacement);
        if (!doc || !r || r.i < 0) return false;
        doc.setSelection?.(r.i, r.i + replacement.length);
        void doc.insertText?.(quote, { startOffset: r.i, endOffset: r.i + replacement.length });
        return true;
      },
      applyFormat: (quote, fmt) => {
        const doc = apiRef.current?.getActiveDocument?.();
        const api = apiRef.current;
        if (!doc || !api?.executeCommand) return null;
        const snap = doc.getSnapshot?.();
        const ds = snap?.body?.dataStream ?? '';
        let start = 0;
        let end = Math.max(0, ds.length - 1); // 全文(不含尾部 \n)
        if (quote) { const i = ds.indexOf(quote); if (i < 0) return null; start = i; end = i + quote.length; }
        const prior = styleAt(snap?.body?.textRuns, start); // 改前样式,供"拒绝"还原
        doc.setSelection?.(start, end);
        const cmd = (id: string, params?: unknown): void => { void api.executeCommand?.(id, params); };
        // 加粗/斜体/下划线是【切换】命令:仅当目标态与现态不同才触发,从而实现可靠的"设为 X"与还原
        if (fmt.bold !== undefined && !!fmt.bold !== !!prior.bold) cmd('doc.command.set-inline-format-bold');
        if (fmt.italic !== undefined && !!fmt.italic !== !!prior.italic) cmd('doc.command.set-inline-format-italic');
        if (fmt.underline !== undefined && !!fmt.underline !== !!prior.underline) cmd('doc.command.set-inline-format-underline');
        // 字体/字号/颜色是【赋值】命令:与现值不同才设
        if (fmt.font !== undefined && fmt.font !== prior.font) cmd('doc.command.set-inline-format-font-family', { value: fmt.font });
        if (fmt.size !== undefined && fmt.size !== prior.size) cmd('doc.command.set-inline-format-fontsize', { value: fmt.size });
        if (fmt.color !== undefined && fmt.color !== prior.color) cmd('doc.command.set-inline-format-text-color', { value: fmt.color });
        return prior;
      },
      highlight: (text) => {
        const doc = apiRef.current?.getActiveDocument?.();
        const r = rangeOf(text);
        if (doc && r && r.i >= 0) doc.setSelection?.(r.i, r.i + text.length);
      },
      };
      // e2e 探针:Univer 文本渲染在 canvas 上,Playwright 无法读 DOM,故暴露句柄供端到端断言。
      if (typeof window !== 'undefined') (window as unknown as { __otterDoc?: DocHandle }).__otterDoc = handle;
      return handle;
    },
    [],
  );

  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    let univerInst: { dispose?: () => void } | null = null;
    try {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: merge({}, docsZhCN) },
        theme: { ...defaultTheme, primary: BRAND_PRIMARY },
        presets: [UniverDocsCorePreset({ container: hostRef.current })],
      });
      univerInst = univer as unknown as { dispose?: () => void };
      const api = univerAPI as unknown as DocApi & { createUniverDoc?: (d: unknown) => unknown };
      apiRef.current = api;
      api.createUniverDoc?.(buildDocData(DEMO_PARAS));
      onReady?.();
    } catch (err) {
      console.error('UniverDoc init failed', err);
    }
    return () => {
      if (!disposed) { disposed = true; try { univerInst?.dispose?.(); } catch { /* ignore */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="univer-doc-host" ref={hostRef} />;
});

export default UniverDoc;
