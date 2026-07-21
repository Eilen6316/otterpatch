import { cleanLabel, innerForStyle, parseDrawioStyle, snap } from './DrawioBoard.js';
import type { BEdge, BNode } from './DrawioBoard.js';
import type { DocFmt, DocTable } from './richdoc-editing.js';
import { styleToKind } from './shape-engine.js';
import { isGridStructureKind } from './grid-operation-kinds.js';

export { isGridStructureKind };

export interface CellState {
  v?: unknown;
  f?: string | null;
  bg?: string | null;
  color?: string | null;
  bold?: boolean;
  numFmt?: string | null;
  align?: 'left' | 'center' | 'right' | null;
}

export interface GridOp {
  a1: string;
  value?: unknown;
  bg?: string;
  color?: string;
  bold?: boolean;
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
  note: string;
  before?: unknown;
  beforeState?: CellState;
  editId?: string;
}

export interface AgentStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  bgColor?: string;
  align?: string;
  numberFormat?: string;
}

export interface AgentDiffItem {
  editId: string;
  ref: string;
  kind?: string;
  badge: string;
  label: string;
  after?: string;
  style?: AgentStyle;
}

export interface AgentDiff {
  changeSetId: string;
  hostId: string;
  intent: string;
  items: AgentDiffItem[];
}

export interface BoardObject {
  node?: BNode;
  edge?: BEdge;
}

export interface BoardMutationSnapshot {
  prior: BoardObject;
  priorRelated?: BoardObject[];
  next: BoardObject | null;
}

export interface BoardPatch {
  byEdit: Record<string, string>;
  objs: Array<BoardObject & { editId: string }>;
  muts?: Record<string, BoardMutationSnapshot>;
}

export interface WordEdit {
  editId: string;
  domId: string;
  quote: string;
  replacement?: string;
  style?: DocFmt;
  blockIdx?: number;
  remove?: boolean;
  img?: { action: 'remove' | 'resize'; width?: number };
  table?: DocTable;
}

export interface AddedBoardObjects {
  nodes: BNode[];
  edges: BEdge[];
  byEdit: Record<string, string>;
  objs: Array<BoardObject & { editId: string }>;
}

export const wordEditOpts = (edit: WordEdit): {
  replacement?: string;
  fmt?: DocFmt;
  blockIdx?: number;
  removeBlock?: boolean;
  img?: { action: 'remove' | 'resize'; width?: number };
  table?: DocTable;
} => edit.table
  ? { table: edit.table, blockIdx: edit.blockIdx }
  : edit.img
  ? { img: edit.img, blockIdx: edit.blockIdx }
  : edit.remove
    ? { removeBlock: true, blockIdx: edit.blockIdx }
    : edit.style
      ? { fmt: edit.style, blockIdx: edit.blockIdx }
      : { replacement: edit.replacement ?? '', blockIdx: edit.blockIdx };

export function materializeWordEdits(diff: AgentDiff, changeSet: unknown): WordEdit[] {
  const cs = changeSet as {
    edits?: Array<{
      id: string;
      target: string;
      op?: {
        kind?: string;
        text?: string;
        style?: DocFmt;
        props?: { imgAction?: 'remove' | 'resize'; width?: number };
        rows?: string[][];
        headerRows?: number;
        at?: 'before' | 'after' | 'end';
      };
    }>;
    anchors?: Record<string, { portable?: { quote?: { text?: string }; path?: number[] } }>;
  } | null;
  const byId = new Map((cs?.edits ?? []).map((edit) => [
    edit.id,
    {
      quote: cs?.anchors?.[edit.target]?.portable?.quote?.text ?? '',
      blockIdx: cs?.anchors?.[edit.target]?.portable?.path?.[0],
      op: edit.op,
    },
  ]));

  return diff.items.map((item) => {
    const record = byId.get(item.editId);
    const quote = record?.quote ?? item.ref;
    const blockIdx = record?.blockIdx;
    const base = {
      editId: item.editId,
      domId: `${diff.changeSetId}::${item.editId}`,
      quote,
      ...(blockIdx != null ? { blockIdx } : {}),
    };
    if (record?.op?.kind === 'insertTable' && record.op.rows?.length) {
      return {
        ...base,
        table: {
          rows: record.op.rows,
          headerRows: record.op.headerRows ?? 0,
          at: record.op.at ?? 'end',
        },
      };
    }
    if (record?.op?.kind === 'deleteRange') return { ...base, remove: true };
    if (record?.op?.kind === 'setObjectProps' && record.op.props?.imgAction) {
      return {
        ...base,
        img: {
          action: record.op.props.imgAction,
          ...(record.op.props.width != null ? { width: record.op.props.width } : {}),
        },
      };
    }
    if (record?.op?.kind === 'setStyle') return { ...base, style: record.op.style ?? {} };
    return { ...base, replacement: record?.op?.text ?? (item.after ?? '') };
  });
}

