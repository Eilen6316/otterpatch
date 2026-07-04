/**
 * drawio-io — 标准 .drawio(mxGraphModel XML)与画板 BNode/BEdge 的双向转换。
 * hero loop:用户把真实 .drawio 拖进来 → Agent 改 → 导出仍是标准 .drawio(可回 drawio 打开)。
 * 解析走正则(不依赖 DOMParser,Node 侧也可测);压缩 diagram(base64+deflateRaw+URI 编码)用 fflate 解。
 */
import { inflateSync, strFromU8 } from 'fflate';
import { parseDrawioStyle, innerForStyle, cleanLabel, type BNode, type BEdge } from './DrawioBoard.js';
import { styleToKind } from './shape-engine.js';

const unesc = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 解出全部 diagram 页(兼容未压缩与经典压缩两种保存格式)。 */
function diagramPages(text: string): Array<{ name: string; xml: string }> {
  if (!/<diagram/i.test(text)) return [{ name: 'Page-1', xml: text }]; // 裸 mxGraphModel
  const out: Array<{ name: string; xml: string }> = [];
  for (const m of text.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/gi)) {
    const name = /name="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? `Page-${out.length + 1}`;
    const inner = m[2] ?? '';
    if (/<mxGraphModel/i.test(inner)) { out.push({ name: unesc(name), xml: inner }); continue; }
    // 经典压缩:base64 → inflateRaw → URI 解码
    try {
      const bin = atob(inner.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      out.push({ name: unesc(name), xml: decodeURIComponent(strFromU8(inflateSync(bytes))) });
    } catch { /* 该页解不开就跳过 */ }
  }
  return out;
}

interface RawCell { id: string; value: string; style: string; vertex: boolean; edge: boolean; parent: string; source: string; target: string; x: number; y: number; w: number; h: number; points: Array<{ x: number; y: number }> }

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = unesc(m[2]!);
  return out;
}

/** .drawio 文本 → 多页画板对象(每个 diagram 一页)。 */
export function parseDrawioPages(text: string): Array<{ name: string; nodes: BNode[]; edges: BEdge[] }> {
  return diagramPages(text).map((pg) => ({ name: pg.name, ...parseDrawio(pg.xml) }));
}

/** 单份 mxGraphModel XML → 画板对象。parent 相对坐标换算为绝对;边的 endArrow/dashed/strokeColor/航点保真。 */
export function parseDrawio(text: string): { nodes: BNode[]; edges: BEdge[] } {
  const xml = /<diagram/i.test(text) ? (diagramPages(text)[0]?.xml ?? '') : text;
  const cells: RawCell[] = [];
  // mxCell 可能自闭合(无 geometry)或包 <mxGeometry …>(可含 <mxPoint> 航点)
  for (const m of xml.matchAll(/<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g)) {
    const a = attrs(m[1] ?? '');
    const body = m[2] ?? '';
    const g = /<mxGeometry\b([^>]*)/.exec(body);
    const ga = g ? attrs(g[1] ?? '') : {};
    const points = [...body.matchAll(/<mxPoint\b([^>]*)/g)]
      .map((p) => attrs(p[1] ?? ''))
      .filter((p) => p.as !== 'sourcePoint' && p.as !== 'targetPoint' && p.x != null && p.y != null)
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    cells.push({
      id: a.id ?? '', value: a.value ?? '', style: a.style ?? '', vertex: a.vertex === '1', edge: a.edge === '1',
      parent: a.parent ?? '1', source: a.source ?? '', target: a.target ?? '',
      x: Number(ga.x ?? 0), y: Number(ga.y ?? 0), w: Number(ga.width ?? 120), h: Number(ga.height ?? 48), points,
    });
  }
  const byId = new Map(cells.map((c) => [c.id, c]));
  const absOf = (c: RawCell, depth = 0): { x: number; y: number } => {
    const par = byId.get(c.parent);
    if (!par || !par.vertex || depth > 8) return { x: c.x, y: c.y };
    const pa = absOf(par, depth + 1);
    return { x: c.x + pa.x, y: c.y + pa.y };
  };
  const nodes: BNode[] = [];
  const edges: BEdge[] = [];
  for (const c of cells) {
    if (c.edge && c.source && c.target) {
      const st = c.style;
      edges.push({
        id: c.id, from: c.source, to: c.target,
        arrow: /endArrow=none/.test(st) ? 'none' : /endArrow=open/.test(st) ? 'open' : /endArrow=diamond/.test(st) ? 'diamond' : /endArrow=oval/.test(st) ? 'circle' : 'classic',
        style: /edgeStyle=/.test(st) ? 'ortho' : 'straight',
        ...(c.points.length ? { points: c.points } : {}),
        ...(/dashed=1/.test(st) ? { dash: true } : {}),
        ...(/strokeColor=([^;]+)/.exec(st)?.[1] ? { color: /strokeColor=([^;]+)/.exec(st)![1]! } : {}),
        ...(c.value ? { label: cleanLabel(c.value) } : {}),
      });
    } else if (c.vertex && c.id !== '0' && c.id !== '1') {
      const abs = absOf(c);
      const st = parseDrawioStyle(c.style);
      nodes.push({ id: c.id, x: abs.x, y: abs.y, w: c.w, h: c.h, inner: innerForStyle(c.style), label: cleanLabel(c.value), kind: st.text ? 'text' : 'agent', style: c.style, ...(styleToKind(c.style) ? { shape: styleToKind(c.style)! } : {}), ...st });
    }
  }
  return { nodes, edges };
}

