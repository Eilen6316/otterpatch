/**
 * 图表自研(A 方案):Agent 给出图表意图 → 客户端用 ECharts 离屏渲染成 PNG → 作为浮动图片插入 Univer。
 * 全开源(echarts Apache-2.0),不走 Univer 付费图表插件;导出 .xlsx 时图片仍在。
 */
import * as echarts from 'echarts';

export interface ChartSpec {
  chartType: 'bar' | 'line' | 'pie';
  title: string;
  categories: string[]; // x 轴标签(饼图为各扇区名)
  series: { name: string; data: number[] }[]; // 一个或多个系列,与 categories 对齐
}

function buildOption(spec: ChartSpec): echarts.EChartsOption {
  const base: echarts.EChartsOption = { animation: false, backgroundColor: '#fff', title: { text: spec.title, left: 'center', textStyle: { fontSize: 15 } } };
  if (spec.chartType === 'pie') {
    return {
      ...base,
      tooltip: { trigger: 'item' },
      series: [{ type: 'pie', radius: '60%', center: ['50%', '56%'], data: spec.categories.map((c, i) => ({ name: c, value: spec.series[0]?.data[i] ?? 0 })) }],
    };
  }
  return {
    ...base,
    tooltip: { trigger: 'axis' },
    legend: { top: 28, data: spec.series.map((s) => s.name) },
    grid: { left: 56, right: 24, top: 64, bottom: 40 },
    xAxis: { type: 'category', data: spec.categories },
    yAxis: { type: 'value' },
    series: spec.series.map((s) => ({ name: s.name, type: spec.chartType, data: s.data })),
  };
}

/** 离屏渲染图表为 PNG data URL(canvas 渲染、关动画、2x 清晰),用完即销毁。 */
export function chartToPngDataUrl(spec: ChartSpec, w = 640, h = 400): string {
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${w}px;height:${h}px`;
  document.body.appendChild(host);
  const chart = echarts.init(host, undefined, { renderer: 'canvas', width: w, height: h, devicePixelRatio: 2 });
  try {
    chart.setOption(buildOption(spec));
    return chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
  } finally {
    chart.dispose();
    host.remove();
  }
}

/** 2D 网格(首行=表头/系列名,首列=类别,其余数值列=各系列)→ ChartSpec。 */
export function gridToChartSpec(grid: unknown[][], chartType: ChartSpec['chartType'], title: string): ChartSpec {
  const header = grid[0] ?? [];
  const body = grid.slice(1).filter((r) => r && r.length);
  const categories = body.map((r) => String(r[0] ?? ''));
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,%¥$\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const series: { name: string; data: number[] }[] = [];
  for (let c = 1; c < header.length; c++) {
    const data = body.map((r) => num(r[c]));
    if (data.some((n) => n !== 0)) series.push({ name: String(header[c] ?? '列' + c), data });
  }
  if (!series.length) series.push({ name: String(header[0] ?? '值'), data: body.map((r) => num(r[0])) });
  return { chartType, title, categories, series };
}