export function materializeGridOps(diff: AgentDiff): GridOp[] {
  return diff.items
    .filter((item) => item.ref && !isGridStructureKind(item.kind ?? ''))
    .map((item) => {
      const style = item.style;
      if (style || item.kind === 'setStyle' || item.kind === 'setNumberFormat') {
        const align = style?.align === 'left' || style?.align === 'center' || style?.align === 'right'
          ? style.align
          : undefined;
        return {
          a1: item.ref,
          ...(style?.numberFormat ? { numFmt: style.numberFormat } : {}),
          ...(style?.bgColor ? { bg: style.bgColor } : {}),
          ...(style?.color ? { color: style.color } : {}),
          ...(style?.bold ? { bold: true } : {}),
          ...(align ? { align } : {}),
          note: item.label ?? item.badge,
          editId: item.editId,
        };
      }
      return {
        a1: item.ref,
        ...(item.after != null ? { value: item.after } : {}),
        note: item.label ?? item.badge,
        editId: item.editId,
      };
    });
}

type DrawioChangeSet = {
  edits?: Array<{ id: string; op?: { kind?: string; payload?: unknown } }>;
} | null;

export function countAddedBoardObjects(changeSet: unknown): number {
  const cs = changeSet as DrawioChangeSet;
  return (cs?.edits ?? []).filter((edit) => edit.op?.kind === 'addObject').length;
}

export function materializeAddedBoardObjects(
  changeSet: unknown,
  options: {
    sequence: number;
    getObject: (id: string) => BoardObject | null;
  },
): AddedBoardObjects {
  const cs = changeSet as DrawioChangeSet;
  const idMap = new Map<string, string>();
  const boardId = (original?: string): string => {
    const key = original ?? `?${idMap.size}`;
    let value = idMap.get(key);
    if (!value) {
      value = original && !options.getObject(original)
        ? original
        : `${original ?? 'g'}_${options.sequence}_${idMap.size + 1}`;
      idMap.set(key, value);
    }
    return value;
  };
  const referenceId = (original?: string): string => original ? (idMap.get(original) ?? original) : boardId(original);
  const nodes: BNode[] = [];
  const edges: BEdge[] = [];
  const byEdit: Record<string, string> = {};
  const objs: Array<BoardObject & { editId: string }> = [];
  const nodesByOriginalId = new Map<string, BNode>();
  let stackY = 60;

  for (const edit of cs?.edits ?? []) {
    if (edit.op?.kind !== 'addObject') continue;
    const payload = (edit.op.payload ?? {}) as {
      id?: string;
      value?: string;
      style?: string;
      edge?: boolean;
      source?: string;
      target?: string;
      parent?: string;
      geometry?: { x?: number; y?: number; width?: number; height?: number };
    };
    if (payload.edge || (payload.source && payload.target)) {
      const id = boardId(payload.id ?? `e_${edit.id}`);
      const color = /strokeColor=([^;]+)/.exec(payload.style ?? '')?.[1];
      const edge: BEdge = {
        id,
        from: referenceId(payload.source),
        to: referenceId(payload.target),
        arrow: /endArrow=none/.test(payload.style ?? '') ? 'none' : 'classic',
        style: 'ortho',
        ...(/dashed=1/.test(payload.style ?? '') ? { dash: true } : {}),
        ...(color ? { color } : {}),
      };
      edges.push(edge);
      byEdit[edit.id] = id;
      objs.push({ editId: edit.id, edge });
      continue;
    }

    const id = boardId(payload.id ?? `n_${edit.id}`);
    const geometry = payload.geometry ?? {};
    const width = geometry.width ?? 160;
    const height = geometry.height ?? 48;
    let x = geometry.x ?? 60;
    let y = geometry.y ?? stackY;
    if (payload.parent && payload.parent !== '1') {
      const parent = nodesByOriginalId.get(payload.parent) ?? options.getObject(payload.parent)?.node;
      if (parent) {
        x += parent.x;
        y += parent.y;
      }
    }
    stackY = Math.max(stackY, y) + height + 40;
    const parsedStyle = parseDrawioStyle(payload.style);
    const shape = styleToKind(payload.style);
    const node: BNode = {
      id,
      x: snap(x),
      y: snap(y),
      w: width,
      h: height,
      inner: innerForStyle(payload.style),
      label: cleanLabel(payload.value),
      kind: parsedStyle.text ? 'text' : 'agent',
      ...(payload.style ? { style: payload.style } : {}),
      ...(shape ? { shape } : {}),
      ...parsedStyle,
    };
    nodes.push(node);
    byEdit[edit.id] = id;
    objs.push({ editId: edit.id, node });
    if (payload.id) nodesByOriginalId.set(payload.id, node);
  }

  return { nodes, edges, byEdit, objs };
}
