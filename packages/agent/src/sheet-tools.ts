/**
 * 表格 Agent 的"取数/路由"共享件 —— 与厂商无关,供 OpenAI 兼容与 Claude 两条通道复用,
 * 保证默认 Claude 通道也拥有同样的 read_range/aggregate 取数 + answer_user 路由 + 多步 loop。
 * 各通道只负责把这里的"逻辑工具定义/系统提示/取数执行"映射到自家 SDK 的消息/工具格式。
 */
import type { ClarifyOption, ClarifyQuestion, HostDialect, ProposeRequest } from './model.js';
import { safeParse } from './json-salvage.js';
import { ROUTING_PREAMBLE, TOO_MANY_STEPS_MSG, ANSWER_USER_DESC, ASK_USER_DESC, READ_RANGE_DESC, AGGREGATE_DESC } from './prompts/index.js';
import { DOC_TOOL_DEFS, execDocTool, type DocSnapshot } from './doc-tools.js';

/** 多步 loop 的步数上限。取数四件套 + load_skill + 影子修复 + 收尾自检都各占一步,
 *  8 步在"加载手册→审计样式→读段→提案→修复→自检→重交"的专家流程里会被吃满(bench 实测 w-gongwen 撞限),放宽到 12。 */
export const STEP_LIMIT = 12;
export { ROUTING_PREAMBLE, TOO_MANY_STEPS_MSG };

/** respond 系统提示拆两段:stable(路由前导+方言+技能,跨轮不变→可挂 prompt cache)与 volatile(当前文档/选区快照,每轮都变)。 */
export function respondSystemParts(dialect: HostDialect, req: ProposeRequest): { stable: string; volatile: string } {
  return { stable: ROUTING_PREAMBLE + '\n\n' + dialect.systemPrompt, volatile: '当前文档/选区上下文:\n' + req.context };
}
/** respond 多步 loop 的系统提示(拼接版,OpenAI 兼容通道用)。 */
export function respondSystem(dialect: HostDialect, req: ProposeRequest): string {
  const p = respondSystemParts(dialect, req);
  return p.stable + '\n\n' + p.volatile;
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
  description: ANSWER_USER_DESC,
  parameters: { type: 'object', properties: { text: { type: 'string', description: '给用户的回答(简洁、可含数字结论)' } }, required: ['text'] },
};
export const ASK_USER_DEF: ToolDef = {
  name: 'ask_user',
  description: ASK_USER_DESC,
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '1-4 个澄清问题。互相独立的问题可一并问;若后一个依赖前一个的答案,本轮只放最前面那个,下一轮再问下一个。',
        items: {
          type: 'object',
          properties: {
            header: { type: 'string', description: '问题的极短标签(≤8 字),如"图表类型""分组依据"' },
            question: { type: 'string', description: '具体问题(以问号结尾)' },
            multi: { type: 'boolean', description: '是否允许多选(默认单选)' },
            options: {
              type: 'array',
              description: '2-4 个候选项;把最推荐的放第一个。用户也可不选、在"其他"里自己填。',
              items: {
                type: 'object',
                properties: { label: { type: 'string', description: '候选项(简短)' }, description: { type: 'string', description: '该选项的说明/取舍(可选)' } },
                required: ['label'],
              },
            },
          },
          required: ['question', 'options'],
        },
      },
    },
    required: ['questions'],
  },
};
export const READ_RANGE_DEF: ToolDef = {
  name: 'read_range',
  description: READ_RANGE_DESC,
  parameters: { type: 'object', properties: { a1: { type: 'string', description: 'A1 区域,如 C2:C500' } }, required: ['a1'] },
};
export const AGGREGATE_DEF: ToolDef = {
  name: 'aggregate',
  description: AGGREGATE_DESC,
  parameters: {
    type: 'object',
    properties: {
      column: { type: 'string', description: '要聚合的列字母,如 C' },
      op: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count'] },
      groupBy: { type: 'string', description: '(可选)按此列分组,做透视/分组汇总,如按产品列 B 汇总销量 C' },
      where: {
        type: 'object',
        description: '(可选)先按条件筛选行再聚合',
        properties: { col: { type: 'string', description: '条件列字母' }, op: { type: 'string', enum: ['=', '!=', '>', '<', 'contains'] }, value: { description: '比较值' } },
        required: ['col', 'op', 'value'],
      },
    },
    required: ['column', 'op'],
  },
};
export interface AggWhere { col: string; op: '=' | '!=' | '>' | '<' | 'contains'; value: string | number }

/** 辅助工具菜单:answer_user / ask_user 总在;有整表快照加 read_range/aggregate;有文档快照加 Word 四件套。 */
export function auxToolDefs(hasSheet: boolean, hasDoc = false): ToolDef[] {
  const base = [ANSWER_USER_DEF, ASK_USER_DEF];
  return [...base, ...(hasSheet ? [READ_RANGE_DEF, AGGREGATE_DEF] : []), ...(hasDoc ? DOC_TOOL_DEFS : [])];
}

