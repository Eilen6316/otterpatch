export interface XY {
  x: number;
  y: number;
}

export interface BNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  inner: string;
  label: string;
  kind?: string;
  rot?: number;
  fill?: string;
  stroke?: string;
  fontColor?: string;
  fontSize?: number;
  bold?: boolean;
  text?: boolean;
  vTop?: boolean;
  wrap?: boolean;
  style?: string;
  shape?: string;
}

export type ArrowKind = 'classic' | 'open' | 'diamond' | 'circle' | 'none';
export type EdgeStyle = 'ortho' | 'straight' | 'curve';

export interface BEdge {
  id: string;
  from: string;
  to: string;
  arrow?: ArrowKind;
  style?: EdgeStyle;
  points?: XY[];
  color?: string;
  width?: number;
  dash?: boolean;
  label?: string;
}

export const GRID = 10;

export const snap = (value: number): number => Math.round(value / GRID) * GRID;

export function perim(node: BNode, targetX: number, targetY: number): XY {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = Math.abs(dx) > 0.001 ? node.w / 2 / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 0.001 ? node.h / 2 / Math.abs(dy) : Infinity;
  const scale = Math.min(sx, sy);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function straightRoute(a: BNode, b: BNode): XY[] {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return [perim(a, bc.x, bc.y), perim(b, ac.x, ac.y)];
}

export function ortho(a: BNode, b: BNode): XY[] {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const right = dx >= 0;
    const overlapStart = Math.max(a.y, b.y);
    const overlapEnd = Math.min(a.y + a.h, b.y + b.h);
    const sharedY = overlapEnd > overlapStart + 2
      ? (overlapStart + overlapEnd) / 2
      : Math.abs(acy - bcy) <= 8 ? (acy + bcy) / 2 : null;
    const p1 = { x: right ? a.x + a.w : a.x, y: sharedY ?? acy };
    const p2 = { x: right ? b.x : b.x + b.w, y: sharedY ?? bcy };
    if (Math.abs(p1.y - p2.y) < 0.5) return [{ x: p1.x, y: p1.y }, { x: p2.x, y: p1.y }];
    const middleX = (p1.x + p2.x) / 2;
    return [p1, { x: middleX, y: p1.y }, { x: middleX, y: p2.y }, p2];
  }

  const down = dy >= 0;
  const overlapStart = Math.max(a.x, b.x);
  const overlapEnd = Math.min(a.x + a.w, b.x + b.w);
  const sharedX = overlapEnd > overlapStart + 2
    ? (overlapStart + overlapEnd) / 2
    : Math.abs(acx - bcx) <= 8 ? (acx + bcx) / 2 : null;
  const p1 = { x: sharedX ?? acx, y: down ? a.y + a.h : a.y };
  const p2 = { x: sharedX ?? bcx, y: down ? b.y : b.y + b.h };
  if (Math.abs(p1.x - p2.x) < 0.5) return [{ x: p1.x, y: p1.y }, { x: p1.x, y: p2.y }];
  const middleY = (p1.y + p2.y) / 2;
  return [p1, { x: p1.x, y: middleY }, { x: p2.x, y: middleY }, p2];
}

export function routeWaypoints(a: BNode, b: BNode, points: XY[]): XY[] {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const all = [perim(a, first.x, first.y), ...points, perim(b, last.x, last.y)];
  const routed: XY[] = [all[0]!];
  for (let index = 1; index < all.length; index++) {
    const current = routed[routed.length - 1]!;
    const next = all[index]!;
    if (Math.abs(current.x - next.x) > 0.5 && Math.abs(current.y - next.y) > 0.5) {
      routed.push({ x: next.x, y: current.y });
    }
    routed.push(next);
  }
  return routed;
}

export function controlPoints(a: BNode, b: BNode, points: XY[]): XY[] {
  if (points.length) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    return [perim(a, first.x, first.y), ...points, perim(b, last.x, last.y)];
  }
  return straightRoute(a, b);
}

export function edgePts(a: BNode, b: BNode, style?: EdgeStyle, points?: XY[]): XY[] {
  if (points?.length) return routeWaypoints(a, b, points);
  return style === 'straight' ? straightRoute(a, b) : ortho(a, b);
}

export function smoothPath(points: XY[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    const [a, b] = [points[0]!, points[1]!];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const curve = Math.min(24, length * 0.15);
    const nx = -(b.y - a.y) / length;
    const ny = (b.x - a.x) / length;
    return `M ${a.x} ${a.y} Q ${mx + nx * curve} ${my + ny * curve} ${b.x} ${b.y}`;
  }

  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return path;
}

