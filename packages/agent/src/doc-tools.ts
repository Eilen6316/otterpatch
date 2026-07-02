/**
 * Word 文档 Agent 的"取数"共享件 —— 与 sheet-tools 同构、厂商无关,供两条模型通道复用。
 * 解决 Word 场景最大的感知短板:上下文里每段正文有截断,模型"看不全"就谈不上专家级诊断。
 * 四个只读工具:read_blocks(按段取全文)/ find_text(全文检索)/ get_outline(大纲)/ get_style_usage(样式分布)。
 * 快照由宿主(桌面/CLI)在请求里上送,serve 不回传给模型 prompt,只供工具按需取。
 */
import type { ToolDef } from './sheet-tools.js';
import { READ_BLOCKS_DESC, FIND_TEXT_DESC, GET_OUTLINE_DESC, GET_STYLE_USAGE_DESC } from './prompts/index.js';

/** 一段(块)的快照:样式名 + 全文 + 关键排版属性。idx 即数组下标(0 基,展示时 +1)。 */
export interface DocBlock {
  style: string; // '标题1' | '标题2' | '标题3' | '正文' | '引用' | '列表项' …
  text: string; // 该段完整纯文本(清样投影:不含未定修订的旧文)
  font?: string;
  size?: number; // pt
  align?: string;
  lineSpacing?: number;
}
export interface DocSnapshot { blocks: DocBlock[] }

export const READ_BLOCKS_DEF: ToolDef = {
  name: 'read_blocks',
  description: READ_BLOCKS_DESC,
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'number', description: '起始段号(1 基,含)' },
      to: { type: 'number', description: '结束段号(1 基,含;省略=只读 from 一段)' },
    },
    required: ['from'],
  },
};
export const FIND_TEXT_DEF: ToolDef = {
  name: 'find_text',
  description: FIND_TEXT_DESC,
  parameters: { type: 'object', properties: { pattern: { type: 'string', description: '要检索的片段/关键词(纯文本,非正则)' } }, required: ['pattern'] },
};
export const GET_OUTLINE_DEF: ToolDef = {
  name: 'get_outline',
  description: GET_OUTLINE_DESC,
  parameters: { type: 'object', properties: {} },
};
export const GET_STYLE_USAGE_DEF: ToolDef = {
  name: 'get_style_usage',
  description: GET_STYLE_USAGE_DESC,
  parameters: { type: 'object', properties: {} },
};

export const DOC_TOOL_DEFS: ToolDef[] = [READ_BLOCKS_DEF, FIND_TEXT_DEF, GET_OUTLINE_DEF, GET_STYLE_USAGE_DEF];

const clip = (s: string, n = 60): string => (s.length > n ? s.slice(0, n) + '…' : s);

/** 按段号区间读全文(1 基,含端点);段数带上限防一口气吞全书。 */
export function readBlocks(doc: DocSnapshot, from: number, to?: number, maxBlocks = 40): string {
  const a = Math.max(1, Math.floor(from));
  const b = Math.min(doc.blocks.length, Math.floor(to ?? from));
  if (a > doc.blocks.length || b < a) return `(段号超出范围:文档共 ${doc.blocks.length} 段)`;
  const end = Math.min(b, a + maxBlocks - 1);
  const lines = [];
  for (let i = a; i <= end; i++) {
    const blk = doc.blocks[i - 1]!;
    lines.push(`第${i}段 [${blk.style}]: ${blk.text || '(空段)'}`);
  }
  if (end < b) lines.push(`(一次最多返回 ${maxBlocks} 段,${end + 1}-${b} 段请再调一次)`);
  return lines.join('\n');
}

