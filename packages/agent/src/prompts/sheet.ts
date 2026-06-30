/**
 * 电子表格(sheet)专属的【只读取数工具】描述。
 * 这两条仅在有整表快照(hasSheet)时由 sheet-tools.ts 的 auxToolDefs 挂载,
 * 是表格取数能力而非格式无关的对话循环文案,故从 agent-loop.ts 拆出单列于此;
 * 导出名(READ_RANGE_DESC / AGGREGATE_DESC)不变,仍由 prompts/index.ts 的 barrel 重新导出。
 */

export const READ_RANGE_DESC =
  '读取整张表里任意 A1 区域的精确单元格值(用于超出已给样本、需要拿到真实数据时按需查证)。';

export const AGGREGATE_DESC =
  '对某一整列(column,必填)做聚合统计(自动跳过表头);' +
  '可选 groupBy 按某列分组(做透视/分组汇总,如"各产品销量合计"),' +
  '可选 where 先按条件筛选行再聚合。';
