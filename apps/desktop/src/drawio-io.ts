import { inflateSync, strFromU8 } from 'fflate';
import { parseDrawioStyle, innerForStyle, cleanLabel } from './DrawioBoard.js';
import type { BEdge, BNode } from './drawio-geometry.js';
import { styleToKind } from './shape-engine.js';

const unesc = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface DecodedPage { name: string; xml: string }
export type DrawioSourceEncoding = 'uncompressed' | 'compressed';
export interface DrawioImportResult { pages: Array<{ name: string; nodes: BNode[]; edges: BEdge[] }>; skipped: Array<{ name: string; reason: string }>; total: number; sourceEncoding: DrawioSourceEncoding }

function decodeBase64(s: string): string {
  if (typeof atob === 'function') return atob(s);
  return Buffer.from(s, 'base64').toString('binary');
}

function diagramPages(text: string): { pages: DecodedPage[]; skipped: Array<{ name: string; reason: string }>; total: number; sourceEncoding: DrawioSourceEncoding } {
  if (!/<diagram/i.test(text)) return { pages: [{ name: 'Page-1', xml: text }], skipped: [], total: 1, sourceEncoding: 'uncompressed' };
  const pages: DecodedPage[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  let total = 0;
  let compressed = false;
  for (const m of text.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/gi)) {
    total++;
    const name = unesc(/name="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? `Page-${total}`);
    const inner = m[2] ?? '';
    if (/<mxGraphModel/i.test(inner)) { pages.push({ name, xml: inner }); continue; }
    compressed = true;
    try {
      const bin = decodeBase64(inner.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      pages.push({ name, xml: decodeURIComponent(strFromU8(inflateSync(bytes))) });
    } catch (err) {
      skipped.push({ name, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { pages, skipped, total, sourceEncoding: compressed ? 'compressed' : 'uncompressed' };
}

interface RawCell { id: string; value: string; style: string; vertex: boolean; edge: boolean; parent: string; source: string; target: string; x: number; y: number; w: number; h: number; points: Array<{ x: number; y: number }> }

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = unesc(m[2]!);
  return out;
}

export function parseDrawioFile(text: string): DrawioImportResult {
  const decoded = diagramPages(text);
  return { pages: decoded.pages.map((pg) => ({ name: pg.name, ...parseDrawio(pg.xml) })), skipped: decoded.skipped, total: decoded.total, sourceEncoding: decoded.sourceEncoding };
}

export function parseDrawioPages(text: string): Array<{ name: string; nodes: BNode[]; edges: BEdge[] }> {
  return parseDrawioFile(text).pages;
}

export function parseDrawio(text: string): { nodes: BNode[]; edges: BEdge[] } {
  const xml = /<diagram/i.test(text) ? (diagramPages(text).pages[0]?.xml ?? '') : text;
  const cells: RawCell[] = [];
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
        style: /curved=1/.test(st) ? 'curve' : /edgeStyle=/.test(st) ? 'ortho' : 'straight',
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
    const st = [e.style === 'curve' ? 'curved=1' : 'edgeStyle=orthogonalEdgeStyle', 'rounded=1', 'html=1', `endArrow=${ARROW_OUT[e.arrow ?? 'classic'] ?? 'classic'}`, ...(e.dash ? ['dashed=1'] : []), ...(e.color ? ['strokeColor=' + e.color] : []), ...(e.width ? ['strokeWidth=' + e.width] : [])].join(';') + ';';
    const pts = e.points?.length ? `<Array as="points">${e.points.map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`).join('')}</Array>` : '';
    cells.push(`<mxCell id="${esc(e.id)}" value="${esc(e.label ?? '')}" style="${esc(st)}" edge="1" parent="1" source="${esc(e.from)}" target="${esc(e.to)}"><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`);
  }
  return `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0"><root>${cells.join('')}</root></mxGraphModel>`;
}

export function serializeDrawio(pages: Array<{ name: string; nodes: BNode[]; edges: BEdge[] }>): string {
  const body = pages.map((pg, i) => `<diagram id="d${i + 1}" name="${esc(pg.name || 'Page-' + (i + 1))}">${pageModelXml(pg.nodes, pg.edges)}</diagram>`).join('');
  return `<mxfile host="otterpatch" modified="1970-01-01T00:00:00Z" version="1.0">${body}</mxfile>`;
}
