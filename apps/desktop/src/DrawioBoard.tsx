/**
 * Drawio workspace: toolbar, shape palette, board state, selection, and edge editing.
 * Pure geometry and routing live in drawio-geometry.ts.
 */
/* eslint-disable */
// NOTE: imports appended below are the minimal set the moved block references.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useT } from './i18n.js';
import { shapeSvg, styleToKind, SHAPE_DEFS } from './shape-engine.js';
import {
  bandRect,
  GRID,
  intersects,
  resizeNode,
  snap,
} from './drawio-geometry.js';
import type { BEdge, BNode, XY } from './drawio-geometry.js';
import { cleanLabel, parseDrawioStyle } from './drawio-model.js';
import { DrawioEdgeHandles, DrawioEdgeLayer, DrawioEdgeToolbar } from './DrawioEdges.js';

export { snap } from './drawio-geometry.js';
export type { BEdge, BNode } from './drawio-geometry.js';
export { cleanLabel, extractDrawioOps, innerForStyle, makeRawBoardConv, parseDrawioStyle } from './drawio-model.js';
export type { RawDrawioOp } from './drawio-model.js';
export { DrawioPalette, DrawioToolbar } from './DrawioChrome.js';
export type { OnOpen } from './DrawioChrome.js';

export interface BoardSel {
  count: number;
  chip: string;
  context: string;
  board: {
    nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>;
    edges: Array<{ id: string; source: string; target: string }>;
  };
}
/** App ↔ DrawioBoard 命令式句柄:把 Agent 提案的节点/连线落到画板、移除、或高亮某个对象供审阅。 */
export interface BoardHandle {
  addObjects(nodes: BNode[], edges: BEdge[]): void;
  removeObjects(ids: string[]): void;
  updateObject(id: string, patch: { value?: string; style?: string }): void;
  moveObject(id: string, box: { x?: number; y?: number; w?: number; h?: number }): void;
  highlight(id: string): void;
  /** 读某对象当前状态(改前快照用)——mutation 类改动"拒绝/撤销"要按它还原,不能删对象。 */
  getObject(id: string): { node?: BNode; edge?: BEdge } | null;
  /** 整板替换(导入 .drawio):压撤销栈,可 Ctrl+Z 回到导入前。 */
  loadBoard(nodes: BNode[], edges: BEdge[]): void;
  /** 整板读取(导出 .drawio)。 */
  getBoard(): { nodes: BNode[]; edges: BEdge[] };
  /** 多页导入:整簿替换(页名保留),激活第一页。 */
  loadPages(pages: Array<{ name: string; nodes: BNode[]; edges: BEdge[] }>): void;
  /** 按快照恢复/重放对象(存在则整体替换,被删则补回)。 */
  restoreObject(obj: { node?: BNode; edge?: BEdge }): void;
}
const HANDLES: { k: string; fx: number; fy: number }[] = [
  { k: 'nw', fx: 0, fy: 0 }, { k: 'n', fx: 0.5, fy: 0 }, { k: 'ne', fx: 1, fy: 0 },
  { k: 'e', fx: 1, fy: 0.5 }, { k: 'se', fx: 1, fy: 1 }, { k: 's', fx: 0.5, fy: 1 },
  { k: 'sw', fx: 0, fy: 1 }, { k: 'w', fx: 0, fy: 0.5 },
];
const PORTS: XY[] = [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];

/** 高度复刻 drawio 的交互画板:周界正交圆角连线、悬停连接点拖拽连线(绿色目标高亮)、8 缩放手柄、网格吸附、改名、删边删点、双击空白建节点。 */
const BOARD_KEY = 'oa.board';
export interface BoardPage { name: string; nodes: BNode[]; edges: BEdge[] }