/** 统一只读工具执行:sheet 工具 → execSheetTool;doc 工具 → execDocTool;都不认识 → '(unknown tool)'。 */
export function execReadTool(name: string, args: Record<string, unknown>, req: { sheet?: SheetData; doc?: DocSnapshot }): string {
  const d = execDocTool(name, args as { from?: number; to?: number; pattern?: string }, req.doc);
  if (d !== null) return d;
  return execSheetTool(name, args as { a1?: string; column?: string; op?: string; groupBy?: string; where?: AggWhere }, req.sheet);
}

/** 容错解析 ask_user 入参(字符串或已解析对象皆可)→ 规范化的澄清问题;无有效问题则返回 []。 */
export function parseClarify(input: unknown): ClarifyQuestion[] {
  const obj = (typeof input === 'string' ? safeParse(input) : (input ?? {})) as { questions?: unknown };
  const arr = Array.isArray(obj.questions) ? obj.questions : [];
  const out: ClarifyQuestion[] = [];
  for (const q of arr.slice(0, 4)) {
    if (!q || typeof q !== 'object') continue;
    const qq = q as { header?: unknown; question?: unknown; multi?: unknown; options?: unknown };
    const question = String(qq.question ?? '').trim();
    if (!question) continue;
    const options: ClarifyOption[] = [];
    for (const o of (Array.isArray(qq.options) ? qq.options : []).slice(0, 6)) {
      const oo = (o ?? {}) as { label?: unknown; description?: unknown };
      const label = String(oo.label ?? '').trim();
      if (label) options.push({ label, ...(oo.description ? { description: String(oo.description) } : {}) });
    }
    if (!options.length) continue;
    out.push({ question, options, ...(qq.header ? { header: String(qq.header) } : {}), ...(qq.multi ? { multi: true } : {}) });
  }
  return out;
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

const toNumber = (v: unknown): number => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[,%¥$\s]/g, '')));
function aggOf(nums: number[], op: string): string {
  if (!nums.length) return '无数值';
  const sum = nums.reduce((p, q) => p + q, 0);
  if (op === 'sum') return String(Math.round(sum * 1000) / 1000);
  if (op === 'avg') return String(Math.round((sum / nums.length) * 1000) / 1000);
  if (op === 'min') return String(Math.min(...nums));
  if (op === 'max') return String(Math.max(...nums));
  if (op === 'count') return String(nums.length);
  return `sum=${Math.round(sum * 1000) / 1000} avg=${Math.round((sum / nums.length) * 100) / 100} min=${Math.min(...nums)} max=${Math.max(...nums)} count=${nums.length}`;
}

/** 对某列做聚合(跳过表头);支持 where 先筛选、groupBy 分组(透视/分组汇总)。 */
export function aggregate(sheet: SheetData, column: string, op: string, groupBy?: string, where?: AggWhere): string {
  const s = startOf(sheet.a1);
  const ci = colIndex(column.replace(/[^A-Za-z]/g, '') || 'A') - s.c;
  const gi = groupBy ? colIndex(groupBy.replace(/[^A-Za-z]/g, '') || 'A') - s.c : -1;
  const wi = where ? colIndex(where.col.replace(/[^A-Za-z]/g, '') || 'A') - s.c : -1;
  const pass = (row: unknown[]): boolean => {
    if (wi < 0 || !where) return true;
    const cell = row[wi];
    const a = toNumber(cell), b = toNumber(where.value);
    const bothNum = Number.isFinite(a) && Number.isFinite(b);
    switch (where.op) {
      case '=': return String(cell ?? '') === String(where.value);
      case '!=': return String(cell ?? '') !== String(where.value);
      case '>': return bothNum && a > b;
      case '<': return bothNum && a < b;
      case 'contains': return String(cell ?? '').includes(String(where.value));
      default: return true;
    }
  };
  if (gi >= 0) {
    const groups = new Map<string, number[]>();
    for (let i = 1; i < sheet.values.length; i++) {
      const row = sheet.values[i] ?? [];
      if (!pass(row)) continue;
      const g = String(row[gi] ?? '(空)');
      const n = toNumber(row[ci]);
      if (!groups.has(g)) groups.set(g, []);
      if (Number.isFinite(n)) groups.get(g)!.push(n);
    }
    if (!groups.size) return '无数据';
    return [...groups].map(([g, ns]) => `${g}: ${aggOf(ns, op)}`).join('\n');
  }
  const nums: number[] = [];
  for (let i = 1; i < sheet.values.length; i++) {
    const row = sheet.values[i] ?? [];
    if (!pass(row)) continue;
    const n = toNumber(row[ci]);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums.length ? aggOf(nums, op) : '该列无数值';
}

/** 按工具名执行只读取数工具,返回回喂模型的文本。 */
export function execSheetTool(name: string, args: { a1?: string; column?: string; op?: string; groupBy?: string; where?: AggWhere }, sheet?: SheetData): string {
  if (name === 'read_range' && sheet) return readRange(sheet, String(args.a1 ?? ''));
  if (name === 'aggregate' && sheet) return aggregate(sheet, String(args.column ?? ''), String(args.op ?? ''), args.groupBy, args.where);
  return '(unknown tool)';
}
