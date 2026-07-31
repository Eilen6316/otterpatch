import { snap, type BEdge, type BNode } from './drawio-geometry.js';
import { styleToKind } from './shape-engine.js';

export interface ParsedDrawioStyle {
  fill?: string;
  stroke?: string;
  fontColor?: string;
  fontSize?: number;
  bold?: boolean;
  text?: boolean;
  vTop?: boolean;
  wrap?: boolean;
}

export interface RawDrawioOp {
  op?: string;
  cellId?: string;
  value?: string;
  style?: string;
  edge?: boolean;
  source?: string;
  target?: string;
  parent?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export const cleanLabel = (value: unknown): string => String(value ?? '')
  .replace(/<br\s*\/?\s*>/gi, ' · ')
  .replace(/<[^>]+>/g, '')
  .trim();

export function innerForStyle(style?: string): string {
  const normalized = (style ?? '').toLowerCase();
  if (normalized.includes('ellipse')) return '<ellipse cx="20" cy="15" rx="16" ry="11"/>';
  if (normalized.includes('rhombus')) return '<polygon points="20,3 37,15 20,27 3,15"/>';
  if (normalized.includes('hexagon')) return '<polygon points="11,5 29,5 37,15 29,25 11,25 3,15"/>';
  if (normalized.includes('cylinder')) return '<ellipse cx="20" cy="7" rx="13" ry="3.5"/><line x1="7" y1="7" x2="7" y2="23"/><line x1="33" y1="7" x2="33" y2="23"/><path d="M7 23 A13 3.5 0 0 0 33 23"/>';
  if (normalized.includes('parallelogram')) return '<polygon points="9,5 37,5 31,25 3,25"/>';
  if (normalized.includes('trapezoid')) return '<polygon points="10,5 30,5 37,25 3,25"/>';
  if (normalized.includes('cloud')) return '<path d="M11 23 Q4 23 5 17 Q5 12 11 12 Q13 5 20 7 Q27 4 29 11 Q36 11 35 17 Q36 23 29 23 Z"/>';
  if (normalized.includes('document')) return '<path d="M5 5 H35 V21 C31 26 27 17 23 21 C19 25 15 17 11 21 C9 23 7 23 5 21 Z"/>';
  if (normalized.includes('note') || normalized.includes('card')) return '<path d="M5 5 H29 L37 13 V25 H5 Z"/><path d="M29 5 V13 H37" fill="none"/>';
  if (normalized.includes('callout')) return '<path d="M5 5 H37 V19 H17 L10 26 V19 H5 Z"/>';
  if (normalized.includes('triangle')) return '<polygon points="20,4 37,26 3,26"/>';
  if (normalized.includes('actor')) return '<circle cx="20" cy="7" r="4" fill="none"/><path d="M20 11 V19 M12 14 H28 M20 19 L13 27 M20 19 L27 27" fill="none"/>';
  if (normalized.includes('star')) return '<polygon points="20,3 24,12 34,12 26,18 29,27 20,21 11,27 14,18 6,12 16,12"/>';
  if (normalized.includes('rounded=1') || normalized.includes('rounded')) return '<rect x="4" y="5" width="32" height="20" rx="4" ry="4"/>';
  return '<rect x="4" y="5" width="32" height="20"/>';
}

export function parseDrawioStyle(style?: string): ParsedDrawioStyle {
  const source = style ?? '';
  const get = (key: string): string | undefined => new RegExp(key + '=([^;]+)').exec(source)?.[1]?.trim();
  const fill = get('fillColor');
  const stroke = get('strokeColor');
  const fontColor = get('fontColor');
  const fontSize = get('fontSize');
  const fontStyle = get('fontStyle');
  const text = /(?:^|;)\s*text(?:;|$)/.test(source) || source.includes('text;html');
  const vTop = /verticalAlign=top/.test(source) || /container=1/.test(source) || /(?:^|;)\s*(?:swimlane|group)(?:;|$|\b)/.test(source);
  const wrap = /whitespace=wrap/i.test(source);
  return {
    ...(wrap ? { wrap: true } : {}),
    ...(fill && fill !== 'none' ? { fill } : {}),
    ...(stroke && stroke !== 'none' ? { stroke } : {}),
    ...(fontColor ? { fontColor } : {}),
    ...(fontSize && Number.isFinite(parseFloat(fontSize)) ? { fontSize: Math.round(parseFloat(fontSize)) } : {}),
    ...(fontStyle && (parseInt(fontStyle, 10) & 1) ? { bold: true } : {}),
    ...(text ? { text: true } : {}),
    ...(vTop ? { vTop: true } : {}),
  };
}

export function extractDrawioOps(buffer: string): RawDrawioOp[] {
  const marker = /"ops"\s*:\s*\[/.exec(buffer);
  if (!marker) return [];
  let cursor = marker.index + marker[0].length;
  const operations: RawDrawioOp[] = [];
  while (cursor < buffer.length) {
    while (cursor < buffer.length && /[\s,]/.test(buffer[cursor]!)) cursor++;
    if (cursor >= buffer.length || buffer[cursor] !== '{') break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = cursor;
    let closed = false;
    for (; end < buffer.length; end++) {
      const character = buffer[end]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (character === '{') depth++;
      else if (character === '}') {
        depth--;
        if (depth === 0) {
          end++;
          closed = true;
          break;
        }
      }
    }
    if (!closed) break;
    try {
      operations.push(JSON.parse(buffer.slice(cursor, end)) as RawDrawioOp);
    } catch {
      break;
    }
    cursor = end;
  }
  return operations;
}

export function makeRawBoardConv(
  sequence: number,
  taken?: (id: string) => boolean,
): (op: RawDrawioOp, index: number) => { editId: string; boardId: string; node?: BNode; edge?: BEdge } | null {
  const idMap = new Map<string, string>();
  const boardId = (original?: string): string => {
    const key = original ?? ('?' + idMap.size);
    let id = idMap.get(key);
    if (!id) {
      id = original && !taken?.(original) ? original : `${original ?? 'g'}_${sequence}_${idMap.size + 1}`;
      idMap.set(key, id);
    }
    return id;
  };
  const referenceId = (original?: string): string => (original ? idMap.get(original) ?? original : boardId(original));
  const made = new Map<string, BNode>();
  let stackY = 60;

  return (op, index) => {
    if (op.op !== 'add') return null;
    if (op.edge || (op.source && op.target)) {
      const id = boardId(op.cellId ?? 'e_' + index);
      const strokeColor = /strokeColor=([^;]+)/.exec(op.style ?? '')?.[1];
      return {
        editId: 'e' + index,
        boardId: id,
        edge: {
          id,
          from: referenceId(op.source),
          to: referenceId(op.target),
          arrow: /endArrow=none/.test(op.style ?? '') ? 'none' : 'classic',
          style: 'ortho',
          ...(/dashed=1/.test(op.style ?? '') ? { dash: true } : {}),
          ...(strokeColor ? { color: strokeColor } : {}),
        },
      };
    }

    const id = boardId(op.cellId ?? 'n_' + index);
    const width = op.width ?? 160;
    const height = op.height ?? 48;
    let x = op.x ?? 60;
    let y = op.y ?? stackY;
    if (op.parent && op.parent !== '1') {
      const parent = made.get(op.parent);
      if (parent) {
        x += parent.x;
        y += parent.y;
      }
    }
    stackY = Math.max(stackY, y) + height + 40;
    const parsedStyle = parseDrawioStyle(op.style);
    const shape = styleToKind(op.style);
    const node: BNode = {
      id,
      x: snap(x),
      y: snap(y),
      w: width,
      h: height,
      inner: innerForStyle(op.style),
      label: cleanLabel(op.value),
      kind: parsedStyle.text ? 'text' : 'agent',
      ...(op.style ? { style: op.style } : {}),
      ...(shape ? { shape } : {}),
      ...parsedStyle,
    };
    if (op.cellId) made.set(op.cellId, node);
    return { editId: 'e' + index, boardId: id, node };
  };
}
