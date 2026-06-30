/**
 * 图表自研(A 方案)渲染层:ChartSpec → ECharts 离屏渲染成 PNG → 作为浮动图片插入 Univer。
 * 全开源(echarts Apache-2.0),不走 Univer 付费图表插件;导出 .xlsx 时图片仍在。
 * 数据层(纯函数、可单测)在 chart-data.ts。
 */
import * as echarts from 'echarts';
import { type ChartSpec } from './chart-data.js';

export { type ChartSpec, a1ToRC, rcToColLetter, buildChartGrid, gridToChartSpec, specFromInline, chartSummary } from './chart-data.js';

function buildOption(spec: ChartSpec): echarts.EChartsOption {
  const base: echarts.EChartsOption = {
    animation: false,
    backgroundColor: '#fff',
    color: ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'],
    title: { text: spec.title, left: 'center', textStyle: { fontSize: 15 } },
  };
  if (spec.chartType === 'pie') {
    return {
      ...base,
      tooltip: { trigger: 'item' },
      legend: { top: 28, left: 'center' },
      series: [{ type: 'pie', radius: '58%', center: ['50%', '58%'], data: spec.categories.map((c, i) => ({ name: c, value: spec.series[0]?.data[i] ?? 0 })), label: { formatter: '{b}: {d}%' } }],
    };
  }
  // 量级差异大时(如「金额」十万级 vs「销量」千级 vs「毛利率」十级),把小量级系列放到右侧第二坐标轴,
  // 否则小数值会被大数压成贴地直线 —— 这正是"透视图显示有问题"的常见根因。
  const maxes = spec.series.map((s) => Math.max(1, ...s.data.map((v) => Math.abs(v))));
  const overallMax = Math.max(1, ...maxes);
  const useDual = spec.series.length >= 2 && maxes.some((m) => overallMax / m > 20);
  const onRight = (i: number): boolean => useDual && overallMax / maxes[i]! > 20;
  const yAxis = useDual
    ? [
        { type: 'value' as const, name: spec.series.find((_, i) => !onRight(i))?.name },
        { type: 'value' as const, name: spec.series.find((_, i) => onRight(i))?.name },
      ]
    : { type: 'value' as const };
  return {
    ...base,
    tooltip: { trigger: 'axis' },
    legend: { top: 28, data: spec.series.map((s) => s.name) },
    grid: { left: 56, right: useDual ? 60 : 24, top: 64, bottom: 40 },
    xAxis: { type: 'category', data: spec.categories },
    yAxis,
    series: spec.series.map((s, i) => ({ name: s.name, type: spec.chartType, data: s.data, yAxisIndex: onRight(i) ? 1 : 0 })),
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