/** 全文检索:返回每处命中的段号 + 前后文摘录;命中过多时截断并提示。 */
export function findText(doc: DocSnapshot, pattern: string, maxHits = 20): string {
  const p = (pattern || '').trim();
  if (!p) return '(pattern 为空)';
  const hits: string[] = [];
  let total = 0;
  for (let i = 0; i < doc.blocks.length; i++) {
    const t = doc.blocks[i]!.text;
    let at = t.indexOf(p);
    while (at >= 0) {
      total++;
      if (hits.length < maxHits) {
        const s = Math.max(0, at - 15);
        const e = Math.min(t.length, at + p.length + 15);
        hits.push(`第${i + 1}段: …${t.slice(s, e)}…`);
      }
      at = t.indexOf(p, at + 1);
    }
  }
  if (!total) return `“${clip(p)}” 全文未出现。`;
  const head = `“${clip(p)}” 共出现 ${total} 处${total > 1 ? '(quote 定位需带足上下文使其唯一)' : ''}:`;
  return head + '\n' + hits.join('\n') + (total > maxHits ? `\n(只列前 ${maxHits} 处)` : '');
}

/** 文档大纲:标题层级树 + 越级诊断。 */
export function getOutline(doc: DocSnapshot): string {
  const heads: Array<{ i: number; lv: number; text: string }> = [];
  for (let i = 0; i < doc.blocks.length; i++) {
    const st = doc.blocks[i]!.style;
    const m = /^标题(\d)/.exec(st);
    if (m) heads.push({ i: i + 1, lv: parseInt(m[1]!, 10), text: clip(doc.blocks[i]!.text, 40) });
  }
  if (!heads.length) return `(无标题样式段落;文档共 ${doc.blocks.length} 段。若有"手动放大加粗冒充标题"的段落,用 get_style_usage 找出来)`;
  const lines = heads.map((h) => `${'  '.repeat(h.lv - 1)}H${h.lv} 第${h.i}段: ${h.text}`);
  const skips: string[] = [];
  for (let k = 1; k < heads.length; k++) if (heads[k]!.lv > heads[k - 1]!.lv + 1) skips.push(`第${heads[k]!.i}段 H${heads[k - 1]!.lv}→H${heads[k]!.lv} 越级`);
  return `大纲(共 ${heads.length} 个标题 / ${doc.blocks.length} 段):\n` + lines.join('\n') + (skips.length ? '\n⚠ 层级越级: ' + skips.join('; ') : '');
}

/** 样式使用分布:每种 样式×字体×字号×对齐×行距 组合的段数与示例段号 —— 排版审计的原料。 */
export function getStyleUsage(doc: DocSnapshot): string {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i]!;
    const key = [b.style, b.font ?? '?', b.size != null ? b.size + 'pt' : '?', b.align ?? '左对齐', b.lineSpacing != null ? '行距' + b.lineSpacing : ''].filter(Boolean).join(' · ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i + 1);
  }
  const rows = [...groups].sort((a, b) => b[1].length - a[1].length)
    .map(([k, ids]) => `${k} —— ${ids.length} 段(如 第${ids.slice(0, 5).join('、')}段${ids.length > 5 ? '…' : ''})`);
  const bodyKinds = [...groups.keys()].filter((k) => k.startsWith('正文')).length;
  const hint = bodyKinds > 1 ? `\n⚠ 正文出现 ${bodyKinds} 种排版组合 —— 基线不统一,规范化时可用 all=true 一次拉齐(注意别动标题)。` : '';
  return `样式使用分布(${groups.size} 种组合 / ${doc.blocks.length} 段):\n` + rows.join('\n') + hint;
}

/** 按工具名执行 Word 只读工具,返回回喂模型的文本;非本组工具返回 null(由调用方继续路由)。 */
export function execDocTool(name: string, args: { from?: number; to?: number; pattern?: string }, doc?: DocSnapshot): string | null {
  if (name === 'read_blocks') return doc ? readBlocks(doc, Number(args.from ?? 1), args.to != null ? Number(args.to) : undefined) : '(无文档快照)';
  if (name === 'find_text') return doc ? findText(doc, String(args.pattern ?? '')) : '(无文档快照)';
  if (name === 'get_outline') return doc ? getOutline(doc) : '(无文档快照)';
  if (name === 'get_style_usage') return doc ? getStyleUsage(doc) : '(无文档快照)';
  return null;
}
