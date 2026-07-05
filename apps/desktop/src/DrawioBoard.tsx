/**
 * DrawioBoard — the entire drawio workspace: toolbar, shape palette, board component
 * (geometry, orthogonal routing, selection, edge editing) plus the style/stream helpers
 * the agent bridge uses. Extracted verbatim from App.tsx (decomposition phase 4).
 */
/* eslint-disable */
// NOTE: imports appended below are the minimal set the moved block references.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useT } from './i18n.js';
import { shapeSvg, styleToKind, SHAPE_DEFS } from './shape-engine.js';
import { FUNC_ICONS, IconPlus, IconSearch, IconUndo } from './icons.js';
import { DRAWIO_SHAPES } from './drawio-shapes.js';

/** Toolbar callback: open a dropdown anchored to the clicked control (mirrors App's ribbon). */
export type OnOpen = (it: string, el: HTMLElement) => void;

/** drawio 顶部工具栏(仿 next-ai-drawio):单行图标,取代 Office 选项卡式功能区。 */
const DTOOLS = ['选择', '添加节点', '连线', '文本', '自由绘制', '填充色', '线条', '圆角', '阴影', '形状'];
export function DrawioToolbar({ onAct }: { onAct: OnOpen }) {
  const t = useT();
  return (
    <div className="dtoolbar">
      <button className="dtool" title={t('撤销')} onClick={(e) => onAct('撤销', e.currentTarget)}><IconUndo size={16} /></button>
      <span className="dsep" />
      {DTOOLS.map((it) => {
        const Ico = FUNC_ICONS[it];
        const accent = it === '填充色' ? ' ic-amber' : '';
        return (
          <button key={it} className={'dtool' + accent} title={t(it)} onClick={(e) => onAct(it, e.currentTarget)}>
            {Ico ? <Ico size={16} /> : it.slice(0, 1)}
          </button>
        );
      })}
      <span className="grow" />
      <span className="dzoom"><IconSearch size={13} /> 100%</span>
    </div>
  );
}

/** drawio 左侧形状面板(高度还原 jgraph/drawio:可折叠 通用/杂项/高级 + 搜索 + 便笺本 + 更多图形)。 */
const PAL_CATS: { key: 'general' | 'flow' | 'arrows' | 'icons'; label: string }[] = [
  { key: 'general', label: '通用' },
  { key: 'flow', label: '流程图' },
  { key: 'arrows', label: '箭头' },
  { key: 'icons', label: '图标' },
];

