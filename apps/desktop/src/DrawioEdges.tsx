import type { ReactNode } from 'react';
import { useT } from './i18n.js';
import {
  avoidRoute,
  controlPoints,
  edgePts,
  ortho,
  perim,
  roundedPath,
  smoothPath,
  straightRoute,
} from './drawio-geometry.js';
import type { ArrowKind, BEdge, BNode, XY } from './drawio-geometry.js';

export interface DrawioConnectionPreview {
  from: string;
  x: number;
  y: number;
  tgt: string | null;
}

export interface DrawioGuides {
  v: number[];
  h: number[];
}

export interface RoutedBoardEdge {
  edge: BEdge;
  points: XY[];
  path: string;
}

const ARROWS: ArrowKind[] = ['classic', 'open', 'diamond', 'circle', 'none'];

function arrowGlyph(arrow: ArrowKind): ReactNode {
  const endX = arrow === 'none' ? 18 : 11;
  const head =
    arrow === 'classic' ? <path d="M10,2 L17,6 L10,10 z" fill="currentColor" /> :
    arrow === 'open' ? <path d="M11,2.5 L17,6 L11,9.5" fill="none" stroke="currentColor" strokeWidth={1.3} /> :
    arrow === 'diamond' ? <path d="M9,6 L13,2.5 L17,6 L13,9.5 z" fill="currentColor" /> :
    arrow === 'circle' ? <circle cx="14" cy="6" r="2.6" fill="currentColor" /> :
    null;
  return (
    <g stroke="currentColor">
      <line x1={1} y1={6} x2={endX} y2={6} strokeWidth={1.3} />
      {head}
    </g>
  );
}

export function routeBoardEdges(nodes: BNode[], edges: BEdge[]): RoutedBoardEdge[] {
  const routed = new Map<string, XY[]>();
  const lanes = new Map<number, string[]>();

  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.from);
    const target = nodes.find((node) => node.id === edge.to);
    if (!source || !target || edge.style === 'curve') continue;
    const points = avoidRoute(source, target, edge, nodes);
    routed.set(edge.id, points);
    if (points.length === 4) {
      const vertical = Math.abs(points[1]!.x - points[2]!.x) < 0.5;
      const key = vertical ? Math.round(points[1]!.x / 20) : 100000 + Math.round(points[1]!.y / 20);
      lanes.set(key, [...(lanes.get(key) ?? []), edge.id]);
    }
  }

  for (const ids of lanes.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, index) => {
      const points = routed.get(id)!;
      const offset = (index - (ids.length - 1) / 2) * 10;
      if (Math.abs(points[1]!.x - points[2]!.x) < 0.5) {
        points[1] = { x: points[1]!.x + offset, y: points[1]!.y };
        points[2] = { x: points[2]!.x + offset, y: points[2]!.y };
      } else {
        points[1] = { x: points[1]!.x, y: points[1]!.y + offset };
        points[2] = { x: points[2]!.x, y: points[2]!.y + offset };
      }
    });
  }

  return edges.flatMap((edge) => {
    const source = nodes.find((node) => node.id === edge.from);
    const target = nodes.find((node) => node.id === edge.to);
    if (!source || !target) return [];
    const points = routed.get(edge.id) ?? avoidRoute(source, target, edge, nodes);
    const path = edge.style === 'curve'
      ? smoothPath([straightRoute(source, target)[0]!, ...(edge.points ?? []), straightRoute(source, target)[1]!])
      : edge.style === 'straight' && !edge.points?.length
        ? `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`
        : roundedPath(points);
    return [{ edge, points, path }];
  });
}