/** 画板节点 style 兜底合成(手工建的节点没有原始 style 串)。 */
function nodeStyle(n: BNode): string {
  if (n.style) return n.style;
  const parts = ['rounded=1', 'whiteSpace=wrap', 'html=1'];
  if (n.fill) parts.push('fillColor=' + n.fill);
  if (n.stroke) parts.push('strokeColor=' + n.stroke);
  if (n.fontColor) parts.push('fontColor=' + n.fontColor);
  if (n.fontSize) parts.push('fontSize=' + n.fontSize);
  if (n.bold) parts.push('fontStyle=1');
  if (n.text) parts.unshift('text');
  if (n.vTop) parts.push('verticalAlign=top');
  return parts.join(';') + ';';
}

const ARROW_OUT: Record<string, string> = { classic: 'classic', open: 'open', diamond: 'diamond', circle: 'oval', none: 'none' };

function pageModelXml(nodes: BNode[], edges: BEdge[]): string {
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  for (const n of nodes) {
    cells.push(`<mxCell id="${esc(n.id)}" value="${esc(n.label)}" style="${esc(nodeStyle(n))}" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" as="geometry"/></mxCell>`);
  }
  for (const e of edges) {
    const st = [`edgeStyle=orthogonalEdgeStyle`, 'rounded=1', 'html=1', `endArrow=${ARROW_OUT[e.arrow ?? 'classic'] ?? 'classic'}`, ...(e.dash ? ['dashed=1'] : []), ...(e.color ? ['strokeColor=' + e.color] : []), ...(e.width ? ['strokeWidth=' + e.width] : [])].join(';') + ';';
    const pts = e.points?.length ? `<Array as="points">${e.points.map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`).join('')}</Array>` : '';
    cells.push(`<mxCell id="${esc(e.id)}" value="${esc(e.label ?? '')}" style="${esc(st)}" edge="1" parent="1" source="${esc(e.from)}" target="${esc(e.to)}"><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`);
  }
  return `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0"><root>${cells.join('')}</root></mxGraphModel>`;
}

/** 画板(多页) → 标准 .drawio(未压缩 mxfile,每页一个 diagram,drawio 可直接打开)。 */
export function serializeDrawio(pages: Array<{ name: string; nodes: BNode[]; edges: BEdge[] }>): string {
  const body = pages.map((pg, i) => `<diagram id="d${i + 1}" name="${esc(pg.name || 'Page-' + (i + 1))}">${pageModelXml(pg.nodes, pg.edges)}</diagram>`).join('');
  return `<mxfile host="otterpatch" modified="1970-01-01T00:00:00Z" version="1.0">${body}</mxfile>`;
}