export function DrawioPalette({ onPick }: { onPick: (s: string) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ general: true, flow: true, arrows: false, icons: false });
  const query = q.trim();
  return (
    <aside className="palette">
      <div className="pal-search">
        <IconSearch size={13} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索形状')} />
      </div>
      <div className="pal-cat">
        <div className="pal-cat-h">{t('便笺本')}</div>
        <div className="pal-scratch">{t('把元素拖至此处')}</div>
      </div>
      {PAL_CATS.map((cat) => {
        // 形状库改由参数化引擎驱动(80 种,drawio 同源几何):缩略图与画布同一生成器,所见即所得
        const shapes = SHAPE_DEFS.filter((s) => s.cat === cat.key && (!query || s.name.includes(query) || s.kind.toLowerCase().includes(query.toLowerCase())));
        const isOpen = query ? shapes.length > 0 : open[cat.key] !== false;
        if (query && shapes.length === 0) return null;
        return (
          <div className="pal-cat" key={cat.key}>
            <button className="pal-cat-h click" onClick={() => setOpen((o) => ({ ...o, [cat.key]: !(o[cat.key] !== false) }))}>
              <span className={'tri' + (isOpen ? ' open' : '')}>▸</span> {t(cat.label)}
              <span className="pal-n">{shapes.length}</span>
            </button>
            {isOpen && (
              <div className="pal-grid">
                {shapes.map((s) => (
                  <button
                    key={s.kind}
                    className="pal-shape"
                    title={s.name}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('otterpatch/shape', JSON.stringify({ name: s.name, shape: s.kind }))}
                    onClick={() => onPick(s.name)}
                  >
                    <svg viewBox="0 0 40 30" fill="none" stroke="currentColor" strokeWidth={1.2} dangerouslySetInnerHTML={{ __html: shapeSvg(s.kind, 40, 30) }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button className="pal-more"><IconPlus size={13} /> {t('更多图形')}</button>
    </aside>
  );
}

interface XY { x: number; y: number }
export interface BNode { id: string; x: number; y: number; w: number; h: number; inner: string; label: string; kind?: string; rot?: number; fill?: string; stroke?: string; fontColor?: string; fontSize?: number; bold?: boolean; text?: boolean; vTop?: boolean; wrap?: boolean; style?: string; shape?: string }
type ArrowKind = 'classic' | 'open' | 'diamond' | 'circle' | 'none';
type EdgeStyle = 'ortho' | 'straight' | 'curve';
/** 曲线线型:Catmull-Rom 过点样条(drawio curved=1 语义);无航点时给一个轻微弓弧让曲线可辨。 */
function smoothPath(pts: XY[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) {
    const [a, b] = [pts[0]!, pts[1]!];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const k = Math.min(24, L * 0.15); // 轻弓,长度钳制
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    return `M ${a.x} ${a.y} Q ${mx + nx * k} ${my + ny * k} ${b.x} ${b.y}`;
  }
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}
export interface BEdge { id: string; from: string; to: string; arrow?: ArrowKind; style?: EdgeStyle; points?: XY[]; color?: string; width?: number; dash?: boolean; label?: string }
/** 两节点周界直连(直线线型)。 */
function straightRoute(a: BNode, b: BNode): XY[] {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return [perim(a, bc.x, bc.y), perim(b, ac.x, ac.y)];
}
/** 经过显式航点的正交折线:source周界 → 各航点 → target周界,相邻点间插直角拐点。 */
function routeWaypoints(a: BNode, b: BNode, pts: XY[]): XY[] {
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const all = [perim(a, first.x, first.y), ...pts, perim(b, last.x, last.y)];
  const out: XY[] = [all[0]!];
  for (let i = 1; i < all.length; i++) {
    const c = out[out.length - 1]!;
    const q = all[i]!;
    if (Math.abs(c.x - q.x) > 0.5 && Math.abs(c.y - q.y) > 0.5) out.push({ x: q.x, y: c.y });
    out.push(q);
  }
  return out;
}
/** 选中边时用于摆放航点/虚拟折点手柄的控制点序列:[源周界, ...航点, 目标周界]。 */
function controlPoints(a: BNode, b: BNode, pts: XY[]): XY[] {
  if (pts.length) {
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    return [perim(a, first.x, first.y), ...pts, perim(b, last.x, last.y)];
  }
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return [perim(a, bc.x, bc.y), perim(b, ac.x, ac.y)];
}
function edgePts(a: BNode, b: BNode, style?: EdgeStyle, points?: XY[]): XY[] {
  if (points && points.length) return routeWaypoints(a, b, points);
  return style === 'straight' ? straightRoute(a, b) : ortho(a, b);
}
/** 中心连线是否穿过第三方节点矩形(采样粗判,覆盖同排横穿/同列竖穿的主场景)。 */
function segCrossesRect(a: BNode, b: BNode, n: BNode): boolean {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  for (let t = 0.08; t < 0.95; t += 0.04) {
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    if (x > n.x && x < n.x + n.w && y > n.y && y < n.y + n.h) return true;
  }
  return false;
}
/** 避障路由:直连会横穿其它节点时绕行(节点画在连线之上,穿过=视觉断线,长线看起来像相邻节点串联)。 */
function avoidRoute(a: BNode, b: BNode, ed: { id: string; style?: EdgeStyle; points?: XY[] }, nodes: BNode[]): XY[] {
  if (!ed.points?.length) {
    // 容器(大框)与扁横条(分区标签)不算障碍:线从它们身上过是正常的;真正遮断视觉的是普通组件节点
    const blockers = nodes.filter((n) => n.id !== a.id && n.id !== b.id && n.w >= 40 && n.h >= 40 && n.w * n.h <= 60000 && segCrossesRect(a, b, n));
    if (blockers.length) {
      const lane = 26 + (Math.abs([...ed.id].reduce((s, c) => s + c.charCodeAt(0), 0)) % 3) * 14; // 多条绕行线错开车道
      const horiz = Math.abs((b.x + b.w / 2) - (a.x + a.w / 2)) >= Math.abs((b.y + b.h / 2) - (a.y + a.h / 2));
      const wp: XY = horiz
        ? { x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, y: Math.min(a.y, b.y, ...blockers.map((n) => n.y)) - lane }
        : { x: Math.max(a.x + a.w, b.x + b.w, ...blockers.map((n) => n.x + n.w)) + lane, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 };
      return routeWaypoints(a, b, [wp]);
    }
  }
  return edgePts(a, b, ed.style, ed.points);
}
const ARROWS: ArrowKind[] = ['classic', 'open', 'diamond', 'circle', 'none'];
function arrowGlyph(ak: ArrowKind): ReactNode {
  const x2 = ak === 'none' ? 18 : 11;
  const head =
    ak === 'classic' ? <path d="M10,2 L17,6 L10,10 z" fill="currentColor" /> :
    ak === 'open' ? <path d="M11,2.5 L17,6 L11,9.5" fill="none" stroke="currentColor" strokeWidth={1.3} /> :
    ak === 'diamond' ? <path d="M9,6 L13,2.5 L17,6 L13,9.5 z" fill="currentColor" /> :
    ak === 'circle' ? <circle cx="14" cy="6" r="2.6" fill="currentColor" /> :
    null;
  return (
    <g stroke="currentColor">
      <line x1={1} y1={6} x2={x2} y2={6} strokeWidth={1.3} />
      {head}
    </g>
  );
}

const GRID = 10;
export const snap = (v: number): number => Math.round(v / GRID) * GRID;
/** drawio value 里的 HTML 痕迹(<br>/标签)转纯文本——标签是纯文本渲染,别把 "<br>" 字面画出来。 */
export const cleanLabel = (v: unknown): string => String(v ?? '').replace(/<br\s*\/?\s*>/gi, ' · ').replace(/<[^>]+>/g, '').trim();
const ndir = (p: XY, q: XY): XY => {
  const dx = q.x - p.x, dy = q.y - p.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
};
/** 射线从节点中心到目标点,与节点矩形边界的交点(周界连接,箭头贴边)。 */
function perim(n: BNode, tx: number, ty: number): XY {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = Math.abs(dx) > 0.001 ? n.w / 2 / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 0.001 ? n.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}
/** drawio 风格正交路由:沿主轴从源侧中点出、到目标侧中点入,中段折返。 */
function ortho(a: BNode, b: BNode): XY[] {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const dx = bcx - acx, dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const right = dx >= 0;
    // 竖直方向有重叠 → 两端取重叠区中点做共同 y,得到一条干净的水平直线
    const oy0 = Math.max(a.y, b.y);
    const oy1 = Math.min(a.y + a.h, b.y + b.h);
    const yy = oy1 > oy0 + 2 ? (oy0 + oy1) / 2 : Math.abs(acy - bcy) <= 8 ? (acy + bcy) / 2 : null; // 近对齐(≤8px)吸成一条直线,别走小台阶
    const p1 = { x: right ? a.x + a.w : a.x, y: yy ?? acy };
    const p2 = { x: right ? b.x : b.x + b.w, y: yy ?? bcy };
    if (Math.abs(p1.y - p2.y) < 0.5) return [{ x: p1.x, y: p1.y }, { x: p2.x, y: p1.y }];
    const mx = (p1.x + p2.x) / 2;
    return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
  }
  const down = dy >= 0;
  const ox0 = Math.max(a.x, b.x);
  const ox1 = Math.min(a.x + a.w, b.x + b.w);
  const xx = ox1 > ox0 + 2 ? (ox0 + ox1) / 2 : Math.abs(acx - bcx) <= 8 ? (acx + bcx) / 2 : null;
  const p1 = { x: xx ?? acx, y: down ? a.y + a.h : a.y };
  const p2 = { x: xx ?? bcx, y: down ? b.y : b.y + b.h };
  if (Math.abs(p1.x - p2.x) < 0.5) return [{ x: p1.x, y: p1.y }, { x: p1.x, y: p2.y }];
  const my = (p1.y + p2.y) / 2;
  return [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
}
function roundedPath(pts: XY[], r = 8): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!, prev = pts[i - 1]!, next = pts[i + 1]!;
    const rr = Math.min(r, Math.hypot(prev.x - p.x, prev.y - p.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const a = { x: p.x + ndir(p, prev).x * rr, y: p.y + ndir(p, prev).y * rr };
    const c = { x: p.x + ndir(p, next).x * rr, y: p.y + ndir(p, next).y * rr };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${c.x} ${c.y}`;
  }
  const last = pts[pts.length - 1]!;
  return d + ` L ${last.x} ${last.y}`;
}
export interface BoardSel { count: number; chip: string; context: string }
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
/** drawio style 串 → 画板节点的线稿 inner SVG(覆盖常见形状,默认矩形)。 */
export function innerForStyle(style?: string): string {
  const s = (style ?? '').toLowerCase();
  if (s.includes('ellipse')) return '<ellipse cx="20" cy="15" rx="16" ry="11"/>';
  if (s.includes('rhombus')) return '<polygon points="20,3 37,15 20,27 3,15"/>';
  if (s.includes('hexagon')) return '<polygon points="11,5 29,5 37,15 29,25 11,25 3,15"/>';
  if (s.includes('cylinder')) return '<ellipse cx="20" cy="7" rx="13" ry="3.5"/><line x1="7" y1="7" x2="7" y2="23"/><line x1="33" y1="7" x2="33" y2="23"/><path d="M7 23 A13 3.5 0 0 0 33 23"/>';
  if (s.includes('parallelogram')) return '<polygon points="9,5 37,5 31,25 3,25"/>';
  if (s.includes('trapezoid')) return '<polygon points="10,5 30,5 37,25 3,25"/>';
  if (s.includes('cloud')) return '<path d="M11 23 Q4 23 5 17 Q5 12 11 12 Q13 5 20 7 Q27 4 29 11 Q36 11 35 17 Q36 23 29 23 Z"/>';
  if (s.includes('document')) return '<path d="M5 5 H35 V21 C31 26 27 17 23 21 C19 25 15 17 11 21 C9 23 7 23 5 21 Z"/>';
  if (s.includes('note') || s.includes('card')) return '<path d="M5 5 H29 L37 13 V25 H5 Z"/><path d="M29 5 V13 H37" fill="none"/>';
  if (s.includes('callout')) return '<path d="M5 5 H37 V19 H17 L10 26 V19 H5 Z"/>';
  if (s.includes('triangle')) return '<polygon points="20,4 37,26 3,26"/>';
  if (s.includes('actor')) return '<circle cx="20" cy="7" r="4" fill="none"/><path d="M20 11 V19 M12 14 H28 M20 19 L13 27 M20 19 L27 27" fill="none"/>';
  if (s.includes('star')) return '<polygon points="20,3 24,12 34,12 26,18 29,27 20,21 11,27 14,18 6,12 16,12"/>';
  if (s.includes('rounded=1') || s.includes('rounded')) return '<rect x="4" y="5" width="32" height="20" rx="4" ry="4"/>';
  return '<rect x="4" y="5" width="32" height="20"/>';
}
/** 解析 drawio style 串 → 画板节点的填充/描边/字体(借鉴 Next AI Drawio 的彩色渲染)。 */
export function parseDrawioStyle(style?: string): { fill?: string; stroke?: string; fontColor?: string; fontSize?: number; bold?: boolean; text?: boolean; vTop?: boolean } {
  const s = style ?? '';
  const get = (k: string): string | undefined => new RegExp(k + '=([^;]+)').exec(s)?.[1]?.trim();
  const fill = get('fillColor'); const stroke = get('strokeColor'); const fontColor = get('fontColor');
  const fs = get('fontSize'); const fontStyle = get('fontStyle');
  const isText = /(?:^|;)\s*text(?:;|$)/.test(s) || s.includes('text;html');
  // 容器/泳道/贴顶标签:标题渲染在顶部,别居中压住子节点(drawio 语义:container/swimlane 的 label 在顶栏)
  const vTop = /verticalAlign=top/.test(s) || /container=1/.test(s) || /(?:^|;)\s*(?:swimlane|group)(?:;|$|\b)/.test(s);
  const wrap = /whitespace=wrap/i.test(s); // 长文本节点:标签换行而非截断
  return {
    ...(wrap ? { wrap: true } : {}),
    ...(fill && fill !== 'none' ? { fill } : {}),
    ...(stroke && stroke !== 'none' ? { stroke } : {}),
    ...(fontColor ? { fontColor } : {}),
    ...(fs && Number.isFinite(parseFloat(fs)) ? { fontSize: Math.round(parseFloat(fs)) } : {}),
    ...(fontStyle && (parseInt(fontStyle, 10) & 1) ? { bold: true } : {}),
    ...(isText ? { text: true } : {}),
    ...(vTop ? { vTop: true } : {}),
  };
}
export interface RawDrawioOp { op?: string; cellId?: string; value?: string; style?: string; edge?: boolean; source?: string; target?: string; parent?: string; x?: number; y?: number; width?: number; height?: number }
/** 从【流式中的】propose 入参里抽出已闭合的 op 对象(容忍尾部未完成的 JSON),供"边生成边画"。 */
export function extractDrawioOps(buf: string): RawDrawioOp[] {
  const m = /"ops"\s*:\s*\[/.exec(buf);
  if (!m) return [];
  let i = m.index + m[0].length;
  const out: RawDrawioOp[] = [];
  while (i < buf.length) {
    while (i < buf.length && /[\s,]/.test(buf[i]!)) i++;
    if (i >= buf.length || buf[i] !== '{') break;
    let depth = 0, inStr = false, esc = false, j = i, closed = false;
    for (; j < buf.length; j++) {
      const c = buf[j]!;
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { j++; closed = true; break; } }
    }
    if (!closed) break;
    try { out.push(JSON.parse(buf.slice(i, j)) as RawDrawioOp); } catch { break; }
    i = j;
  }
  return out;
}
/** 流式画板转换器:把【原始 proposal op】逐个转成画板节点/连线(editId 'e'+index 与 buildChangeSet 对齐)。 */
export function makeRawBoardConv(seq: number, taken?: (id: string) => boolean): (op: RawDrawioOp, index: number) => { editId: string; boardId: string; node?: BNode; edge?: BEdge } | null {
  const idMap = new Map<string, string>();
  // 保留 Agent 给的 cellId(多轮连贯的关键:下一批还能用 n1 引用上一批画的节点);仅与画板已有对象撞名才改名
  const bid = (orig?: string): string => {
    const k = orig ?? ('?' + idMap.size);
    let v = idMap.get(k);
    if (!v) { v = orig && !taken?.(orig) ? orig : `${orig ?? 'g'}_${seq}_${idMap.size + 1}`; idMap.set(k, v); }
    return v;
  };
  // 引用(edge 两端/parent):本批建过用映射名;否则当作画板已有对象,原名直连
  const refId = (orig?: string): string => (orig ? idMap.get(orig) ?? orig : bid(orig));
  const made = new Map<string, BNode>(); // 原始 cellId → 节点(parent 相对坐标换算)
  let stackY = 60;
  return (op, index) => {
    if (op.op !== 'add') return null;
    if (op.edge || (op.source && op.target)) {
      const id = bid(op.cellId ?? 'e_' + index);
      return { editId: 'e' + index, boardId: id, edge: { id, from: refId(op.source), to: refId(op.target), arrow: /endArrow=none/.test(op.style ?? '') ? 'none' : 'classic', style: 'ortho', ...(/dashed=1/.test(op.style ?? '') ? { dash: true } : {}), ...(/strokeColor=([^;]+)/.exec(op.style ?? '')?.[1] ? { color: /strokeColor=([^;]+)/.exec(op.style ?? '')![1]! } : {}) } };
    }
    const id = bid(op.cellId ?? 'n_' + index);
    const w = op.width ?? 160; const h = op.height ?? 48;
    let x = op.x ?? 60; let y = op.y ?? stackY;
    // parent 相对坐标 → 绝对(drawio 语义;仅本批内的容器,流式场景容器总在子节点前到达)
    if (op.parent && op.parent !== '1') { const par = made.get(op.parent); if (par) { x += par.x; y += par.y; } }
    stackY = Math.max(stackY, y) + h + 40;
    const st = parseDrawioStyle(op.style);
    const sk = styleToKind(op.style);
    const node: BNode = { id, x: snap(x), y: snap(y), w, h, inner: innerForStyle(op.style), label: cleanLabel(op.value), kind: st.text ? 'text' : 'agent', ...(op.style ? { style: op.style } : {}), ...(sk ? { shape: sk } : {}), ...st };
    if (op.cellId) made.set(op.cellId, node);
    return { editId: 'e' + index, boardId: id, node };
  };
}
/** 一组 A1 格的包围区(用于大批量改动时整体聚焦,而非逐格)。 */
export function boundingA1(ops: { a1: string }[]): string | null {
  let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
  for (const o of ops) {
    const m = /([A-Za-z]+)([0-9]+)/.exec(o.a1.replace(/^.*!/, ''));
    if (!m) continue;
    let c = 0;
    for (const ch of m[1]!.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    const r = parseInt(m[2]!, 10);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  if (!Number.isFinite(minC)) return null;
  const col = (n: number): string => { let s = ''; let x = n; while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); } return s; };
  return `${col(minC)}${minR}:${col(maxC)}${maxR}`;
}
const bandRect = (b: { x0: number; y0: number; x1: number; y1: number }): { x: number; y: number; w: number; h: number } => ({
  x: Math.min(b.x0, b.x1),
  y: Math.min(b.y0, b.y1),
  w: Math.abs(b.x1 - b.x0),
  h: Math.abs(b.y1 - b.y0),
});
const intersects = (r: { x: number; y: number; w: number; h: number }, n: BNode): boolean =>
  !(n.x > r.x + r.w || n.x + n.w < r.x || n.y > r.y + r.h || n.y + n.h < r.y);

function resizeNode(r: { box: BNode; k: string; sx: number; sy: number }, x: number, y: number, shift: boolean): BNode {
  const b = r.box;
  const dx = x - r.sx, dy = y - r.sy;
  let w = b.w + (r.k.includes('e') ? dx : r.k.includes('w') ? -dx : 0);
  let h = b.h + (r.k.includes('s') ? dy : r.k.includes('n') ? -dy : 0);
  w = Math.max(40, w);
  h = Math.max(30, h);
  if (shift) {
    const aspect = b.w / b.h || 1;
    if (r.k.length === 2) {
      // 角手柄:取位移更大的轴为主,另一轴按比例
      if (Math.abs(w - b.w) >= Math.abs(h - b.h)) h = w / aspect;
      else w = h * aspect;
    } else if (r.k === 'n' || r.k === 's') {
      w = h * aspect;
    } else {
      h = w / aspect;
    }
    w = Math.max(40, w);
    h = Math.max(30, h);
  }
  let nx = b.x, ny = b.y;
  if (r.k.includes('w')) nx = b.x + b.w - w; // 锚定右/对边
  if (r.k.includes('n')) ny = b.y + b.h - h;
  return { ...b, x: snap(nx), y: snap(ny), w: snap(w), h: snap(h) };
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
/** 读持久化画板(多页;兼容旧单页 {nodes,edges} 格式迁移)。 */
function loadBoardStore(): { pages: BoardPage[]; cur: number } {
  try {
    const j = JSON.parse(localStorage.getItem(BOARD_KEY) ?? '{}') as { pages?: BoardPage[]; cur?: number; nodes?: BNode[]; edges?: BEdge[] };
    if (Array.isArray(j.pages) && j.pages.length) return { pages: j.pages, cur: Math.min(Math.max(j.cur ?? 0, 0), j.pages.length - 1) };
    if (j.nodes?.length || j.edges?.length) return { pages: [{ name: 'Page-1', nodes: j.nodes ?? [], edges: j.edges ?? [] }], cur: 0 };
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
      try { localStorage.setItem(BOARD_KEY, JSON.stringify({ pages: pageNames.map((name, i) => ({ name, ...(stashRef.current[i] ?? { nodes: [], edges: [] }) })), cur: curPage })); } catch { /* 配额满忽略 */ }
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
      if (nn.length) setNodes((ns) => [...ns, ...nn]);
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
    loadBoard: (nn, ee) => { commit(); setNodes(nn); setEdges(ee); setSelIds(new Set()); setSelEdge(null); },
    loadPages: (pgs) => {
      const pages = pgs.length ? pgs : [{ name: 'Page-1', nodes: [], edges: [] }];
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
      if (obj.node) { const nd = obj.node; setNodes((ns) => (ns.some((n) => n.id === nd.id) ? ns.map((n) => (n.id === nd.id ? nd : n)) : [...ns, nd])); }
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
    cb.current?.({ count: sn.length, chip, context: ctx.join('\n') });
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
    const s = JSON.parse(raw) as { name: string; inner?: string; shape?: string };
    const { x, y } = pt(e);
    addNode(x, y, s.inner ?? '', '', s.name, s.shape); // 拖入即参数化形状(shape kind),缩放不变形;kind 存中文名供 Agent 感知
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
        <defs>
          <marker id="otterpatch-arr" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker>
          <marker id="otterpatch-arr-sel" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--accent)" /></marker>
          <marker id="m-classic" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker>
          <marker id="m-open" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M1,0.5 L8,4 L1,7.5" fill="none" stroke="context-stroke" strokeWidth="1.4" /></marker>
          <marker id="m-diamond" markerWidth="13" markerHeight="11" refX="9.5" refY="4" orient="auto"><path d="M0,4 L4.7,0.5 L9.4,4 L4.7,7.5 z" fill="context-stroke" /></marker>
          <marker id="m-circle" markerWidth="11" markerHeight="11" refX="7.6" refY="4" orient="auto"><circle cx="4" cy="4" r="3" fill="context-stroke" /></marker>
        </defs>
        {(() => {
        // 先整体路由一遍:共用同一垂直/水平通道的 Z 形边分车道错开 10px(drawio 平行段间距语义)
        const routed = new Map<string, XY[]>();
        const lanes = new Map<number, string[]>();
        for (const ed of edges) {
          const a = nodes.find((n) => n.id === ed.from); const b = nodes.find((n) => n.id === ed.to);
          if (!a || !b || ed.style === 'curve') continue;
          const pts = avoidRoute(a, b, ed, nodes);
          routed.set(ed.id, pts);
          if (pts.length === 4) {
            const vert = Math.abs(pts[1]!.x - pts[2]!.x) < 0.5;
            const key = vert ? Math.round(pts[1]!.x / 20) : 100000 + Math.round(pts[1]!.y / 20);
            lanes.set(key, [...(lanes.get(key) ?? []), ed.id]);
          }
        }
        for (const ids of lanes.values()) {
          if (ids.length < 2) continue;
          ids.forEach((id, i) => {
            const pts = routed.get(id)!;
            const off = (i - (ids.length - 1) / 2) * 10;
            if (Math.abs(pts[1]!.x - pts[2]!.x) < 0.5) { pts[1] = { x: pts[1]!.x + off, y: pts[1]!.y }; pts[2] = { x: pts[2]!.x + off, y: pts[2]!.y }; }
            else { pts[1] = { x: pts[1]!.x, y: pts[1]!.y + off }; pts[2] = { x: pts[2]!.x, y: pts[2]!.y + off }; }
          });
        }
        return edges.map((ed) => {
          const a = nodes.find((n) => n.id === ed.from);
          const b = nodes.find((n) => n.id === ed.to);
          if (!a || !b) return null;
          const pts = routed.get(ed.id) ?? avoidRoute(a, b, ed, nodes); // 预路由(含分车道)优先
          const d = ed.style === 'curve'
            ? smoothPath([straightRoute(a, b)[0]!, ...(ed.points ?? []), straightRoute(a, b)[1]!])
            : ed.style === 'straight' && !ed.points?.length ? `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}` : roundedPath(pts);
          const on = selEdge === ed.id;
          const arrow = ed.arrow ?? 'classic';
          return (
            <g key={ed.id}>
              <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); setSelEdge(ed.id); setSelIds(new Set()); }} />
              <path d={d} fill="none" stroke={on ? 'var(--accent)' : ed.color ?? '#5f6673'} strokeWidth={on ? (ed.width ?? 1.5) + 0.5 : ed.width ?? 1.5} strokeDasharray={ed.dash ? '6 4' : undefined} markerEnd={arrow === 'none' ? undefined : `url(#m-${arrow})`} style={{ pointerEvents: 'none' }} />
              {ed.label ? (() => { const mi = Math.max(1, Math.floor(pts.length / 2)); const p1 = pts[mi - 1]!, p2 = pts[mi]!; return <text x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 6} className="bedge-label">{ed.label}</text>; })() : null}
            </g>
          );
        });
      })()}
        {/* 选中边的手柄(端点/航点/虚拟折点)移到节点之上的覆盖层 board-overlay,避免被节点 div 遮挡 */}
        {conn
          ? (() => {
              const a = nodes.find((n) => n.id === conn.from);
              if (!a) return null;
              const tgt = conn.tgt ? nodes.find((n) => n.id === conn.tgt) : null;
              if (tgt) return <path d={roundedPath(ortho(a, tgt))} fill="none" stroke="#16a34a" strokeWidth={2} strokeDasharray="6 3" markerEnd="url(#otterpatch-arr-sel)" />;
              const p1 = perim(a, conn.x, conn.y);
              return <line x1={p1.x} y1={p1.y} x2={conn.x} y2={conn.y} stroke="var(--accent)" strokeWidth={1.6} strokeDasharray="5 3" markerEnd="url(#otterpatch-arr-sel)" />;
            })()
          : null}
        {guides ? (
          <g stroke="#ff5a5a" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }}>
            {guides.v.map((vx, i) => (
              <line key={'v' + i} x1={vx} y1={0} x2={vx} y2={6000} />
            ))}
            {guides.h.map((hy, i) => (
              <line key={'h' + i} x1={0} y1={hy} x2={6000} y2={hy} />
            ))}
          </g>
        ) : null}
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
        {selEdge
          ? (() => {
              const ed = edges.find((x) => x.id === selEdge);
              const a = ed && nodes.find((n) => n.id === ed.from);
              const b = ed && nodes.find((n) => n.id === ed.to);
              if (!ed || !a || !b) return null;
              const pts = edgePts(a, b, ed.style, ed.points);
              const s = pts[0]!;
              const e2 = pts[pts.length - 1]!;
              const wps = ed.points ?? [];
              const ctrl = controlPoints(a, b, wps);
              const removeWp = (i: number): void => {
                commit();
                setEdges((es) => es.map((x) => (x.id === ed.id ? { ...x, points: wps.length > 1 ? wps.filter((_, k) => k !== i) : undefined } : x)));
              };
              const addWpAt = (segIdx: number, p: XY, e: { stopPropagation: () => void; pointerId: number }): void => {
                e.stopPropagation();
                capture(e);
                beginGesture();
                movedRef.current = true;
                const np = [...wps];
                np.splice(segIdx, 0, { x: snap(p.x), y: snap(p.y) });
                setEdges((es) => es.map((x) => (x.id === ed.id ? { ...x, points: np } : x)));
                setWpDrag({ edgeId: ed.id, index: segIdx });
              };
              const epStart = (end: 'from' | 'to', e: { stopPropagation: () => void; pointerId: number }): void => {
                e.stopPropagation();
                capture(e);
                beginGesture();
                setEpDrag({ edgeId: ed.id, end, tgt: null });
              };
              return (
                <g>
                  <g style={{ cursor: 'pointer', pointerEvents: 'all' }} onPointerDown={(e) => epStart('from', e)}>
                    <circle cx={s.x} cy={s.y} r={9} fill="transparent" />
                    <circle cx={s.x} cy={s.y} r={5} fill="#fff" stroke="var(--accent)" strokeWidth={2} />
                  </g>
                  <g style={{ cursor: 'pointer', pointerEvents: 'all' }} transform={`translate(${e2.x},${e2.y})`} onPointerDown={(e) => epStart('to', e)}>
                    <circle r={10} fill="transparent" />
                    <circle r={6} fill="#fff" stroke="#00c853" strokeWidth={1.5} />
                    <line x1={-3.4} y1={-3.4} x2={3.4} y2={3.4} stroke="#00c853" strokeWidth={2.2} strokeLinecap="round" />
                    <line x1={3.4} y1={-3.4} x2={-3.4} y2={3.4} stroke="#00c853" strokeWidth={2.2} strokeLinecap="round" />
                  </g>
                  {ctrl.slice(0, -1).map((c, i) => {
                    const q = ctrl[i + 1]!;
                    const mid = { x: (c.x + q.x) / 2, y: (c.y + q.y) / 2 };
                    return (
                      <g key={'vb' + i} style={{ cursor: 'crosshair', pointerEvents: 'all' }} onPointerDown={(e) => addWpAt(i, mid, e)}>
                        <circle cx={mid.x} cy={mid.y} r={10} fill="transparent" />
                        <circle cx={mid.x} cy={mid.y} r={4.5} fill="var(--accent)" fillOpacity={0.18} stroke="var(--accent)" strokeOpacity={0.65} strokeWidth={1.2} />
                      </g>
                    );
                  })}
                  {wps.map((p, i) => (
                    <circle
                      key={'wp' + i}
                      cx={p.x}
                      cy={p.y}
                      r={5}
                      fill="var(--accent)"
                      stroke="#fff"
                      strokeWidth={1.6}
                      style={{ cursor: 'move', pointerEvents: 'all' }}
                      onPointerDown={(e) => { e.stopPropagation(); capture(e); beginGesture(); setWpDrag({ edgeId: ed.id, index: i }); }}
                      onDoubleClick={(e) => { e.stopPropagation(); removeWp(i); }}
                    />
                  ))}
                </g>
              );
            })()
          : null}
      </svg>
      {band ? (() => { const r = bandRect(band); return <div className="band" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />; })() : null}
      </div>
      {selEdge
        ? (() => {
            const ed = edges.find((x) => x.id === selEdge);
            const a = ed && nodes.find((n) => n.id === ed.from);
            const b = ed && nodes.find((n) => n.id === ed.to);
            if (!ed || !a || !b) return null;
            const pts = edgePts(a, b, ed.style, ed.points);
            const mid = pts[Math.floor(pts.length / 2)] ?? pts[0]!;
            const setEdge = (patch: Partial<BEdge>): void => {
              commit();
              setEdges((es) => es.map((x) => (x.id === ed.id ? { ...x, ...patch } : x)));
            };
            return (
              <div className="etoolbar" style={{ left: mid.x * zoom + pan.x, top: mid.y * zoom + pan.y - 44 }} onPointerDown={(e) => e.stopPropagation()}>
                <button className={'etb' + (ed.style !== 'straight' ? ' on' : '')} title={t('正交')} onClick={() => setEdge({ style: 'ortho' })}>⌐</button>
                <button className={'etb' + (ed.style === 'straight' ? ' on' : '')} title={t('直线')} onClick={() => setEdge({ style: 'straight' })}>╱</button>
                <button className={'etb' + (ed.style === 'curve' ? ' on' : '')} title={t('曲线')} onClick={() => setEdge({ style: 'curve' })}>⌒</button>
                <span className="etb-sep" />
                <span className="etb-sep" />
                <button className={'etb' + (ed.dash ? ' on' : '')} title={t('虚线')} onClick={() => setEdge({ dash: !ed.dash })}>┄</button>
                <button className={'etb' + ((ed.width ?? 1.5) > 2 ? ' on' : '')} title={t('粗线')} onClick={() => setEdge({ width: (ed.width ?? 1.5) > 2 ? 1.5 : 2.5 })}>━</button>
                {['#5f6673', '#2563eb', '#16a34a', '#dc2626'].map((c) => (
                  <button key={c} className={'etb' + ((ed.color ?? '#5f6673') === c ? ' on' : '')} title={t('线色')} onClick={() => setEdge({ color: c })}><span className="etb-dot" style={{ background: c }} /></button>
                ))}
                <button className="etb" title={t('标签')} onClick={() => { const v = window.prompt(t('连线文字'), ed.label ?? ''); if (v != null) setEdge({ label: v }); }}>A</button>
                <span className="etb-sep" />
                {ARROWS.map((ak) => (
                  <button key={ak} className={'etb' + ((ed.arrow ?? 'classic') === ak ? ' on' : '')} title={t('箭头') + ' ' + ak} onClick={() => setEdge({ arrow: ak })}>
                    <svg width="20" height="12" viewBox="0 0 20 12">{arrowGlyph(ak)}</svg>
                  </button>
                ))}
              </div>
            );
          })()
        : null}
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