export function DrawioEdgeLayer({
  nodes,
  edges,
  selectedEdgeId,
  connection,
  guides,
  onSelect,
}: {
  nodes: BNode[];
  edges: BEdge[];
  selectedEdgeId: string | null;
  connection: DrawioConnectionPreview | null;
  guides: DrawioGuides | null;
  onSelect: (edgeId: string) => void;
}) {
  const routed = routeBoardEdges(nodes, edges);
  const source = connection ? nodes.find((node) => node.id === connection.from) : undefined;
  const target = connection?.tgt ? nodes.find((node) => node.id === connection.tgt) : undefined;
  return (
    <>
      <defs>
        <marker id="otterpatch-arr" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker>
        <marker id="otterpatch-arr-sel" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--accent)" /></marker>
        <marker id="m-classic" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker>
        <marker id="m-open" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M1,0.5 L8,4 L1,7.5" fill="none" stroke="context-stroke" strokeWidth="1.4" /></marker>
        <marker id="m-diamond" markerWidth="13" markerHeight="11" refX="9.5" refY="4" orient="auto"><path d="M0,4 L4.7,0.5 L9.4,4 L4.7,7.5 z" fill="context-stroke" /></marker>
        <marker id="m-circle" markerWidth="11" markerHeight="11" refX="7.6" refY="4" orient="auto"><circle cx="4" cy="4" r="3" fill="context-stroke" /></marker>
      </defs>
      {routed.map(({ edge, points, path }) => {
        const selected = selectedEdgeId === edge.id;
        const arrow = edge.arrow ?? 'classic';
        const middleIndex = Math.max(1, Math.floor(points.length / 2));
        const labelStart = points[middleIndex - 1]!;
        const labelEnd = points[middleIndex]!;
        return (
          <g key={edge.id}>
            <path d={path} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onPointerDown={(event) => { event.stopPropagation(); onSelect(edge.id); }} />
            <path d={path} fill="none" stroke={selected ? 'var(--accent)' : edge.color ?? '#5f6673'} strokeWidth={selected ? (edge.width ?? 1.5) + 0.5 : edge.width ?? 1.5} strokeDasharray={edge.dash ? '6 4' : undefined} markerEnd={arrow === 'none' ? undefined : `url(#m-${arrow})`} style={{ pointerEvents: 'none' }} />
            {edge.label ? <text x={(labelStart.x + labelEnd.x) / 2} y={(labelStart.y + labelEnd.y) / 2 - 6} className="bedge-label">{edge.label}</text> : null}
          </g>
        );
      })}
      {connection && source
        ? target
          ? <path d={roundedPath(ortho(source, target))} fill="none" stroke="#16a34a" strokeWidth={2} strokeDasharray="6 3" markerEnd="url(#otterpatch-arr-sel)" />
          : (() => {
              const start = perim(source, connection.x, connection.y);
              return <line x1={start.x} y1={start.y} x2={connection.x} y2={connection.y} stroke="var(--accent)" strokeWidth={1.6} strokeDasharray="5 3" markerEnd="url(#otterpatch-arr-sel)" />;
            })()
        : null}
      {guides ? (
        <g stroke="#ff5a5a" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }}>
          {guides.v.map((x, index) => <line key={'v' + index} x1={x} y1={0} x2={x} y2={6000} />)}
          {guides.h.map((y, index) => <line key={'h' + index} x1={0} y1={y} x2={6000} y2={y} />)}
        </g>
      ) : null}
    </>
  );
}

