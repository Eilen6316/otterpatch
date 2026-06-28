/**
 * 真实 Univer 电子表格实例(替换 Excel 渲染区的 mock 网格)。
 * 并把用户在表里框选的【区域 + 单元格值 + 格式(加粗/斜体/下划线/字号)】通过 onSelection 上抛给 App,
 * 让右侧 Agent 交互区感知选区,发送时把选区内容一并交给 Agent —— Agent 完全赋能 OtterPatch。
 */
import { useEffect, useRef } from 'react';
import { createUniver, defaultTheme, LocaleType, merge } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';

export interface UniSel {
  a1: string;
  rows: number;
  cols: number;
  text: string; // 喂给 Agent 的选区上下文(值表格 + 格式说明)
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

function snap(wb: FWorkbookLike | null | undefined): UniSel | null {
  try {
    const range = wb?.getActiveRange();
    if (!range) return null;
    const a1 = range.getA1Notation();
    const values = range.getValues();
    const styles = range.getCellStyles();
    const rows = values.length;
    const cols = values[0]?.length ?? 0;
    const grid = values.map((row) => row.map((v) => (v == null ? '' : String(v))).join('\t')).join('\n');
    const start = parseStart(a1);
    const notes: string[] = [];
    styles.forEach((row, r) =>
      row.forEach((st, c) => {
        if (!st) return;
        const fmt: string[] = [];
        if (st.bold) fmt.push('加粗');
        if (st.italic) fmt.push('斜体');
        if (st.underline) fmt.push('下划线');
        if (st.fontSize) fmt.push(`${st.fontSize}px`);
        if (fmt.length) notes.push(`${colName(start.c + c)}${start.r + r + 1}=${fmt.join('/')}`);
      }),
    );
    const text = `选区 ${a1}(${rows}×${cols})\n${grid}` + (notes.length ? `\n格式: ${notes.join('; ')}` : '');
    return { a1, rows, cols, text };
  } catch {
    return null;
  }
}

export default function UniverSheet({ onSelection }: { onSelection?: (s: UniSel | null) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onSelection);
  cb.current = onSelection;

  useEffect(() => {
    if (!ref.current) return;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: { [LocaleType.ZH_CN]: merge({}, sheetsZhCN) },
      theme: defaultTheme,
      presets: [UniverSheetsCorePreset({ container: ref.current })],
    });
    univerAPI.createWorkbook({ name: '月度销售表' });

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
      univer.dispose();
    };
  }, []);

  return <div className="univer-host" ref={ref} />;
}
