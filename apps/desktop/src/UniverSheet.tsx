/**
 * 真实 Univer 电子表格实例(替换 Excel 渲染区的 mock 网格)。
 * 并把用户在表里框选的【区域 + 单元格值 + 格式(加粗/斜体/下划线/字号)】通过 onSelection 上抛给 App,
 * 让右侧 Agent 交互区感知选区,发送时把选区内容一并交给 Agent —— Agent 完全赋能 OtterPatch。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createUniver, defaultTheme, LocaleType, merge } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
// 常用数据功能(筛选/排序/条件格式/查找替换/数据验证)—— core preset 不含,在此补上,
// 让这些功能出现在 Univer 工具栏/菜单里供用户使用。
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter';
import filterZhCN from '@univerjs/preset-sheets-filter/locales/zh-CN';
import '@univerjs/preset-sheets-filter/lib/index.css';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import sortZhCN from '@univerjs/preset-sheets-sort/locales/zh-CN';
import '@univerjs/preset-sheets-sort/lib/index.css';
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import condFmtZhCN from '@univerjs/preset-sheets-conditional-formatting/locales/zh-CN';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace';
import findReplaceZhCN from '@univerjs/preset-sheets-find-replace/locales/zh-CN';
import '@univerjs/preset-sheets-find-replace/lib/index.css';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import dataValidationZhCN from '@univerjs/preset-sheets-data-validation/locales/zh-CN';
import '@univerjs/preset-sheets-data-validation/lib/index.css';

// App 通过这个句柄"边画边改"地驱动 Univer 网格(Agent 操作可视化)。
export interface SheetHandle {
  setCell(a1: string, value: unknown): void;
  setBackground(a1: string, color: string | null): void;
  setFontColor(a1: string, color: string): void;
  setBold(a1: string): void;
  setNumberFormat(a1: string, pattern: string): void;
  focus(a1: string): void;
  getValue(a1: string): unknown;
  /** 整张表的全局快照(概览 + 数据 + 焦点),与是否圈选无关。 */
  getSheet(): UniSel | null;
  // 结构性操作(Agent 赋能:插删行列 / 合并 / 冻结 / 清空)——驱动真实 Univer 网格
  insertRows(row: number, count: number): void;
  deleteRows(row: number, count: number): void;
  insertCols(col: number, count: number): void;
  deleteCols(col: number, count: number): void;
  mergeRange(a1: string): void;
  unmergeRange(a1: string): void;
  freeze(rows: number, cols: number): void;
  clearRange(a1: string): void;
}
interface FRangeOps {
  setValue(v: unknown): void;
  setBackground(c: string | null): void;
  setFontColor(c: string): void;
  setFontWeight(w: string): void;
  setNumberFormat(p: string): void;
  getValue(): unknown;
  merge(): void;
  breakApart(): void;
  clearContent(): void;
}
interface FSheetOps {
  getRange(a1: string): FRangeOps;
  setActiveRange(r: FRangeOps): void;
  insertRows(rowIndex: number, numRows?: number): void;
  deleteRows(rowPosition: number, howMany: number): void;
  insertColumns(columnIndex: number, numColumns?: number): void;
  deleteColumns(columnPosition: number, howMany: number): void;
  setFreeze(f: { startRow: number; startColumn: number; xSplit: number; ySplit: number }): void;
  cancelFreeze(): void;
}

export interface UniSel {
  a1: string;
  rows: number;
  cols: number;
  text: string; // 喂给模型 prompt 的全局概览 + 选区焦点(廉价)
  sheet?: { a1: string; values: unknown[][] }; // 整表全量(本地传给 serve,供 read_range/aggregate 按需取数)
}

const HEADERS = ['日期', '产品', '销量', '单价', '金额', '毛利率'];
const DATA: (string | number)[][] = [
  ['01-03', 'A型', 120, 38, '=C2*D2', '41%'],
  ['01-05', 'B型', 86, 52, '=C3*D3', '37%'],
  ['01-09', 'A型', 1500, 38, '=C4*D4', '41%'],
  ['01-12', 'C型', 64, 70, '=C5*D5', '28%'],
  ['01-15', 'B型', 92, 52, '=C6*D6', '37%'],
];