export function DrawioEdgeHandles({
  nodes,
  edge,
  onEndpointStart,
  onWaypointAdd,
  onWaypointStart,
  onWaypointRemove,
}: {
  nodes: BNode[];
  edge: BEdge | null;
  onEndpointStart: (edgeId: string, end: 'from' | 'to', pointerId: number) => void;
  onWaypointAdd: (edgeId: string, index: number, point: XY, pointerId: number) => void;
  onWaypointStart: (edgeId: string, index: number, pointerId: number) => void;
  onWaypointRemove: (edgeId: string, index: number) => void;
}) {
  const source = edge && nodes.find((node) => node.id === edge.from);
  const target = edge && nodes.find((node) => node.id === edge.to);
  if (!edge || !source || !target) return null;
  const points = edgePts(source, target, edge.style, edge.points);
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const waypoints = edge.points ?? [];
  const controls = controlPoints(source, target, waypoints);
  return (
    <g>
      <g style={{ cursor: 'pointer', pointerEvents: 'all' }} onPointerDown={(event) => { event.stopPropagation(); onEndpointStart(edge.id, 'from', event.pointerId); }}>
        <circle cx={start.x} cy={start.y} r={9} fill="transparent" />
        <circle cx={start.x} cy={start.y} r={5} fill="#fff" stroke="var(--accent)" strokeWidth={2} />
      </g>
      <g style={{ cursor: 'pointer', pointerEvents: 'all' }} transform={`translate(${end.x},${end.y})`} onPointerDown={(event) => { event.stopPropagation(); onEndpointStart(edge.id, 'to', event.pointerId); }}>
        <circle r={10} fill="transparent" />
        <circle r={6} fill="#fff" stroke="#00c853" strokeWidth={1.5} />
        <line x1={-3.4} y1={-3.4} x2={3.4} y2={3.4} stroke="#00c853" strokeWidth={2.2} strokeLinecap="round" />
        <line x1={3.4} y1={-3.4} x2={-3.4} y2={3.4} stroke="#00c853" strokeWidth={2.2} strokeLinecap="round" />
      </g>
      {controls.slice(0, -1).map((control, index) => {
        const next = controls[index + 1]!;
        const middle = { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
        return (
          <g key={'vb' + index} style={{ cursor: 'crosshair', pointerEvents: 'all' }} onPointerDown={(event) => { event.stopPropagation(); onWaypointAdd(edge.id, index, middle, event.pointerId); }}>
            <circle cx={middle.x} cy={middle.y} r={10} fill="transparent" />
            <circle cx={middle.x} cy={middle.y} r={4.5} fill="var(--accent)" fillOpacity={0.18} stroke="var(--accent)" strokeOpacity={0.65} strokeWidth={1.2} />
          </g>
        );
      })}
      {waypoints.map((point, index) => (
        <circle
          key={'wp' + index}
          cx={point.x}
          cy={point.y}
          r={5}
          fill="var(--accent)"
          stroke="#fff"
          strokeWidth={1.6}
          style={{ cursor: 'move', pointerEvents: 'all' }}
          onPointerDown={(event) => { event.stopPropagation(); onWaypointStart(edge.id, index, event.pointerId); }}
          onDoubleClick={(event) => { event.stopPropagation(); onWaypointRemove(edge.id, index); }}
        />
      ))}
    </g>
  );
}

export function DrawioEdgeToolbar({
  nodes,
  edge,
  zoom,
  pan,
  onChange,
}: {
  nodes: BNode[];
  edge: BEdge | null;
  zoom: number;
  pan: XY;
  onChange: (edgeId: string, patch: Partial<BEdge>) => void;
}) {
  const t = useT();
  const source = edge && nodes.find((node) => node.id === edge.from);
  const target = edge && nodes.find((node) => node.id === edge.to);
  if (!edge || !source || !target) return null;
  const points = edgePts(source, target, edge.style, edge.points);
  const middle = points[Math.floor(points.length / 2)] ?? points[0]!;
  const change = (patch: Partial<BEdge>): void => onChange(edge.id, patch);
  return (
    <div className="etoolbar" style={{ left: middle.x * zoom + pan.x, top: middle.y * zoom + pan.y - 44 }} onPointerDown={(event) => event.stopPropagation()}>
      <button className={'etb' + (edge.style !== 'straight' ? ' on' : '')} title={t('正交')} onClick={() => change({ style: 'ortho' })}>⌐</button>
      <button className={'etb' + (edge.style === 'straight' ? ' on' : '')} title={t('直线')} onClick={() => change({ style: 'straight' })}>╱</button>
      <button className={'etb' + (edge.style === 'curve' ? ' on' : '')} title={t('曲线')} onClick={() => change({ style: 'curve' })}>⌒</button>
      <span className="etb-sep" />
      <span className="etb-sep" />
      <button className={'etb' + (edge.dash ? ' on' : '')} title={t('虚线')} onClick={() => change({ dash: !edge.dash })}>┄</button>
      <button className={'etb' + ((edge.width ?? 1.5) > 2 ? ' on' : '')} title={t('粗线')} onClick={() => change({ width: (edge.width ?? 1.5) > 2 ? 1.5 : 2.5 })}>━</button>
      {['#5f6673', '#2563eb', '#16a34a', '#dc2626'].map((color) => (
        <button key={color} className={'etb' + ((edge.color ?? '#5f6673') === color ? ' on' : '')} title={t('线色')} onClick={() => change({ color })}><span className="etb-dot" style={{ background: color }} /></button>
      ))}
      <button className="etb" title={t('标签')} onClick={() => { const value = window.prompt(t('连线文字'), edge.label ?? ''); if (value != null) change({ label: value }); }}>A</button>
      <span className="etb-sep" />
      {ARROWS.map((arrow) => (
        <button key={arrow} className={'etb' + ((edge.arrow ?? 'classic') === arrow ? ' on' : '')} title={t('箭头') + ' ' + arrow} onClick={() => change({ arrow })}>
          <svg width="20" height="12" viewBox="0 0 20 12">{arrowGlyph(arrow)}</svg>
        </button>
      ))}
    </div>
  );
}
