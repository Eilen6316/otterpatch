/**
 * 轻量可审阅 diff —— 由 ChangeSet 的 edits 直接派生(逐 edit:锚点引用 + 徽标 + 标签 + after)。
 * JSON 友好,供 MCP/CLI 消费;不依赖适配器 shadowApply(适配器仍为桩),因此 headless 即可用。
 */
import type { AbstractStyle, ChangeSet, EditOp, LogicalAnchor } from '@otterpatch/core';

export type DiffBadge = 'add' | 'remove' | 'modify' | 'move';

export interface OtterPatchDiffItem {
  editId: string;
  ref: string; // 人类可读锚点引用(A1 / mxCell id / 文本引述)
  badge: DiffBadge;
  label: string;
  after?: string;
  style?: AbstractStyle; // 格式类改动(标红/加粗/字色/数字格式)的结构化样式,供前端直接套用
}

function styleSummary(s: AbstractStyle): string {
  const parts: string[] = [];
  if (s.bgColor) parts.push('填充 ' + s.bgColor);
  if (s.color) parts.push('字色 ' + s.color);
  if (s.bold) parts.push('加粗');
  if (s.italic) parts.push('斜体');
  if (s.align) parts.push('对齐 ' + s.align);
  if (s.numberFormat) parts.push('数字格式 ' + s.numberFormat);
  return parts.join(' · ') || '套用格式';
}
export interface OtterPatchDiff {
  changeSetId: string;
  hostId: string;
  intent: string;
  items: OtterPatchDiffItem[];
}

function refOf(a: LogicalAnchor | undefined, fallback: string): string {
  if (!a) return fallback;
  const p = a.portable;
  switch (p.kind) {
    case 'grid':
      return p.a1.includes('!') ? p.a1 : `${p.sheet}!${p.a1}`;
    case 'object':
      return p.elementId;
    case 'flow':
      return p.quote.text.slice(0, 24);
    case 'composite':
      return 'composite';
  }
}

function describe(op: EditOp): { badge: DiffBadge; label: string; after?: string; style?: AbstractStyle } {
  switch (op.kind) {
    case 'setValue':
      return { badge: 'modify', label: 'set value', after: String(op.value ?? '') };
    case 'setFormula':
      return { badge: 'modify', label: 'set formula', after: op.formula };
    case 'replaceText':
      return { badge: 'modify', label: 'replace text', after: op.text };
    case 'insertText':
      return { badge: 'add', label: `insert text (${op.at})`, after: op.text };
    case 'deleteRange':
      return { badge: 'remove', label: 'delete range' };
    case 'setStyle':
      return { badge: 'modify', label: styleSummary(op.style), style: op.style, after: styleSummary(op.style) };
    case 'setNumberFormat':
      return { badge: 'modify', label: '数字格式 ' + op.pattern, style: { numberFormat: op.pattern }, after: op.pattern };
    case 'insertRows':
      return { badge: 'add', label: `插入 ${op.count} 行` };
    case 'deleteRows':
      return { badge: 'remove', label: `删除 ${op.count ?? 1} 行` };
    case 'sortRange':
      return { badge: 'modify', label: `按第 ${op.by + 1} 列${op.asc ? '升序' : '降序'}排序` };
    case 'insertCols':
      return { badge: 'add', label: `插入 ${op.count} 列` };
    case 'deleteCols':
      return { badge: 'remove', label: `删除 ${op.count ?? 1} 列` };
    case 'mergeCells':
      return { badge: 'modify', label: '合并单元格' };
    case 'unmergeCells':
      return { badge: 'modify', label: '取消合并' };
    case 'freezePanes':
      return { badge: 'modify', label: `冻结 ${op.rows} 行 / ${op.cols} 列` };
    case 'autoFilter':
      return { badge: 'modify', label: '自动筛选' };
    case 'insertChart': {
      const kind = op.chartType === 'pie' ? '饼' : op.chartType === 'line' ? '折线' : '柱状';
      const dataDesc = op.categories?.length
        ? `${op.categories.length} 类 · ${(op.series ?? []).map((s) => s.name).join('/') || '系列'}`
        : `数据 ${op.range ?? ''}`;
      return { badge: 'add', label: `插入${kind}图「${op.title}」(${dataDesc})`, after: `📊 ${kind}图「${op.title}」· ${dataDesc}` };
    }
    case 'conditionalFormat':
      return { badge: 'modify', label: `条件格式 ${op.when}${op.style.bgColor ? ' → 填充 ' + op.style.bgColor : ''}${op.style.color ? ' 字色 ' + op.style.color : ''}` };
    case 'dataValidation':
      return { badge: 'modify', label: `数据验证 ${op.rule}` };
    case 'setMark':
      return { badge: 'modify', label: `mark ${op.mark.type}` };
    case 'setParagraphStyle':
      return { badge: 'modify', label: `paragraph style ${op.styleName}` };
    case 'moveObject':
      return { badge: 'move', label: 'move object' };
    case 'setObjectProps':
      return { badge: 'modify', label: 'set props', after: JSON.stringify(op.props) };
    case 'addObject': {
      const p = (op.payload ?? {}) as { value?: string; edge?: boolean; source?: string; target?: string };
      if (p.edge || (p.source && p.target)) return { badge: 'add', label: `连线 ${p.source ?? '?'} → ${p.target ?? '?'}` };
      return p.value ? { badge: 'add', label: `新增节点「${p.value}」`, after: String(p.value) } : { badge: 'add', label: '新增节点' };
    }
    case 'deleteObject':
      return { badge: 'remove', label: 'delete object' };
    case 'rawHost':
      return { badge: 'modify', label: `raw ${op.hostId}` };
  }
}

export function buildDiff(cs: ChangeSet): OtterPatchDiff {
  return {
    changeSetId: cs.id,
    hostId: cs.hostId,
    intent: cs.meta.intent,
    items: cs.edits.map((e) => {
      const d = describe(e.op);
      const item: OtterPatchDiffItem = { editId: e.id, ref: refOf(cs.anchors[e.target], e.target), badge: d.badge, label: d.label };
      if (d.after !== undefined) item.after = d.after;
      if (d.style) item.style = d.style;
      return item;
    }),
  };
}