function segmentCrossesNode(a: BNode, b: BNode, node: BNode): boolean {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  for (let offset = 0.08; offset < 0.95; offset += 0.04) {
    const x = ax + (bx - ax) * offset;
    const y = ay + (by - ay) * offset;
    if (x > node.x && x < node.x + node.w && y > node.y && y < node.y + node.h) return true;
  }
  return false;
}

export function avoidRoute(
  a: BNode,
  b: BNode,
  edge: { id: string; style?: EdgeStyle; points?: XY[] },
  nodes: BNode[],
): XY[] {
  if (!edge.points?.length) {
    const blockers = nodes.filter((node) =>
      node.id !== a.id
      && node.id !== b.id
      && node.w >= 40
      && node.h >= 40
      && node.w * node.h <= 60000
      && segmentCrossesNode(a, b, node));
    if (blockers.length) {
      const lane = 26 + (Math.abs([...edge.id].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 3) * 14;
      const horizontal = Math.abs((b.x + b.w / 2) - (a.x + a.w / 2)) >= Math.abs((b.y + b.h / 2) - (a.y + a.h / 2));
      const waypoint: XY = horizontal
        ? { x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, y: Math.min(a.y, b.y, ...blockers.map((node) => node.y)) - lane }
        : { x: Math.max(a.x + a.w, b.x + b.w, ...blockers.map((node) => node.x + node.w)) + lane, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 };
      return routeWaypoints(a, b, [waypoint]);
    }
  }
  return edgePts(a, b, edge.style, edge.points);
}

const direction = (from: XY, to: XY): XY => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
};

export function roundedPath(points: XY[], radius = 8): string {
  if (points.length < 2) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index]!;
    const previous = points[index - 1]!;
    const next = points[index + 1]!;
    const roundedRadius = Math.min(radius, Math.hypot(previous.x - point.x, previous.y - point.y) / 2, Math.hypot(next.x - point.x, next.y - point.y) / 2);
    const before = direction(point, previous);
    const after = direction(point, next);
    const entry = { x: point.x + before.x * roundedRadius, y: point.y + before.y * roundedRadius };
    const exit = { x: point.x + after.x * roundedRadius, y: point.y + after.y * roundedRadius };
    path += ` L ${entry.x} ${entry.y} Q ${point.x} ${point.y} ${exit.x} ${exit.y}`;
  }
  const last = points[points.length - 1]!;
  return `${path} L ${last.x} ${last.y}`;
}

export function bandRect(band: { x0: number; y0: number; x1: number; y1: number }): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(band.x0, band.x1),
    y: Math.min(band.y0, band.y1),
    w: Math.abs(band.x1 - band.x0),
    h: Math.abs(band.y1 - band.y0),
  };
}

export function intersects(rect: { x: number; y: number; w: number; h: number }, node: BNode): boolean {
  return !(node.x > rect.x + rect.w || node.x + node.w < rect.x || node.y > rect.y + rect.h || node.y + node.h < rect.y);
}

export function resizeNode(
  resize: { box: BNode; k: string; sx: number; sy: number },
  x: number,
  y: number,
  preserveAspect: boolean,
): BNode {
  const box = resize.box;
  const dx = x - resize.sx;
  const dy = y - resize.sy;
  let width = box.w + (resize.k.includes('e') ? dx : resize.k.includes('w') ? -dx : 0);
  let height = box.h + (resize.k.includes('s') ? dy : resize.k.includes('n') ? -dy : 0);
  width = Math.max(40, width);
  height = Math.max(30, height);

  if (preserveAspect) {
    const aspect = box.w / box.h || 1;
    if (resize.k.length === 2) {
      if (Math.abs(width - box.w) >= Math.abs(height - box.h)) height = width / aspect;
      else width = height * aspect;
    } else if (resize.k === 'n' || resize.k === 's') {
      width = height * aspect;
    } else {
      height = width / aspect;
    }
    width = Math.max(40, width);
    height = Math.max(30, height);
  }

  let nextX = box.x;
  let nextY = box.y;
  if (resize.k.includes('w')) nextX = box.x + box.w - width;
  if (resize.k.includes('n')) nextY = box.y + box.h - height;
  return { ...box, x: snap(nextX), y: snap(nextY), w: snap(width), h: snap(height) };
}
