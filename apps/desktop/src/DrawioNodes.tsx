import { useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useT } from './i18n.js';
import { shapeSvg, styleToKind } from './shape-engine.js';
import type { BNode } from './drawio-geometry.js';

export type DrawioDirection = 'up' | 'right' | 'down' | 'left';

export interface DrawioNodePointer {
  pointerId: number;
  clientX: number;
  clientY: number;
  shiftKey: boolean;
}

const HANDLES = [
  { key: 'nw', x: 0, y: 0 }, { key: 'n', x: 0.5, y: 0 }, { key: 'ne', x: 1, y: 0 },
  { key: 'e', x: 1, y: 0.5 }, { key: 'se', x: 1, y: 1 }, { key: 's', x: 0.5, y: 1 },
  { key: 'sw', x: 0, y: 1 }, { key: 'w', x: 0, y: 0.5 },
];
const PORTS = [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];
const DIRECTIONS: DrawioDirection[] = ['up', 'right', 'down', 'left'];

const pointerData = (event: ReactPointerEvent): DrawioNodePointer => ({
  pointerId: event.pointerId,
  clientX: event.clientX,
  clientY: event.clientY,
  shiftKey: event.shiftKey,
});

export function isContainerNode(node: BNode, nodes: BNode[]): boolean {
  return !!node.vTop || (!node.text && nodes.some((candidate) =>
    candidate.id !== node.id
    && candidate.x >= node.x
    && candidate.y >= node.y
    && candidate.x + candidate.w <= node.x + node.w
    && candidate.y + candidate.h <= node.y + node.h
    && candidate.w * candidate.h < node.w * node.h * 0.8));
}

function DrawioNodeShape({ node }: { node: BNode }) {
  const shape = node.shape ?? styleToKind(node.style);
  if (node.text) return null;
  if (shape) {
    const width = Math.max(8, node.w);
    const height = Math.max(8, node.h);
    return <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} fill={node.fill ?? '#ffffff'} stroke={node.stroke ?? '#9aa3b2'} strokeWidth={1.3} dangerouslySetInnerHTML={{ __html: shapeSvg(shape, width, height) }} />;
  }
  if ((node.fill || node.stroke || node.kind === 'agent') && (!node.inner || /^<rect/.test(node.inner))) {
    return <div className="bnode-box" style={{ background: node.fill ?? '#ffffff', borderColor: node.stroke ?? '#9aa3b2' }} />;
  }
  if (node.fill || node.stroke || node.kind === 'agent') {
    return <svg viewBox="3 3 34 24" preserveAspectRatio="none" fill={node.fill ?? '#ffffff'} stroke={node.stroke ?? '#9aa3b2'} strokeWidth={0.9} dangerouslySetInnerHTML={{ __html: node.inner }} />;
  }
  return <svg viewBox="3 3 34 24" preserveAspectRatio="none" fill="none" stroke="#3a3f4b" strokeWidth={0.9} dangerouslySetInnerHTML={{ __html: node.inner }} />;
}

export function DrawioNodeLayer({
  nodes,
  selectedIds,
  targetNodeId,
  highlightedId,
  editingId,
  portsEnabled,
  quickConnectEnabled,
  onNodeStart,
  onEditStart,
  onLabelCommit,
  onPortStart,
  onResizeStart,
  onRotateStart,
  onArrowStart,
}: {
  nodes: BNode[];
  selectedIds: ReadonlySet<string>;
  targetNodeId: string | null;
  highlightedId: string | null;
  editingId: string | null;
  portsEnabled: boolean;
  quickConnectEnabled: boolean;
  onNodeStart: (node: BNode, pointer: DrawioNodePointer) => void;
  onEditStart: (nodeId: string) => void;
  onLabelCommit: (nodeId: string, label: string) => void;
  onPortStart: (node: BNode, pointer: DrawioNodePointer) => void;
  onResizeStart: (node: BNode, handle: string, pointer: DrawioNodePointer) => void;
  onRotateStart: (node: BNode, pointerId: number) => void;
  onArrowStart: (node: BNode, direction: DrawioDirection, pointer: DrawioNodePointer) => void;
}) {
  const t = useT();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  return (
    <>
      {nodes.map((node) => {
        const selected = selectedIds.has(node.id);
        const hovered = hoveredId === node.id;
        const target = targetNodeId === node.id;
        const container = isContainerNode(node, nodes);
        return (
          <div
            key={node.id}
            className={'bnode' + (selected ? ' sel' : '') + (hovered && !selected ? ' hover' : '') + (target ? ' tgt' : '') + (node.id === highlightedId ? ' hi' : '')}
            style={{ left: node.x, top: node.y, width: node.w, height: node.h, ...(node.rot ? { transform: `rotate(${node.rot}deg)` } : {}) }}
            onPointerEnter={() => setHoveredId(node.id)}
            onPointerLeave={() => setHoveredId((current) => current === node.id ? null : current)}
            onPointerDown={(event) => { event.stopPropagation(); onNodeStart(node, pointerData(event)); }}
            onDoubleClick={(event) => { event.stopPropagation(); onEditStart(node.id); }}
          >
            <DrawioNodeShape node={node} />
            {editingId === node.id ? (
              <input
                className="bnode-edit"
                autoFocus
                defaultValue={node.label}
                onBlur={(event) => onLabelCommit(node.id, event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
                onPointerDown={(event) => event.stopPropagation()}
              />
            ) : (
              <span className={'bnode-label' + (node.text ? ' txt' : '') + (container && !node.text ? ' top' : '') + (node.wrap ? ' wrap' : '')} style={{ ...(node.fontColor ? { color: node.fontColor } : {}), ...(node.fontSize ? { fontSize: node.fontSize } : {}), ...(node.bold ? { fontWeight: 700 } : {}) }}>{node.label}</span>
            )}
            {(hovered || selected) && portsEnabled
              ? PORTS.map((port, index) => (
                  <span
                    key={index}
                    className="bport"
                    style={{ left: `${port.x * 100}%`, top: `${port.y * 100}%` }}
                    onPointerDown={(event) => { event.stopPropagation(); onPortStart(node, pointerData(event)); }}
                  />
                ))
              : null}
            {selected && selectedIds.size === 1
              ? HANDLES.map((handle) => (
                  <span
                    key={handle.key}
                    className={'bhandle h-' + handle.key}
                    style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%` }}
                    onPointerDown={(event) => { event.stopPropagation(); onResizeStart(node, handle.key, pointerData(event)); }}
                  />
                ))
              : null}
            {selected && selectedIds.size === 1 ? (
              <span
                className="brot"
                title={t('拖动旋转,按住 Shift 吸附 15°')}
                onPointerDown={(event) => { event.stopPropagation(); onRotateStart(node, event.pointerId); }}
              >
                ↻
              </span>
            ) : null}
            {hovered && quickConnectEnabled
              ? DIRECTIONS.map((direction) => (
                  <span
                    key={direction}
                    className={'barrow ba-' + direction}
                    title={t('点=克隆并连接,拖=连线')}
                    onPointerDown={(event) => { event.stopPropagation(); onArrowStart(node, direction, pointerData(event)); }}
                  />
                ))
              : null}
          </div>
        );
      })}
    </>
  );
}
