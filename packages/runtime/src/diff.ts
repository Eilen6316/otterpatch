/**
 * 轻量可审阅 diff —— 由 ChangeSet 的 edits 直接派生(逐 edit:锚点引用 + 徽标 + 标签 + after)。
 * JSON 友好,供 MCP/CLI 消费;不依赖适配器 shadowApply(适配器仍为桩),因此 headless 即可用。
 */
import type { ChangeSet, EditOp, LogicalAnchor } from '@opal/core';

export type DiffBadge = 'add' | 'remove' | 'modify' | 'move';

export interface OpalDiffItem {
  editId: string;
  ref: string; // 人类可读锚点引用(A1 / mxCell id / 文本引述)
  badge: DiffBadge;
  label: string;
  after?: string;
}
export interface OpalDiff {
  changeSetId: string;
  hostId: string;
  intent: string;
  items: OpalDiffItem[];
}

function refOf(a: LogicalAnchor | undefined, fallback: string): string {
  if (!a) return fallback;
  const p = a.portable;
  switch (p.kind) {
    case 'grid':
      return `${p.sheet}!${p.a1}`;
    case 'object':
      return p.elementId;
    case 'flow':
      return p.quote.text.slice(0, 24);
    case 'composite':
      return 'composite';
  }
}

function describe(op: EditOp): { badge: DiffBadge; label: string; after?: string } {
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
      return { badge: 'modify', label: 'set style', after: JSON.stringify(op.style) };
    case 'setNumberFormat':
      return { badge: 'modify', label: 'number format', after: op.pattern };
    case 'insertRows':
      return { badge: 'add', label: `insert ${op.count} row(s)` };
    case 'deleteRows':
      return { badge: 'remove', label: 'delete rows' };
    case 'sortRange':
      return { badge: 'modify', label: `sort by col ${op.by} ${op.asc ? 'asc' : 'desc'}` };
    case 'setMark':
      return { badge: 'modify', label: `mark ${op.mark.type}` };
    case 'setParagraphStyle':
      return { badge: 'modify', label: `paragraph style ${op.styleName}` };
    case 'moveObject':
      return { badge: 'move', label: 'move object' };
    case 'setObjectProps':
      return { badge: 'modify', label: 'set props', after: JSON.stringify(op.props) };
    case 'addObject':
      return { badge: 'add', label: 'add object' };
    case 'deleteObject':
      return { badge: 'remove', label: 'delete object' };
    case 'rawHost':
      return { badge: 'modify', label: `raw ${op.hostId}` };
  }
}

export function buildDiff(cs: ChangeSet): OpalDiff {
  return {
    changeSetId: cs.id,
    hostId: cs.hostId,
    intent: cs.meta.intent,
    items: cs.edits.map((e) => {
      const d = describe(e.op);
      const item: OpalDiffItem = { editId: e.id, ref: refOf(cs.anchors[e.target], e.target), badge: d.badge, label: d.label };
      if (d.after !== undefined) item.after = d.after;
      return item;
    }),
  };
}