const FALLBACK_INNER = '<rect x="4" y="5" width="32" height="20"/>';
const FORBIDDEN_SVG_INNER = /<\s*(script|foreignObject|iframe|object|embed|image|use|a|audio|video|canvas|style|animate|set)\b|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=|javascript:/i;
const isKnownShape = (shape?: string): shape is string => !!shape && SHAPE_DEFS.some((s) => s.kind === shape);
const safeSvgInner = (inner: string | undefined): string => {
  if (!inner) return '';
  return FORBIDDEN_SVG_INNER.test(inner) ? FALLBACK_INNER : inner;
};
function sanitizeNode(n: BNode): BNode {
  const next: BNode = { ...n, inner: safeSvgInner(n.inner) };
  if (next.shape && !isKnownShape(next.shape)) delete next.shape;
  return next;
}
const sanitizePage = (p: BoardPage): BoardPage => ({ name: p.name, nodes: (p.nodes ?? []).map(sanitizeNode), edges: p.edges ?? [] });
/** 读持久化画板(多页;兼容旧单页 {nodes,edges} 格式迁移)。 */
function loadBoardStore(): { pages: BoardPage[]; cur: number } {
  try {
    const j = JSON.parse(localStorage.getItem(BOARD_KEY) ?? '{}') as { pages?: BoardPage[]; cur?: number; nodes?: BNode[]; edges?: BEdge[] };
    if (Array.isArray(j.pages) && j.pages.length) return { pages: j.pages.map(sanitizePage), cur: Math.min(Math.max(j.cur ?? 0, 0), j.pages.length - 1) };
    if (j.nodes?.length || j.edges?.length) return { pages: [sanitizePage({ name: 'Page-1', nodes: j.nodes ?? [], edges: j.edges ?? [] })], cur: 0 };
  } catch { /* 损坏则重建 */ }
  return { pages: [{ name: 'Page-1', nodes: [], edges: [] }], cur: 0 };
}
export const DrawioBoard = forwardRef<BoardHandle, { onBoardSel?: (s: BoardSel | null) => void }>(function DrawioBoard({ onBoardSel }, apiRef) {
  const t = useT();
  // 多页 + 持久化:nodes/edges = 当前页工作集,非活动页存 stash;整簿(含页名/当前页)落 localStorage
  const store0 = useRef(loadBoardStore()).current;
  const [nodes, setNodes] = useState<BNode[]>(store0.pages[store0.cur]?.nodes ?? []);
  const [edges, setEdges] = useState<BEdge[]>(store0.pages[store0.cur]?.edges ?? []);
  const [pageNames, setPageNames] = useState<string[]>(store0.pages.map((p) => p.name));
  const [curPage, setCurPage] = useState(store0.cur);
  const stashRef = useRef<Array<{ nodes: BNode[]; edges: BEdge[] }>>(store0.pages.map((p) => ({ nodes: p.nodes, edges: p.edges })));
  useEffect(() => {
    stashRef.current[curPage] = { nodes, edges };
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(BOARD_KEY, JSON.stringify({ pages: pageNames.map((name, i) => sanitizePage({ name, ...(stashRef.current[i] ?? { nodes: [], edges: [] }) })), cur: curPage })); } catch { /* 配额满忽略 */ }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, pageNames, curPage]);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hi, setHi] = useState<string | null>(null);
  const nodesRef = useRef<BNode[]>([]); nodesRef.current = nodes; // getObject 走 ref,句柄闭包不吃 state 陈旧值
  const edgesRef = useRef<BEdge[]>([]); edgesRef.current = edges;
  useImperativeHandle(apiRef, () => ({
    addObjects: (nn, ee) => {
      if (nn.length || ee.length) commit();
      if (nn.length) setNodes((ns) => [...ns, ...nn.map(sanitizeNode)]);
      if (ee.length) setEdges((es) => [...es, ...ee]);
      setSelIds(new Set(nn.map((n) => n.id)));
      setSelEdge(null);
    },
    removeObjects: (ids) => {
      const s = new Set(ids);
      setNodes((ns) => ns.filter((n) => !s.has(n.id)));
      setEdges((es) => es.filter((ed) => !s.has(ed.id) && !s.has(ed.from) && !s.has(ed.to)));
    },
    updateObject: (id, patch) => {
      commit();
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...(patch.value != null ? { label: cleanLabel(patch.value) } : {}), ...(patch.style ? { ...parseDrawioStyle(patch.style), style: patch.style, ...(styleToKind(patch.style) ? { shape: styleToKind(patch.style)! } : {}) } : {}) } : n)));
    },
    moveObject: (id, box) => {
      commit();
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...(box.x != null ? { x: snap(box.x) } : {}), ...(box.y != null ? { y: snap(box.y) } : {}), ...(box.w != null ? { w: box.w } : {}), ...(box.h != null ? { h: box.h } : {}) } : n)));
    },
    highlight: (id) => { setHi(id); setSelIds(new Set([id])); setSelEdge(null); },
    loadBoard: (nn, ee) => { commit(); setNodes(nn.map(sanitizeNode)); setEdges(ee); setSelIds(new Set()); setSelEdge(null); },
    loadPages: (pgs) => {
      const pages = (pgs.length ? pgs : [{ name: 'Page-1', nodes: [], edges: [] }]).map(sanitizePage);
      stashRef.current = pages.map((x) => ({ nodes: x.nodes, edges: x.edges }));
      setPageNames(pages.map((x) => x.name));
      setCurPage(0);
      setNodes(pages[0]!.nodes); setEdges(pages[0]!.edges);
      setSelIds(new Set()); setSelEdge(null);
      past.current = []; future.current = []; // 换簿,撤销栈清零
    },
    getBoard: () => ({ nodes: nodesRef.current.map((n) => ({ ...n })), edges: edgesRef.current.map((e) => ({ ...e })) }),
    getObject: (id) => {
      const n = nodesRef.current.find((x) => x.id === id);
      if (n) return { node: { ...n } };
      const e = edgesRef.current.find((x) => x.id === id);
      return e ? { edge: { ...e } } : null;
    },
    restoreObject: (obj) => {
      if (obj.node) { const nd = sanitizeNode(obj.node); setNodes((ns) => (ns.some((n) => n.id === nd.id) ? ns.map((n) => (n.id === nd.id ? nd : n)) : [...ns, nd])); }
      if (obj.edge) { const ed = obj.edge; setEdges((es) => (es.some((e) => e.id === ed.id) ? es.map((e) => (e.id === ed.id ? ed : e)) : [...es, ed])); }
    },
  }));
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ sx: number; sy: number; origins: Record<string, XY> } | null>(null);
  const [resize, setResize] = useState<{ id: string; k: string; box: BNode; sx: number; sy: number } | null>(null);
  const [conn, setConn] = useState<{ from: string; x: number; y: number; tgt: string | null } | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] } | null>(null);
  const [arrow, setArrow] = useState<{ from: string; dir: 'up' | 'right' | 'down' | 'left'; sx: number; sy: number } | null>(null);
  const [rotate, setRotate] = useState<{ id: string; cx: number; cy: number } | null>(null);
  const [panDrag, setPanDrag] = useState<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [wpDrag, setWpDrag] = useState<{ edgeId: string; index: number } | null>(null);
  const [epDrag, setEpDrag] = useState<{ edgeId: string; end: 'from' | 'to'; tgt: string | null } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const spaceRef = useRef(false);
  const clipRef = useRef<BNode[]>([]);
  const past = useRef<{ nodes: BNode[]; edges: BEdge[] }[]>([]);
  const future = useRef<{ nodes: BNode[]; edges: BEdge[] }[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement | null>(null);
  const idRef = useRef(0);
  const freshId = (prefix: string): string => { let id = prefix + ++idRef.current; while (nodesRef.current.some((n) => n.id === id) || edgesRef.current.some((e) => e.id === id)) id = prefix + ++idRef.current; return id; }; // 持久化恢复后 idRef 归零,顺移到未占用 id
  const cb = useRef(onBoardSel);
  cb.current = onBoardSel;

  // 选区变化 → 上抛给 App(Agent 感知:选中/框选的节点与连线)
  // 画板内容 → 上抛给 App。核心:不只是选中,还把【完整拓扑(每个节点 + 连接关系)】给 Agent,
  // 让 Agent 理解整张流程图的结构,从而能据此驱动修改。
  useEffect(() => {
    if (nodes.length === 0 && edges.length === 0) {
      cb.current?.(null);
      return;
    }
    const nm = (n: BNode): string => n.label || n.kind || '形状';
    const sn = nodes.filter((n) => selIds.has(n.id));
    // 关键:把【节点 id】明确给 Agent —— 改/删/移动现有节点时必须用这些 id(否则它会瞎猜 id,改不到)
    const ctx: string[] = [`[流程图] ${nodes.length} 个节点、${edges.length} 条连线。改/删/移动现有节点时,update/delete/move 的 cellId 必须用下面给出的真实 id。`];
    if (nodes.length) ctx.push('节点(id=文字): ' + nodes.map((n) => `${n.id}=${nm(n)}`).join('、'));
    if (edges.length) ctx.push('连接关系(按 id): ' + edges.map((e) => `${e.from}→${e.to}`).join(';'));
    if (sn.length) ctx.push('当前选中节点 id: ' + sn.map((n) => n.id).join('、') + '(即 ' + sn.map((n) => nm(n)).join('、') + '),用户多半是想改这些。');
    else if (selEdge) {
      const e = edges.find((x) => x.id === selEdge);
      if (e) ctx.push(`当前选中连线: ${e.from}→${e.to}`);
    }
    const chip = sn.length
      ? `画板选中 ${sn.length} 个节点: ${sn.map((n) => nm(n)).join('、')}`
      : selEdge
        ? '选中 1 条连线'
        : `流程图 ${nodes.length} 节点 · ${edges.length} 连线`;
    cb.current?.({
      count: sn.length,
      chip,
      context: ctx.join('\n'),
      board: {
        nodes: nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.w, height: node.h })),
        edges: edges.map((edge) => ({ id: edge.id, source: edge.from, target: edge.to })),
      },
    });
  }, [selIds, selEdge, nodes, edges]);

  // 屏幕坐标 → 画布坐标(扣除平移/缩放),所有节点/连线都用画布坐标
  const pt = (e: { clientX: number; clientY: number }): XY => {
    const r = ref.current?.getBoundingClientRect();
    return { x: (e.clientX - (r?.left ?? 0) - pan.x) / zoom, y: (e.clientY - (r?.top ?? 0) - pan.y) / zoom };
  };
  const nodeAt = (x: number, y: number, not?: string): BNode | undefined =>
    [...nodes].reverse().find((n) => n.id !== not && x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h);
  const switchPage = (i: number): void => {
    if (i === curPage || i < 0 || i >= pageNames.length) return;
    stashRef.current[curPage] = { nodes, edges }; // 现值入栈
    const tgt = stashRef.current[i] ?? { nodes: [], edges: [] };
    setNodes(tgt.nodes); setEdges(tgt.edges);
    setCurPage(i);
    setSelIds(new Set()); setSelEdge(null);
    past.current = []; future.current = []; // 撤销栈按页隔离:切页清空,避免跨页误撤
  };
  const addPage = (): void => {
    stashRef.current[curPage] = { nodes, edges };
    stashRef.current.push({ nodes: [], edges: [] });
    const name = 'Page-' + (pageNames.length + 1);
    setPageNames((ns) => [...ns, name]);
    setNodes([]); setEdges([]);
    setCurPage(pageNames.length);
    setSelIds(new Set()); setSelEdge(null);
    past.current = []; future.current = [];
  };
  const addNode = (x: number, y: number, inner: string, label: string, kind?: string, shape?: string): void => {
    commit();
    const id = freshId('n');
    setNodes((ns) => [...ns, { id, x: snap(x - 45), y: snap(y - 27), w: 90, h: 54, inner, label, ...(kind ? { kind } : {}), ...(shape ? { shape } : {}) }]);
    setSelIds(new Set([id]));
    setSelEdge(null);
  };
  // drawio 招牌:点方向箭头 → 克隆源节点放到该方向 60px 外并连上
  const cloneConnect = (fromId: string, dir: 'up' | 'right' | 'down' | 'left'): void => {
    const src = nodes.find((n) => n.id === fromId);
    if (!src) return;
    commit();
    const gap = 60;
    const off = dir === 'up' ? { dx: 0, dy: -(src.h + gap) } : dir === 'down' ? { dx: 0, dy: src.h + gap } : dir === 'left' ? { dx: -(src.w + gap), dy: 0 } : { dx: src.w + gap, dy: 0 };
    const id = freshId('n');
    setNodes((ns) => [...ns, { ...src, id, x: snap(src.x + off.dx), y: snap(src.y + off.dy) }]);
    setEdges((es) => [...es, { id: freshId('e'), from: fromId, to: id }]);
    setSelIds(new Set([id]));
  };
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('otterpatch/shape');
    if (!raw) return;
    let s: { shape?: unknown };
    try { s = JSON.parse(raw) as { shape?: unknown }; } catch { return; }
    const shape = typeof s.shape === 'string' ? SHAPE_DEFS.find((d) => d.kind === s.shape) : undefined;
    if (!shape) return;
    const { x, y } = pt(e);
    addNode(x, y, '', '', shape.name, shape.kind);
  };

  const onMove = (e: { clientX: number; clientY: number; shiftKey?: boolean }): void => {
    if (panDrag) {
      setPan({ x: panDrag.ox + (e.clientX - panDrag.sx), y: panDrag.oy + (e.clientY - panDrag.sy) });
      return;
    }
    if (!drag && !conn && !resize && !band && !arrow && !rotate && !wpDrag && !epDrag) return;
    const { x, y } = pt(e);
    if (wpDrag) {
      movedRef.current = true;
      setEdges((es) => es.map((ed) => (ed.id === wpDrag.edgeId && ed.points ? { ...ed, points: ed.points.map((p, i) => (i === wpDrag.index ? { x, y } : p)) } : ed)));
      return;
    }
    if (epDrag) {
      movedRef.current = true;
      const tg = nodeAt(x, y);
      setEpDrag((d) => (d ? { ...d, tgt: tg?.id ?? null } : d));
      return;
    }
    if (rotate) {
      movedRef.current = true;
      let deg = (Math.atan2(y - rotate.cy, x - rotate.cx) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(((deg % 360) + 360) % 360);
      setNodes((ns) => ns.map((n) => (n.id === rotate.id ? { ...n, rot: deg } : n)));
      return;
    }
    if (arrow) {
      if (Math.hypot(x - arrow.sx, y - arrow.sy) > 5 / zoom) {
        setConn({ from: arrow.from, x, y, tgt: nodeAt(x, y, arrow.from)?.id ?? null });
        setArrow(null);
      }
      return;
    }
    if (drag) {
      movedRef.current = true;
      let dx = x - drag.sx;
      let dy = y - drag.sy;
      // 对齐参考线:把拖动选区的 左/中/右、上/中/下 吸附到其它节点的同类线
      const movingIds = new Set(Object.keys(drag.origins));
      const moved = nodes.filter((n) => movingIds.has(n.id)).map((n) => ({ ...n, x: drag.origins[n.id]!.x + dx, y: drag.origins[n.id]!.y + dy }));
      if (moved.length) {
        const bx0 = Math.min(...moved.map((n) => n.x));
        const bx1 = Math.max(...moved.map((n) => n.x + n.w));
        const by0 = Math.min(...moved.map((n) => n.y));
        const by1 = Math.max(...moved.map((n) => n.y + n.h));
        const myX = [bx0, (bx0 + bx1) / 2, bx1];
        const myY = [by0, (by0 + by1) / 2, by1];
        const others = nodes.filter((n) => !movingIds.has(n.id));
        const tol = 6 / zoom;
        const gv: number[] = [];
        const gh: number[] = [];
        let bestX = Infinity, bestY = Infinity, sxAdj = 0, syAdj = 0;
        for (const o of others) {
          for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) for (const mx of myX) {
            const d = ox - mx;
            if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestX)) { bestX = d; sxAdj = d; }
            if (Math.abs(ox - mx) <= tol) gv.push(ox);
          }
          for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) for (const my of myY) {
            const d = oy - my;
            if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestY)) { bestY = d; syAdj = d; }
            if (Math.abs(oy - my) <= tol) gh.push(oy);
          }
        }
        if (Number.isFinite(bestX)) dx += sxAdj;
        if (Number.isFinite(bestY)) dy += syAdj;
        setGuides(gv.length || gh.length ? { v: [...new Set(gv)], h: [...new Set(gh)] } : null);
      }
      // 拖动过程自由移动(不 snap),松手时统一吸附 —— move-time 硬吸格是"跳格不顺滑"的根因,也会跟对齐吸附打架
      setNodes((ns) => ns.map((n) => (drag.origins[n.id] ? { ...n, x: drag.origins[n.id]!.x + dx, y: drag.origins[n.id]!.y + dy } : n)));
    }
    if (resize) {
      movedRef.current = true;
      setNodes((ns) => ns.map((n) => (n.id === resize.id ? resizeNode(resize, x, y, e.shiftKey === true) : n)));
    }
    if (conn) {
      movedRef.current = true;
      const tg = nodeAt(x, y, conn.from);
      setConn((c) => (c ? { ...c, x, y, tgt: tg?.id ?? null } : c));
    }
    if (band) setBand((b) => (b ? { ...b, x1: x, y1: y } : b));
  };
  const onUp = (): void => {
    if (panDrag) {
      setPanDrag(null);
      return;
    }
    if (epDrag) {
      if (epDrag.tgt) {
        const otherEnd = epDrag.end === 'from' ? 'to' : 'from';
        setEdges((es) => es.map((e) => (e.id === epDrag.edgeId && e[otherEnd] !== epDrag.tgt ? { ...e, [epDrag.end]: epDrag.tgt!, points: undefined } : e)));
      }
      if (movedRef.current && preGesture.current) {
        past.current.push(preGesture.current);
        if (past.current.length > 80) past.current.shift();
        future.current = [];
      }
      preGesture.current = null;
      movedRef.current = false;
      setEpDrag(null);
      return;
    }
    if (arrow) {
      cloneConnect(arrow.from, arrow.dir);
      setArrow(null);
      return;
    }
    const madeEdge = !!(conn && conn.tgt);
    if (conn && conn.tgt) {
      const to = conn.tgt;
      setEdges((es) => (es.some((d) => d.from === conn.from && d.to === to) ? es : [...es, { id: freshId('e'), from: conn.from, to }]));
    }
    if (band) {
      const r = bandRect(band);
      if (r.w > 3 || r.h > 3) setSelIds(new Set(nodes.filter((n) => intersects(r, n)).map((n) => n.id)));
      setBand(null);
    }
    // 松手统一吸附(拖动/缩放过程是自由移动的,收尾落格,drawio 同款手感)
    if (movedRef.current && drag) setNodes((ns) => ns.map((n) => (drag.origins[n.id] ? { ...n, x: snap(n.x), y: snap(n.y) } : n)));
    if (movedRef.current && resize) setNodes((ns) => ns.map((n) => (n.id === resize.id ? { ...n, x: snap(n.x), y: snap(n.y), w: Math.max(40, snap(n.w)), h: Math.max(30, snap(n.h)) } : n)));
    // 手势若真的改动了内容,把开始前的快照压入撤销栈
    if ((movedRef.current || madeEdge) && preGesture.current) {
      past.current.push(preGesture.current);
      if (past.current.length > 80) past.current.shift();
      future.current = [];
    }
    preGesture.current = null;
    movedRef.current = false;
    setDrag(null);
    setConn(null);
    setResize(null);
    setGuides(null);
    setRotate(null);
    setWpDrag(null);
  };
  const capture = (e: { pointerId: number }): void => {
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // ── 撤销/重做 + 手势历史 ──
  const preGesture = useRef<{ nodes: BNode[]; edges: BEdge[] } | null>(null);
  const movedRef = useRef(false);
  const arrowNudging = useRef(false);
  const snapshot = (): { nodes: BNode[]; edges: BEdge[] } => ({ nodes: nodes.map((n) => ({ ...n })), edges: edges.map((e) => ({ ...e, ...(e.points ? { points: e.points.map((pt) => ({ ...pt })) } : {}) })) });
  const commit = (): void => {
    past.current.push(snapshot());
    if (past.current.length > 80) past.current.shift();
    future.current = [];
  };
  const beginGesture = (): void => {
    preGesture.current = snapshot();
    movedRef.current = false;
  };
  const undo = (): void => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(snapshot());
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setSelIds(new Set());
    setSelEdge(null);
  };
  const redo = (): void => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snapshot());
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelIds(new Set());
    setSelEdge(null);
  };
  const duplicate = (offset: number): void => {
    const sel = nodes.filter((n) => selIds.has(n.id));
    if (!sel.length) return;
    commit();
    const idMap = new Map<string, string>();
    const clones = sel.map((n) => {
      const id = freshId('n');
      idMap.set(n.id, id);
      return { ...n, id, x: snap(n.x + offset), y: snap(n.y + offset) };
    });
    const newEdges = edges
      .filter((ed) => idMap.has(ed.from) && idMap.has(ed.to))
      .map((ed) => ({ ...ed, id: freshId('e'), from: idMap.get(ed.from)!, to: idMap.get(ed.to)! }));
    setNodes((ns) => [...ns, ...clones]);
    if (newEdges.length) setEdges((es) => [...es, ...newEdges]);
    setSelIds(new Set(clones.map((c) => c.id)));
    setSelEdge(null);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (editing) return;
      const meta = e.ctrlKey || e.metaKey;
      if (e.code === 'Space' && !meta) {
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceDown(true);
        }
        e.preventDefault();
        return;
      }
      if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
      if (meta && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); setSelIds(new Set(nodes.map((n) => n.id))); setSelEdge(null); return; }
      if (meta && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicate(20); return; }
      if (meta && (e.key === 'c' || e.key === 'C')) { clipRef.current = nodes.filter((n) => selIds.has(n.id)).map((n) => ({ ...n })); return; }
      if (meta && (e.key === 'v' || e.key === 'V')) {
        if (!clipRef.current.length) return;
        e.preventDefault();
        commit();
        const clones = clipRef.current.map((n) => ({ ...n, id: freshId('n'), x: snap(n.x + 24), y: snap(n.y + 24) }));
        setNodes((ns) => [...ns, ...clones]);
        setSelIds(new Set(clones.map((c) => c.id)));
        setSelEdge(null);
        return;
      }
      if (e.key === 'Escape') { setSelIds(new Set()); setSelEdge(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selIds.size) {
          commit();
          setNodes((ns) => ns.filter((n) => !selIds.has(n.id)));
          setEdges((es) => es.filter((ed) => !selIds.has(ed.from) && !selIds.has(ed.to)));
          setSelIds(new Set());
        } else if (selEdge) {
          commit();
          setEdges((es) => es.filter((ed) => ed.id !== selEdge));
          setSelEdge(null);
        }
        return;
      }
      if (e.key.startsWith('Arrow') && selIds.size) {
        e.preventDefault();
        const step = e.shiftKey ? GRID : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (!arrowNudging.current) {
          commit();
          arrowNudging.current = true;
        }
        setNodes((ns) => ns.map((n) => (selIds.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)));
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceDown(false);
      }
      if (e.key.startsWith('Arrow')) arrowNudging.current = false;
    };
    window.addEventListener('keydown', k);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', k);
      window.removeEventListener('keyup', up);
    };
  }, [selIds, selEdge, editing, nodes, edges]);

  // Ctrl + 滚轮:朝光标位置缩放画布(光标下的点保持不动)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const nz = Math.min(4, Math.max(0.25, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const cx = (mx - pan.x) / zoom;
      const cy = (my - pan.y) / zoom;
      setPan({ x: mx - cx * nz, y: my - cy * nz });
      setZoom(nz);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, pan]);

  return (
    <div
      className={'drawio-board' + (panDrag ? ' grabbing' : spaceDown ? ' grab' : '')}
      ref={ref}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerDown={(e) => {
        if (spaceRef.current || e.button === 1) {
          capture(e);
          setPanDrag({ sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y });
          return;
        }
        const cl = (e.target as HTMLElement).classList;
        if (e.target === ref.current || cl.contains('board-svg') || cl.contains('board-canvas')) {
          setSelIds(new Set());
          setSelEdge(null);
          capture(e);
          const { x, y } = pt(e);
          setBand({ x0: x, y0: y, x1: x, y1: y });
        }
      }}
      onDoubleClick={(e) => {
        const cl = (e.target as HTMLElement).classList;
        if (e.target === ref.current || cl.contains('board-svg') || cl.contains('board-canvas')) {
          const { x, y } = pt(e);
          addNode(x, y, '<rect x="4" y="5" width="32" height="20" rx="2"/>', t('文本'));
        }
      }}
    >
      <div className="board-canvas" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
      <svg className="board-svg">
        <DrawioEdgeLayer
          nodes={nodes}
          edges={edges}
          selectedEdgeId={selEdge}
          connection={conn}
          guides={guides}
          onSelect={(edgeId) => { setSelEdge(edgeId); setSelIds(new Set()); }}
        />
      </svg>

      {nodes.map((n) => {
        const isSel = selIds.has(n.id);
        const isHover = hover === n.id;
        const isTgt = conn?.tgt === n.id || epDrag?.tgt === n.id;
        // 几何兜底:真框住了其它节点的才是容器(面积须明显更大,避免同尺寸叠放互判),标签贴顶别压子节点
        const isContainer = n.vTop || (!n.text && nodes.some((b) => b.id !== n.id && b.x >= n.x && b.y >= n.y && b.x + b.w <= n.x + n.w && b.y + b.h <= n.y + n.h && b.w * b.h < n.w * n.h * 0.8));
        return (
          <div
            key={n.id}
            className={'bnode' + (isSel ? ' sel' : '') + (isHover && !isSel ? ' hover' : '') + (isTgt ? ' tgt' : '') + (n.id === hi ? ' hi' : '')}
            style={{ left: n.x, top: n.y, width: n.w, height: n.h, ...(n.rot ? { transform: `rotate(${n.rot}deg)` } : {}) }}
            onPointerEnter={() => setHover(n.id)}
            onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
            onPointerDown={(e) => {
              e.stopPropagation();
              capture(e);
              beginGesture();
              const ids = e.shiftKey ? new Set(selIds).add(n.id) : selIds.has(n.id) ? selIds : new Set([n.id]);
              setSelIds(ids);
              setSelEdge(null);
              const { x, y } = pt(e);
              const origins: Record<string, XY> = {};
              nodes.forEach((nd) => {
                if (ids.has(nd.id)) origins[nd.id] = { x: nd.x, y: nd.y };
              });
              setDrag({ sx: x, sy: y, origins });
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(n.id);
            }}
          >
            {n.text ? null : (n.shape ?? (n.style ? styleToKind(n.style) : null)) ? (
              // 参数化形状引擎(drawio 同源):按实际 w×h 生成几何,箭头深度/圆角/折角等细节定值钳制——缩放不变形
              <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(8, n.w)} ${Math.max(8, n.h)}`} fill={n.fill ?? '#ffffff'} stroke={n.stroke ?? '#9aa3b2'} strokeWidth={1.3} dangerouslySetInnerHTML={{ __html: shapeSvg((n.shape ?? styleToKind(n.style))!, Math.max(8, n.w), Math.max(8, n.h)) }} />
            ) : (n.fill || n.stroke || n.kind === 'agent') && (!n.inner || /^<rect/.test(n.inner)) ? (
              <div className="bnode-box" style={{ background: n.fill ?? '#ffffff', borderColor: n.stroke ?? '#9aa3b2' }} />
            ) : n.fill || n.stroke || n.kind === 'agent' ? (
              // 带填充的非矩形形状:真按 innerForStyle 的形状渲染(此前一律画成矩形盒,90 种形状全被吃掉)
              <svg viewBox="3 3 34 24" preserveAspectRatio="none" fill={n.fill ?? '#ffffff'} stroke={n.stroke ?? '#9aa3b2'} strokeWidth={0.9} dangerouslySetInnerHTML={{ __html: n.inner }} />
            ) : (
              <svg viewBox="3 3 34 24" preserveAspectRatio="none" fill="none" stroke="#3a3f4b" strokeWidth={0.9} dangerouslySetInnerHTML={{ __html: n.inner }} />
            )}
            {editing === n.id ? (
              <input
                className="bnode-edit"
                autoFocus
                defaultValue={n.label}
                onBlur={(e) => {
                  const v = e.target.value;
                  setNodes((ns) => ns.map((m) => (m.id === n.id ? { ...m, label: v } : m)));
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              <span className={'bnode-label' + (n.text ? ' txt' : '') + (isContainer && !n.text ? ' top' : '') + (n.wrap ? ' wrap' : '')} style={{ ...(n.fontColor ? { color: n.fontColor } : {}), ...(n.fontSize ? { fontSize: n.fontSize } : {}), ...(n.bold ? { fontWeight: 700 } : {}) }}>{n.label}</span>
            )}
            {(isHover || isSel) && !drag && !resize
              ? PORTS.map((p, i) => (
                  <span
                    key={i}
                    className="bport"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      capture(e);
                      beginGesture();
                      const { x, y } = pt(e);
                      setConn({ from: n.id, x, y, tgt: null });
                    }}
                  />
                ))
              : null}
            {isSel && selIds.size === 1
              ? HANDLES.map((h) => (
                  <span
                    key={h.k}
                    className={'bhandle h-' + h.k}
                    style={{ left: `${h.fx * 100}%`, top: `${h.fy * 100}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      capture(e);
                      beginGesture();
                      const { x, y } = pt(e);
                      setResize({ id: n.id, k: h.k, box: n, sx: x, sy: y });
                    }}
                  />
                ))
              : null}
            {isSel && selIds.size === 1 ? (
              <span
                className="brot"
                title={t('拖动旋转,按住 Shift 吸附 15°')}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  capture(e);
                  beginGesture();
                  setRotate({ id: n.id, cx: n.x + n.w / 2, cy: n.y + n.h / 2 });
                }}
              >
                ↻
              </span>
            ) : null}
            {isHover && selIds.size <= 1 && !drag && !resize && !conn && !band && !rotate
              ? (['up', 'right', 'down', 'left'] as const).map((dir) => (
                  <span
                    key={dir}
                    className={'barrow ba-' + dir}
                    title={t('点=克隆并连接,拖=连线')}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      capture(e);
                      beginGesture();
                      const { x, y } = pt(e);
                      setArrow({ from: n.id, dir, sx: x, sy: y });
                    }}
                  />
                ))
              : null}
          </div>
        );
      })}
      <svg className="board-svg board-overlay">
        <DrawioEdgeHandles
          nodes={nodes}
          edge={edges.find((edge) => edge.id === selEdge) ?? null}
          onEndpointStart={(edgeId, end, pointerId) => { capture({ pointerId }); beginGesture(); setEpDrag({ edgeId, end, tgt: null }); }}
          onWaypointAdd={(edgeId, index, point, pointerId) => {
            capture({ pointerId });
            beginGesture();
            movedRef.current = true;
            setEdges((es) => es.map((edge) => {
              if (edge.id !== edgeId) return edge;
              const points = [...(edge.points ?? [])];
              points.splice(index, 0, { x: snap(point.x), y: snap(point.y) });
              return { ...edge, points };
            }));
            setWpDrag({ edgeId, index });
          }}
          onWaypointStart={(edgeId, index, pointerId) => { capture({ pointerId }); beginGesture(); setWpDrag({ edgeId, index }); }}
          onWaypointRemove={(edgeId, index) => {
            commit();
            setEdges((es) => es.map((edge) => edge.id === edgeId
              ? { ...edge, points: (edge.points?.length ?? 0) > 1 ? edge.points!.filter((_, pointIndex) => pointIndex !== index) : undefined }
              : edge));
          }}
        />
      </svg>
      {band ? (() => { const r = bandRect(band); return <div className="band" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />; })() : null}
      </div>
      <DrawioEdgeToolbar
        nodes={nodes}
        edge={edges.find((edge) => edge.id === selEdge) ?? null}
        zoom={zoom}
        pan={pan}
        onChange={(edgeId, patch) => {
          commit();
          setEdges((es) => es.map((edge) => edge.id === edgeId ? { ...edge, ...patch } : edge));
        }}
      />
      {nodes.length === 0 && <div className="board-hint">{t('从左侧拖拽形状到画板,或双击空白处新建;拖节点边缘圆点连线;框选多选;Ctrl+滚轮缩放')}</div>}
      <div className="board-pages">
        {pageNames.map((n, i) => (
          <button key={i} className={'bp' + (i === curPage ? ' on' : '')} title={n} onClick={() => switchPage(i)}
            onDoubleClick={() => { const v = window.prompt(t('页名'), n); if (v?.trim()) setPageNames((ns) => ns.map((x, k) => (k === i ? v.trim() : x))); }}>{n}</button>
        ))}
        <button className="bp add" title={t('新建页')} onClick={addPage}>+</button>
      </div>
      {nodes.length > 0 && (
        <button className="board-export" title={t('导出为标准 .drawio 文件(drawio 可直接打开)')} onClick={() => {
          void import('./drawio-io.js').then(({ serializeDrawio }) => {
            stashRef.current[curPage] = { nodes: nodesRef.current, edges: edgesRef.current };
            const xml = serializeDrawio(pageNames.map((name, i) => ({ name, ...(stashRef.current[i] ?? { nodes: [], edges: [] }) })));
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
            a.download = '流程图.otterpatch.drawio';
            a.click();
            URL.revokeObjectURL(a.href);
          });
        }}>{t('导出 .drawio')}</button>
      )}
      <div className="board-zoom">{Math.round(zoom * 100)}%</div>
    </div>
  );
});
