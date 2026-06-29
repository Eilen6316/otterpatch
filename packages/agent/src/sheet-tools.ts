/**
 * 表格 Agent 的"取数/路由"共享件 —— 与厂商无关,供 OpenAI 兼容与 Claude 两条通道复用,
 * 保证默认 Claude 通道也拥有同样的 read_range/aggregate 取数 + answer_user 路由 + 多步 loop。
 * 各通道只负责把这里的"逻辑工具定义/系统提示/取数执行"映射到自家 SDK 的消息/工具格式。
 */
import type { HostDialect, ProposeRequest } from './model.js';

/** 多步 loop 的步数上限(含一轮影子校验修复)。 */
export const STEP_LIMIT = 8;
export const TOO_MANY_STEPS_MSG = '处理步数过多,请缩小问题范围或把指令说得更具体。';

/** 路由前导:让模型自己判断『回答问题』还是『提出改动』(配合 tool_choice:auto)。 */
export const ROUTING_PREAMBLE =
  '判断用户意图后【果断行动】:① 若用户是在提问/查询/咨询(如"这列平均值多少""哪几行可能有问题""这个公式什么意思"),用 answer_user 工具给出简洁文字回答,【绝不要】修改表格;' +
  '② 凡是明确的执行/生成类指令(如"补全公式""标红异常值""统一格式""mock/造 N 行数据""把这列改成…""画一个 X 图"),【直接调用修改工具执行】——采用合理默认,把关键假设在 plan 里一句话讲清即可,【不要因为可以更完美而反复反问、也不要只输出分析而不动手】;' +
  '③ 只有当缺失信息会直接导致明显错误、且你无法合理假设时,才用 answer_user 澄清,且最多问一次、并给出你的推荐默认;' +
  '④ 上下文只给了大表样本时,需要更精确数据就调 read_range/aggregate 工具按需取,不要凭样本臆测;' +
  '⑤ 不要把思考写成长篇而不产出工具调用——想清楚后必须落到一次 propose_changeset(改表)或 answer_user(回答)。';

/** respond 多步 loop 的系统提示(路由前导 + 方言 + 当前表格/选区上下文)。 */
export function respondSystem(dialect: HostDialect, req: ProposeRequest): string {
  return ROUTING_PREAMBLE + '\n\n' + dialect.systemPrompt + '\n\n当前表格/选区上下文:\n' + req.context;
}

/** 取最近多轮历史(防上下文过长)。 */
export function recentHistory(req: ProposeRequest): Array<{ role: 'user' | 'assistant'; content: string }> {
  return (req.history ?? []).slice(-12);
}

/** 厂商无关的"逻辑工具定义";各通道映射到自家工具格式(OpenAI function / Anthropic tool)。 */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const ANSWER_USER_DEF: ToolDef = {
  name: 'answer_user',
  description: '当用户是在提问/查询/咨询表格(而不是要修改它)时,用本工具直接给出文字回答或澄清反问。',
  parameters: { type: 'object', properties: { text: { type: 'string', description: '给用户的回答(简洁、可含数字结论)' } }, required: ['text'] },
};
export const READ_RANGE_DEF: ToolDef = {
  name: 'read_range',
  description: '读取整张表里任意 A1 区域的精确单元格值(用于超出已给样本的数据)。',
  parameters: { type: 'object', properties: { a1: { type: 'string', description: 'A1 区域,如 C2:C500' } }, required: ['a1'] },
};
export const AGGREGATE_DEF: ToolDef = {
  name: 'aggregate',
  description: '对某一整列做聚合统计(自动跳过表头行)。',
  parameters: { type: 'object', properties: { column: { type: 'string', description: '列字母,如 C' }, op: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count'] } }, required: ['column', 'op'] },
};

/** 辅助工具菜单:answer_user 总在;有整表快照时再加 read_range/aggregate 取数工具。 */
export function auxToolDefs(hasSheet: boolean): ToolDef[] {
  return hasSheet ? [ANSWER_USER_DEF, READ_RANGE_DEF, AGGREGATE_DEF] : [ANSWER_USER_DEF];
}

// ─────────────── 取数执行(read_range / aggregate) ───────────────

export type SheetData = { a1: string; values: unknown[][] };

function colLetter(n: number): string {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
function colIndex(letters: string): number {
  let c = 0;
  for (const ch of letters.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}
function startOf(a1: string): { c: number; r: number } {
  const m = /([A-Za-z]+)([0-9]+)/.exec(a1.split(':')[0] ?? 'A1');
  return { c: m ? colIndex(m[1]!) : 0, r: m ? parseInt(m[2]!, 10) - 1 : 0 };
}

/** 从整表全量数据里读任意 A1 区域,返回带引用的文本。 */
export function readRange(sheet: SheetData, query: string): string {
  const s = startOf(sheet.a1);
  const parts = query.replace(/^.*!/, '').replace(/[$]/g, '').split(':');
  const cell = (str: string): { c: number; r: number } => {
    const m = /([A-Za-z]+)?([0-9]+)?/.exec(str.trim());
    return { c: m && m[1] ? colIndex(m[1]) : 0, r: m && m[2] ? parseInt(m[2], 10) - 1 : 0 };
  };
  const a = cell(parts[0] ?? 'A1');
  const b = parts[1] ? cell(parts[1]) : a;
  const r0 = Math.min(a.r, b.r);
  const r1 = Math.max(a.r, b.r);
  const c0 = Math.min(a.c, b.c);
  const c1 = Math.max(a.c, b.c);
  const lines: string[] = [];
  for (let r = r0; r <= r1; r++) {
    const row = sheet.values[r - s.r];
    if (!row) continue;
    const cells: string[] = [];
    for (let c = c0; c <= c1; c++) {
      const v = row[c - s.c];
      cells.push(`${colLetter(c)}${r + 1}=${v == null || v === '' ? '(空)' : String(v)}`);
    }
    lines.push(cells.join('  '));
  }
  return lines.join('\n') || '(空)';
}

/** 对某列做聚合(跳过表头)。 */
export function aggregate(sheet: SheetData, column: string, op: string): string {
  const s = startOf(sheet.a1);
  const ci = colIndex(column.replace(/[^A-Za-z]/g, '') || 'A') - s.c;
  const nums: number[] = [];
  for (let i = 1; i < sheet.values.length; i++) {
    const v = sheet.values[i]?.[ci];
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,%¥$\s]/g, ''));
    if (Number.isFinite(n)) nums.push(n);
  }
  if (!nums.length) return '该列无数值';
  const sum = nums.reduce((p, q) => p + q, 0);
  if (op === 'sum') return String(sum);
  if (op === 'avg') return String(Math.round((sum / nums.length) * 1000) / 1000);
  if (op === 'min') return String(Math.min(...nums));
  if (op === 'max') return String(Math.max(...nums));
  if (op === 'count') return String(nums.length);
  return `sum=${sum} avg=${Math.round((sum / nums.length) * 100) / 100} min=${Math.min(...nums)} max=${Math.max(...nums)} count=${nums.length}`;
}

/** 按工具名执行只读取数工具,返回回喂模型的文本。 */
export function execSheetTool(name: string, args: { a1?: string; column?: string; op?: string }, sheet?: SheetData): string {
  if (name === 'read_range' && sheet) return readRange(sheet, String(args.a1 ?? ''));
  if (name === 'aggregate' && sheet) return aggregate(sheet, String(args.column ?? ''), String(args.op ?? ''));
  return '(unknown tool)';
}
