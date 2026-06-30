/**
 * 图表「数据层」—— 纯函数,无 echarts/DOM 依赖,可在 node 下单测。
 * 负责:A1 坐标换算、把"网格 + 本次写入值"叠加成图表数据、网格 → ChartSpec。
 * 渲染层(echarts → PNG)在 chart.ts。
 */
export interface ChartSpec {
  chartType: 'bar' | 'line' | 'pie';
  title: string;
  categories: string[]; // x 轴标签(饼图为各扇区名)
  series: { name: string; data: number[] }[]; // 一个或多个系列,与 categories 对齐
}

/** A1(可带 sheet 前缀/范围)取首格 → {row,col} 0 基。 */
export function a1ToRC(a1: string): { row: number; col: number } {
  const cell = (a1.replace(/^.*!/, '').split(':')[0] ?? 'A1');
  const m = /([A-Za-z]+)([0-9]+)/.exec(cell);
  let c = 0;
  if (m) for (const ch of m[1]!.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { col: m ? c - 1 : 0, row: m ? parseInt(m[2]!, 10) - 1 : 0 };
}

/** 0 基列号 → 列字母(0→A,26→AA)。 */
export function rcToColLetter(n: number): string {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/**
 * 用"本次写入值优先,否则改前实时值"叠加出图表数据网格 —— 不依赖落值时序。
 * 关键:图表数据常由【同一 changeset 的 setValue】刚写入,而结构性操作先于单元格落值执行,
 * 直接读实时网格会读到空格 → 空图。故 written(本次将写入的 A1→值)优先,其余回退 live()。
 * @param range  含表头的数据范围,如 "A7:D10"
 * @param written 本次 changeset 写入值:键为大写、去 sheet 前缀的 A1
 * @param live    取改前实时值的回调(范围内未被写入覆盖的格子用它)
 */
export function buildChartGrid(range: string, written: Map<string, unknown>, live: (cell: string) => unknown): unknown[][] {
  const r = range.replace(/^.*!/, '');
  const [s0, s1] = r.split(':');
  const A = a1ToRC(s0 ?? 'A1');
  const B = a1ToRC(s1 ?? s0 ?? 'A1');
  const r0 = Math.min(A.row, B.row);
  const r1 = Math.max(A.row, B.row);
  const c0 = Math.min(A.col, B.col);
  const c1 = Math.max(A.col, B.col);
  const grid: unknown[][] = [];
  for (let row = r0; row <= r1; row++) {
    const cells: unknown[] = [];
    for (let col = c0; col <= c1; col++) {
      const cell = rcToColLetter(col) + (row + 1);
      const w = written.get(cell.toUpperCase());
      cells.push(w !== undefined ? w : live(cell));
    }
    grid.push(cells);
  }
  return grid;
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[,%¥$\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** 2D 网格(首行=表头/系列名,首列=类别,其余数值列=各系列)→ ChartSpec。 */
export function gridToChartSpec(grid: unknown[][], chartType: ChartSpec['chartType'], title: string): ChartSpec {
  const header = grid[0] ?? [];
  const body = grid.slice(1).filter((r) => r && r.length && String(r[0] ?? '').trim() !== '');
  const categories = body.map((r) => String(r[0] ?? ''));
  const series: { name: string; data: number[] }[] = [];
  for (let c = 1; c < header.length; c++) {
    const data = body.map((r) => toNum(r[c]));
    if (data.some((n) => n !== 0)) series.push({ name: String(header[c] ?? '列' + c), data });
  }
  // 兜底:整行只有一列数值(或表头缺失),把首列当数值、用表头/'值'命名
  if (!series.length) {
    const data = body.map((r) => toNum(r[r.length - 1]));
    series.push({ name: String(header[header.length - 1] ?? '值'), data });
  }
  return { chartType, title, categories, series };
}

/** 内联数据(Agent 直接给 categories/series,不经表格)→ ChartSpec;做容错:数值强转、丢空系列。 */
export function specFromInline(
  chartType: ChartSpec['chartType'],
  title: string,
  categories: unknown[] | undefined,
  series: { name?: unknown; data?: unknown[] }[] | undefined,
): ChartSpec {
  const cats = (categories ?? []).map((c) => String(c ?? ''));
  const out: { name: string; data: number[] }[] = [];
  for (const s of series ?? []) {
    const data = (s?.data ?? []).map(toNum);
    if (data.length && data.some((n) => n !== 0)) out.push({ name: String(s?.name ?? '系列'), data });
  }
  return { chartType, title, categories: cats, series: out };
}

/** 图表一句话摘要(供审阅 diff 展示,让"插入图表"在改动明细里看得见)。 */
export function chartSummary(chartType: ChartSpec['chartType'], title: string, range: string): string {
  const kind = chartType === 'pie' ? '饼图' : chartType === 'line' ? '折线图' : '柱状图';
  return `📊 ${kind}「${title}」· 数据 ${range.replace(/^.*!/, '')}`;
}