const colName = (n: number): string => {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};
function parseStart(a1: string): { c: number; r: number } {
  const first = a1.split(':')[0] ?? a1;
  const m = /([A-Za-z]+)([0-9]+)/.exec(first);
  if (!m) return { c: 0, r: 0 };
  let c = 0;
  for (const ch of m[1]!.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { c: c - 1, r: parseInt(m[2]!, 10) - 1 };
}

type CellStyle = { bold?: boolean; italic?: boolean; underline?: unknown; fontSize?: number } | null;
interface FRangeLike {
  getA1Notation(): string;
  getValues(): unknown[][];
  getCellStyles(): CellStyle[][];
}
interface FWorkbookLike {
  getActiveRange(): FRangeLike | null;
  onSelectionChange(cb: (s: unknown) => void): { dispose?: () => void };
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[,%¥$\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}
/** 一列(跳过表头)的类型与统计,作为"注意力概览"的一部分。 */
function colStat(colVals: unknown[]): string {
  const body = colVals.slice(1);
  const nonEmpty = body.filter((v) => v != null && v !== '');
  if (!nonEmpty.length) return '空列';
  const nums = nonEmpty.map(toNum).filter((n) => Number.isFinite(n));
  if (nums.length >= nonEmpty.length * 0.6) {
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
    return `数值·min ${min}·max ${max}·avg ${avg}`;
  }
  return `文本·${nonEmpty.length}项`;
}

// 全局上下文:整张表的廉价概览(列名+类型+统计 + 数据/采样)+ 当前选区焦点。
// 让 Agent 像人一样"先扫一眼全表",再聚焦选区,而不是盲人摸象。
function snap(wb: FWorkbookLike | null | undefined): UniSel | null {
  try {
    const range = wb?.getActiveRange() ?? null;
    // 整张表(used range)—— 与选区无关,始终构建,这样没圈选也能"看全局"
    const ws = (wb as unknown as { getActiveSheet?: () => { getDataRange?: () => { getA1Notation?: () => string; getValues?: () => unknown[][] } } | null } | null)?.getActiveSheet?.();
    const dr = ws?.getDataRange?.();
    const sheetA1 = dr?.getA1Notation?.();
    const sheetVals = dr?.getValues?.() as unknown[][] | undefined;
    if ((!sheetA1 || !sheetVals || !sheetVals.length) && !range) return null; // 空表且无选区
    const sA1 = sheetA1 ?? range!.getA1Notation();
    const sVals = sheetVals && sheetVals.length ? sheetVals : range!.getValues();
    const R = sVals.length;
    const C = sVals[0]?.length ?? 0;
    const sStart = parseStart(sA1);
    const sCols = Array.from({ length: C }, (_, i) => colName(sStart.c + i));
    const header = (sVals[0] ?? []).map((v) => (v == null ? '' : String(v)));
    const colLegend = sCols.map((L, i) => `${L}=${header[i] || '?'}(${colStat(sVals.map((row) => row[i]))})`).join(' | ');

    const rowLine = (ri: number): string =>
      `第${sStart.r + ri + 1}行: ` + (sVals[ri] ?? []).map((v, c) => `${sCols[c]}${sStart.r + ri + 1}=${v == null || v === '' ? '(空)' : String(v)}`).join('  ');
    let dataBlock: string;
    if (R <= 40) {
      dataBlock = sVals.map((_, r) => rowLine(r)).join('\n'); // 小表:全量
    } else {
      const head = [0, 1, 2, 3].filter((r) => r < R).map(rowLine);
      const tail = [R - 2, R - 1].filter((r) => r >= 4).map(rowLine);
      dataBlock = head.join('\n') + `\n…(中间省略 ${R - head.length - tail.length} 行,需要细节可调 read_range/aggregate 取)…\n` + tail.join('\n'); // 大表:采样
    }

    // 焦点选区(可选):没圈选就明确告诉 Agent 基于整张表
    let a1 = sA1;
    let rows = R;
    let cols = C;
    let focusText = '\n[未圈选具体区域]:用户没有圈选,请直接基于上面整张表理解与作答/操作。';
    if (range) {
      a1 = range.getA1Notation();
      const selVals = range.getValues();
      rows = selVals.length;
      cols = selVals[0]?.length ?? 0;
      const start = parseStart(a1);
      const notes: string[] = [];
      range.getCellStyles().forEach((row, r) =>
        row.forEach((st, c) => {
          if (!st) return;
          const fmt: string[] = [];
          if (st.bold) fmt.push('加粗');
          if (st.italic) fmt.push('斜体');
          if (st.fontSize) fmt.push(`${st.fontSize}px`);
          if (fmt.length) notes.push(`${colName(start.c + c)}${start.r + r + 1}=${fmt.join('/')}`);
        }),
      );
      focusText = `\n[当前选区·仅供参考] ${a1}(${rows} 行 × ${cols} 列):用户此刻选中了这块,它【可能】与本次意图相关,也可能只是随手点选(误框)。请以用户这句话的真实意图为准,自行判断是否真的要围绕选区操作;若指令明显针对整张表或别处,就别被这个选区带偏。你始终能看到整张表的全貌。` + (notes.length ? `\n选区已有格式: ${notes.join('; ')}` : '');
    }

    const text = `[整张表] 范围 ${sA1}(${R} 行 × ${C} 列)\n列概览: ${colLegend}\n数据(单元格=值):\n${dataBlock}${focusText}`;
    return { a1, rows, cols, text, sheet: { a1: sA1, values: sVals.slice(0, 3000) } };
  } catch {
    return null;
  }
}

// 品牌蓝色阶(Tailwind blue,600=#2563eb 正好=OtterPatch --accent),覆盖 Univer 默认靛蓝,
// 让激活 tab / 选区边框 / Sheet 标签 / 超链接全部落到品牌蓝,消除"同屏三种蓝"。
const BRAND_PRIMARY = {
  50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa',
  500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a',
};

const UniverSheet = forwardRef<SheetHandle, { onSelection?: (s: UniSel | null) => void }>(function UniverSheet({ onSelection }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<{ getActiveWorkbook?: () => { getActiveSheet?: () => FSheetOps } } | null>(null);
  const cb = useRef(onSelection);
  cb.current = onSelection;

  // 命令式句柄:App 用它驱动单元格(取值/写值/底色/字色/加粗/定位光标)
  useImperativeHandle(ref, () => {
    const sheet = (): FSheetOps | null => apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.() ?? null;
    const safe = (fn: () => void): void => {
      try {
        fn();
      } catch {
        /* 网格未就绪可忽略 */
      }
    };
    return {
      // 以 = 开头的字符串当公式写入(Univer 裸字符串会被存成文本,必须用 { f })
      setCell: (a1, v) =>
        safe(() => {
          const r = sheet()?.getRange(a1);
          if (typeof v === 'string' && v.trim().startsWith('=')) r?.setValue({ f: v.trim() });
          else r?.setValue(v);
        }),
      setBackground: (a1, c) => safe(() => sheet()?.getRange(a1).setBackground(c)),
      setFontColor: (a1, c) => safe(() => sheet()?.getRange(a1).setFontColor(c)),
      setBold: (a1) => safe(() => sheet()?.getRange(a1).setFontWeight('bold')),
      setNumberFormat: (a1, p) => safe(() => sheet()?.getRange(a1).setNumberFormat(p)),
      focus: (a1) => safe(() => { const s = sheet(); if (s) s.setActiveRange(s.getRange(a1)); }),
      getValue: (a1) => { let v: unknown; safe(() => { v = sheet()?.getRange(a1).getValue(); }); return v; },
      insertRows: (row, count) => safe(() => sheet()?.insertRows(row, count)),
      deleteRows: (row, count) => safe(() => sheet()?.deleteRows(row, count)),
      insertCols: (col, count) => safe(() => sheet()?.insertColumns(col, count)),
      deleteCols: (col, count) => safe(() => sheet()?.deleteColumns(col, count)),
      mergeRange: (a1) => safe(() => sheet()?.getRange(a1).merge()),
      unmergeRange: (a1) => safe(() => sheet()?.getRange(a1).breakApart()),
      freeze: (rows, cols) => safe(() => { const s = sheet(); if (!s) return; if (rows > 0 || cols > 0) s.setFreeze({ startRow: rows, startColumn: cols, xSplit: cols, ySplit: rows }); else s.cancelFreeze(); }),
      clearRange: (a1) => safe(() => sheet()?.getRange(a1).clearContent()),
      getSheet: () => { try { return snap(apiRef.current?.getActiveWorkbook?.() as unknown as FWorkbookLike | null); } catch { return null; } },
    };
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: { [LocaleType.ZH_CN]: merge({}, sheetsZhCN, filterZhCN, sortZhCN, condFmtZhCN, findReplaceZhCN, dataValidationZhCN) },
      theme: { ...defaultTheme, primary: BRAND_PRIMARY },
      // classic 带页签的功能区:常用功能(筛选/排序/条件格式/数据验证/冻结等)在 数据/开始/视图 页签里可发现
      presets: [
        UniverSheetsCorePreset({ container: hostRef.current }),
        UniverSheetsFilterPreset(),
        UniverSheetsSortPreset(),
        UniverSheetsConditionalFormattingPreset(),
        UniverSheetsFindReplacePreset(),
        UniverSheetsDataValidationPreset(),
      ],
    });
    univerAPI.createWorkbook({ name: '月度销售表' });
    apiRef.current = univerAPI as unknown as { getActiveWorkbook?: () => { getActiveSheet?: () => FSheetOps } };

    const wb = univerAPI.getActiveWorkbook() as unknown as (FWorkbookLike & { getActiveSheet?: () => { getRange: (r: number, c: number) => { setValue: (v: unknown) => void } } }) | null;
    try {
      const sheet = wb?.getActiveSheet?.();
      if (sheet) {
        HEADERS.forEach((h, c) => sheet.getRange(0, c).setValue(h));
        DATA.forEach((row, r) => row.forEach((v, c) => sheet.getRange(r + 1, c).setValue(v)));
      }
    } catch {
      /* 演示数据可选 */
    }

    let dispose: (() => void) | undefined;
    try {
      const d = wb?.onSelectionChange(() => cb.current?.(snap(wb)));
      dispose = d?.dispose;
      cb.current?.(snap(wb));
    } catch {
      /* 选区订阅可选 */
    }

    return () => {
      dispose?.();
      apiRef.current = null;
      univer.dispose();
    };
  }, []);

  return <div className="univer-host" ref={hostRef} />;
});

export default UniverSheet;
