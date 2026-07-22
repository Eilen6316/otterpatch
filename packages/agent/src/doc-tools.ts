/**
 * Shared "data-fetching" layer for the Word document Agent — isomorphic to sheet-tools, vendor-agnostic, reused by both model channels.
 * Addresses the biggest perception gap in the Word scenario: paragraph text in the context is truncated, and a model that "can't see everything" cannot do expert-level diagnosis.
 * Four read-only tools: read_blocks (full text by paragraph range) / find_text (full-text search) / get_outline (heading outline) / get_style_usage (style distribution).
 * The snapshot is uploaded by the host (desktop/CLI) with the request; serve never feeds it back into the model prompt — tools fetch from it on demand.
 */
import type { ToolDef } from './sheet-tools.js';
import { READ_BLOCKS_DESC, FIND_TEXT_DESC, GET_OUTLINE_DESC, GET_STYLE_USAGE_DESC } from './prompts/index.js';

/** Snapshot of one paragraph (block): style name + full text + key layout properties. idx is the array index (0-based; +1 when displayed). */
export interface DocBlock {
  style: string; // Literal style values, e.g. '标题1' | '标题2' | '标题3' | '正文' | '引用' | '列表项' …
  text: string; // Full plain text of the paragraph (clean-copy projection: excludes old text from pending revisions)
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

/** Read full text by paragraph-number range (1-based, inclusive); block count is capped to avoid swallowing the whole document in one call. */
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

/** Full-text search: returns each hit's paragraph number + surrounding excerpt; truncates with a note when there are too many hits. */
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

/** Document outline: heading-level tree + skipped-level diagnostics. */
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

/** Style usage distribution: paragraph count and sample paragraph numbers for each style×font×size×alignment×line-spacing combination — raw material for layout audits. */
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
  const hint = bodyKinds > 1 ? `\n⚠ 正文出现 ${bodyKinds} 种排版组合 —— 基线不统一;当前需按段落逐条提出可审阅的格式改动,不要生成无锚点的全文样式。` : '';
  return `样式使用分布(${groups.size} 种组合 / ${doc.blocks.length} 段):\n` + rows.join('\n') + hint;
}

/** Execute a Word read-only tool by name; returns text to feed back to the model. Returns null for tools outside this group (caller continues routing). */
export function execDocTool(name: string, args: { from?: number; to?: number; pattern?: string }, doc?: DocSnapshot): string | null {
  if (name === 'read_blocks') return doc ? readBlocks(doc, Number(args.from ?? 1), args.to != null ? Number(args.to) : undefined) : '(无文档快照)';
  if (name === 'find_text') return doc ? findText(doc, String(args.pattern ?? '')) : '(无文档快照)';
  if (name === 'get_outline') return doc ? getOutline(doc) : '(无文档快照)';
  if (name === 'get_style_usage') return doc ? getStyleUsage(doc) : '(无文档快照)';
  return null;
}
