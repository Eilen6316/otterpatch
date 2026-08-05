import { SHAPE_DEFS } from './shape-engine.js';
import type { BEdge, BNode, XY } from './drawio-geometry.js';

export const BOARD_STORAGE_KEY = 'oa.board';

export interface BoardPage {
  name: string;
  nodes: BNode[];
  edges: BEdge[];
}

export interface BoardStore {
  pages: BoardPage[];
  cur: number;
}

export interface BoardSel {
  count: number;
  chip: string;
  context: string;
  board: {
    nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>;
    edges: Array<{ id: string; source: string; target: string }>;
  };
}

type BoardPageData = { nodes: BNode[]; edges: BEdge[] };
type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

const FALLBACK_INNER = '<rect x="4" y="5" width="32" height="20"/>';
const FORBIDDEN_SVG_INNER = /<\s*(script|foreignObject|iframe|object|embed|image|use|a|audio|video|canvas|style|animate|set)\b|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=|javascript:/i;
const ARROWS = new Set(['classic', 'open', 'diamond', 'circle', 'none']);
const EDGE_STYLES = new Set(['ortho', 'straight', 'curve']);
const KNOWN_SHAPES = new Set(SHAPE_DEFS.map((shape) => shape.kind));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const optionalBoolean = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
const optionalNumber = (value: unknown): number | undefined => isFiniteNumber(value) ? value : undefined;

export function safeBoardSvgInner(inner: unknown): string {
  if (typeof inner !== 'string' || !inner) return '';
  return FORBIDDEN_SVG_INNER.test(inner) ? FALLBACK_INNER : inner;
}

export function sanitizeBoardNode(value: unknown): BNode | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id || !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.w) || !isFiniteNumber(value.h) || value.w <= 0 || value.h <= 0) return null;
  const shape = typeof value.shape === 'string' && KNOWN_SHAPES.has(value.shape) ? value.shape : undefined;
  return {
    id,
    x: value.x,
    y: value.y,
    w: value.w,
    h: value.h,
    inner: safeBoardSvgInner(value.inner),
    label: typeof value.label === 'string' ? value.label : '',
    ...(optionalString(value.kind) !== undefined ? { kind: optionalString(value.kind) } : {}),
    ...(optionalNumber(value.rot) !== undefined ? { rot: optionalNumber(value.rot) } : {}),
    ...(optionalString(value.fill) !== undefined ? { fill: optionalString(value.fill) } : {}),
    ...(optionalString(value.stroke) !== undefined ? { stroke: optionalString(value.stroke) } : {}),
    ...(optionalString(value.fontColor) !== undefined ? { fontColor: optionalString(value.fontColor) } : {}),
    ...(optionalNumber(value.fontSize) !== undefined ? { fontSize: optionalNumber(value.fontSize) } : {}),
    ...(optionalBoolean(value.bold) !== undefined ? { bold: optionalBoolean(value.bold) } : {}),
    ...(optionalBoolean(value.text) !== undefined ? { text: optionalBoolean(value.text) } : {}),
    ...(optionalBoolean(value.vTop) !== undefined ? { vTop: optionalBoolean(value.vTop) } : {}),
    ...(optionalBoolean(value.wrap) !== undefined ? { wrap: optionalBoolean(value.wrap) } : {}),
    ...(optionalString(value.style) !== undefined ? { style: optionalString(value.style) } : {}),
    ...(shape ? { shape } : {}),
  };
}

function sanitizePoints(value: unknown): XY[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value.flatMap((point) => isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y)
    ? [{ x: point.x, y: point.y }]
    : []);
  return points.length ? points : undefined;
}

export function sanitizeBoardEdge(value: unknown): BEdge | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const from = typeof value.from === 'string' ? value.from.trim() : '';
  const to = typeof value.to === 'string' ? value.to.trim() : '';
  if (!id || !from || !to) return null;
  const arrow = typeof value.arrow === 'string' && ARROWS.has(value.arrow) ? value.arrow as BEdge['arrow'] : undefined;
  const style = typeof value.style === 'string' && EDGE_STYLES.has(value.style) ? value.style as BEdge['style'] : undefined;
  const points = sanitizePoints(value.points);
  const width = optionalNumber(value.width);
  return {
    id,
    from,
    to,
    ...(arrow ? { arrow } : {}),
    ...(style ? { style } : {}),
    ...(points ? { points } : {}),
    ...(optionalString(value.color) !== undefined ? { color: optionalString(value.color) } : {}),
    ...(width !== undefined && width > 0 ? { width } : {}),
    ...(optionalBoolean(value.dash) !== undefined ? { dash: optionalBoolean(value.dash) } : {}),
    ...(optionalString(value.label) !== undefined ? { label: optionalString(value.label) } : {}),
  };
}

export function sanitizeBoardPage(value: unknown, fallbackName = 'Page-1'): BoardPage {
  const record = isRecord(value) ? value : {};
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : fallbackName;
  const seenNodes = new Set<string>();
  const nodes = (Array.isArray(record.nodes) ? record.nodes : []).flatMap((item) => {
    const node = sanitizeBoardNode(item);
    if (!node || seenNodes.has(node.id)) return [];
    seenNodes.add(node.id);
    return [node];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenEdges = new Set<string>();
  const edges = (Array.isArray(record.edges) ? record.edges : []).flatMap((item) => {
    const edge = sanitizeBoardEdge(item);
    if (!edge || seenEdges.has(edge.id) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return [];
    seenEdges.add(edge.id);
    return [edge];
  });
  return { name, nodes, edges };
}

const emptyBoardStore = (): BoardStore => ({ pages: [{ name: 'Page-1', nodes: [], edges: [] }], cur: 0 });

export function parseBoardStore(raw: string | null): BoardStore {
  if (!raw) return emptyBoardStore();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return emptyBoardStore();
    if (Array.isArray(value.pages) && value.pages.length) {
      const pages = value.pages.map((page, index) => sanitizeBoardPage(page, `Page-${index + 1}`));
      const requested = isFiniteNumber(value.cur) ? Math.trunc(value.cur) : 0;
      return { pages, cur: Math.min(Math.max(requested, 0), pages.length - 1) };
    }
    if ((Array.isArray(value.nodes) && value.nodes.length) || (Array.isArray(value.edges) && value.edges.length)) {
      return { pages: [sanitizeBoardPage({ name: 'Page-1', nodes: value.nodes, edges: value.edges })], cur: 0 };
    }
  } catch {
    return emptyBoardStore();
  }
  return emptyBoardStore();
}

export function loadBoardStore(storage: StorageReader): BoardStore {
  try {
    return parseBoardStore(storage.getItem(BOARD_STORAGE_KEY));
  } catch {
    return emptyBoardStore();
  }
}

export function saveBoardStore(storage: StorageWriter, pageNames: string[], pages: BoardPageData[], cur: number): void {
  const storePages = (pageNames.length ? pageNames : ['Page-1']).map((name, index) => sanitizeBoardPage({
    name,
    ...(pages[index] ?? { nodes: [], edges: [] }),
  }, `Page-${index + 1}`));
  const store: BoardStore = { pages: storePages, cur: Math.min(Math.max(Math.trunc(cur) || 0, 0), storePages.length - 1) };
  try {
    storage.setItem(BOARD_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Persistence is best-effort when storage is unavailable or full.
  }
}

export function buildBoardSelection(nodes: BNode[], edges: BEdge[], selectedNodeIds: ReadonlySet<string>, selectedEdgeId: string | null): BoardSel | null {
  if (nodes.length === 0 && edges.length === 0) return null;
  const nodeName = (node: BNode): string => node.label || node.kind || '形状';
  const selectedNodes = nodes.filter((node) => selectedNodeIds.has(node.id));
  const selectedEdge = selectedEdgeId ? edges.find((edge) => edge.id === selectedEdgeId) : undefined;
  const context = [`[流程图] ${nodes.length} 个节点、${edges.length} 条连线。改/删/移动现有节点时,update/delete/move 的 cellId 必须用下面给出的真实 id。`];
  if (nodes.length) context.push('节点(id=文字): ' + nodes.map((node) => `${node.id}=${nodeName(node)}`).join('、'));
  if (edges.length) context.push('连接关系(按 id): ' + edges.map((edge) => `${edge.from}→${edge.to}`).join(';'));
  if (selectedNodes.length) {
    context.push('当前选中节点 id: ' + selectedNodes.map((node) => node.id).join('、') + '(即 ' + selectedNodes.map((node) => nodeName(node)).join('、') + '),用户多半是想改这些。');
  } else if (selectedEdge) {
    context.push(`当前选中连线: ${selectedEdge.from}→${selectedEdge.to}`);
  }
  const chip = selectedNodes.length
    ? `画板选中 ${selectedNodes.length} 个节点: ${selectedNodes.map((node) => nodeName(node)).join('、')}`
    : selectedEdge
      ? '选中 1 条连线'
      : `流程图 ${nodes.length} 节点 · ${edges.length} 连线`;
  return {
    count: selectedNodes.length,
    chip,
    context: context.join('\n'),
    board: {
      nodes: nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.w, height: node.h })),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.from, target: edge.to })),
    },
  };
}
