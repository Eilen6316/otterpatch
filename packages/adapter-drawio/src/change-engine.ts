import {
  type BoxRect,
  type CapabilitySet,
  type ChangeSet,
  type ChangeSetEngine,
  type DiffNode,
  type DiffNodeId,
  type DiffView,
  type DocRev,
  type Edit,
  type EditId,
  type EditOp,
  type HostId,
  type LogicalAnchor,
  type MutationLog,
  type PreviewValue,
  type ShadowResult,
  type ValidationReport,
} from '@otterpatch/core';
import { buildDrawioVerifier, type DrawioVerificationSnapshot } from './verify.js';

export interface DrawioShadowObject {
  id: string;
  kind: 'node' | 'edge';
  parent?: string;
  source?: string;
  target?: string;
  box: BoxRect;
  props: Record<string, unknown>;
}

export type DrawioShadow = Map<string, DrawioShadowObject>;

const SUPPORTED = new Set(['setValue', 'setObjectProps', 'moveObject', 'addObject', 'deleteObject']);

export class DrawioSimulationError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'DrawioSimulationError';
  }
}

export function drawioShadowFromSnapshot(snapshot: DrawioVerificationSnapshot): DrawioShadow {
  const shadow: DrawioShadow = new Map();
  for (const node of snapshot.nodes) {
    shadow.set(node.id, {
      id: node.id,
      kind: 'node',
      ...(node.parent ? { parent: node.parent } : {}),
      box: box(node.x, node.y, node.width, node.height),
      props: { id: node.id, kind: 'node' },
    });
  }
  for (const edge of snapshot.edges) {
    shadow.set(edge.id, {
      id: edge.id,
      kind: 'edge',
      source: edge.source,
      target: edge.target,
      ...(edge.parent ? { parent: edge.parent } : {}),
      box: box(),
      props: { id: edge.id, kind: 'edge', source: edge.source, target: edge.target },
    });
  }
  return shadow;
}

export class DrawioChangeSetEngine implements ChangeSetEngine<DrawioShadow> {
  validate(cs: ChangeSet, caps: CapabilitySet): ValidationReport {
    const issues: ValidationReport['issues'] = [];
    for (const edit of cs.edits) {
      const capability = caps.supports({ op: edit.op.kind });
      if (!capability.ok || !SUPPORTED.has(edit.op.kind)) {
        issues.push({ editId: edit.id, code: 'unsupported', message: capability.ok ? `drawio does not simulate ${edit.op.kind}` : capability.reason });
      }
      const anchor = cs.anchors[edit.target];
      if (!anchor || anchor.portable.kind !== 'object') {
        issues.push({ editId: edit.id, code: 'anchor-broken', message: 'drawio edits require object anchors' });
      }
    }
    return { ok: issues.length === 0, issues };
  }

  async shadowApply(cs: ChangeSet, shadow: DrawioShadow): Promise<ShadowResult> {
    const verification = buildDrawioVerifier(snapshotFromShadow(shadow))(cs);
    if (!verification.ok) {
      throw new DrawioSimulationError(verification.code ?? 'VERIFIER_SIMULATION_FAILED', verification.report, verification.details);
    }

    const capturedInverse: Record<EditId, EditOp> = {};
    const children: DiffNode[] = [];
    let firstAnchor: LogicalAnchor | undefined;
    for (const [index, edit] of cs.edits.entries()) {
      const anchor = cs.anchors[edit.target];
      if (!anchor || anchor.portable.kind !== 'object') {
        throw new DrawioSimulationError('VERIFIER_INVALID_TARGET', `edit ${edit.id} does not target a drawio object`);
      }
      firstAnchor ??= anchor;
      const targetId = anchor.portable.elementId;
      const beforeObject = shadow.get(targetId);
      const before = beforeObject ? objectPreview(beforeObject) : missingPreview(targetId);
      const { afterObject, inverse, badge } = applyEdit(shadow, edit, targetId);
      if (inverse) capturedInverse[edit.id] = inverse;
      children.push({
        id: (`drawio-${edit.id}-${index}`) as DiffNodeId,
        level: 'leaf',
        anchor,
        editIds: [edit.id],
        before,
        after: afterObject ? objectPreview(afterObject) : deletedPreview(beforeObject, targetId),
        children: [],
        render: { badge, label: afterObject?.id ?? targetId },
        state: 'pending',
      });
    }

    const rootAnchor = firstAnchor ?? fallbackAnchor(cs);
    const root: DiffNode = {
      id: 'root' as DiffNodeId,
      level: 'batch',
      anchor: rootAnchor,
      editIds: cs.edits.map((edit) => edit.id),
      before: missingPreview('batch'),
      after: missingPreview('batch'),
      children,
      render: { badge: 'modify', label: cs.meta.intent },
      state: 'pending',
    };
    const diff: DiffView = { changeSetId: cs.id, hostId: cs.hostId, root, conflicts: [] };
    return { afterRev: (Number(cs.baseRev) + 1) as DocRev, diff, capturedInverse, effects: {} };
  }

  invert(cs: ChangeSet, applied: ShadowResult): ChangeSet {
    const edits: Edit[] = [...cs.edits].reverse().flatMap((edit) => {
      const inverse = applied.capturedInverse[edit.id];
      return inverse ? [{ ...edit, id: `${edit.id}:inverse`, op: inverse, inverse: edit.op }] : [];
    });
    return { ...cs, id: `${cs.id}:inverse`, edits };
  }

  rebase(cs: ChangeSet, _log: MutationLog, target: DocRev): { cs: ChangeSet; broken: EditId[] } {
    const anchors = Object.fromEntries(Object.entries(cs.anchors).map(([id, anchor]) => [id, { ...anchor, baseRev: target }]));
    // Mutation payloads are host-opaque here. Without a live AnchorService, any intervening
    // mutation is conservatively reported as broken instead of claiming an unsafe identity rebase.
    return { cs: { ...cs, baseRev: target, anchors }, broken: _log.length ? cs.edits.map((edit) => edit.id) : [] };
  }
}

function applyEdit(
  shadow: DrawioShadow,
  edit: Edit,
  targetId: string,
): { afterObject?: DrawioShadowObject; inverse?: EditOp; badge: 'add' | 'remove' | 'modify' | 'move' } {
  if (edit.op.kind === 'addObject') {
    const payload = record(edit.op.payload);
    const id = stringProp(payload, 'id');
    if (!id) throw new DrawioSimulationError('VERIFIER_INVALID_OBJECT_ID', `edit ${edit.id} addObject requires an id`);
    const geometry = record(payload.geometry);
    const edge = payload.edge === true || typeof payload.source === 'string' || typeof payload.target === 'string';
    const next: DrawioShadowObject = {
      id,
      kind: edge ? 'edge' : 'node',
      ...(stringProp(payload, 'parent') ? { parent: stringProp(payload, 'parent')! } : {}),
      ...(stringProp(payload, 'source') ? { source: stringProp(payload, 'source')! } : {}),
      ...(stringProp(payload, 'target') ? { target: stringProp(payload, 'target')! } : {}),
      box: box(numberProp(geometry, 'x'), numberProp(geometry, 'y'), numberProp(geometry, 'width'), numberProp(geometry, 'height')),
      props: {
        id,
        kind: edge ? 'edge' : 'node',
        ...(typeof payload.value === 'string' ? { value: payload.value } : {}),
        ...(typeof payload.style === 'string' ? { style: payload.style } : {}),
      },
    };
    shadow.set(id, next);
    return { afterObject: next, inverse: { family: 'object', kind: 'deleteObject' }, badge: 'add' };
  }

  const current = shadow.get(targetId);
  if (!current) throw new DrawioSimulationError('VERIFIER_TARGET_NOT_FOUND', `drawio object ${targetId} was not found`);
  if (edit.op.kind === 'deleteObject') {
    removeCascade(shadow, targetId);
    return { badge: 'remove' };
  }
  if (edit.op.kind === 'moveObject') {
    const prior = { ...current.box };
    current.box = {
      left: edit.op.box.left ?? current.box.left,
      top: edit.op.box.top ?? current.box.top,
      width: edit.op.box.width ?? current.box.width,
      height: edit.op.box.height ?? current.box.height,
      rotate: edit.op.box.rotate ?? current.box.rotate,
    };
    return { afterObject: current, inverse: { family: 'object', kind: 'moveObject', box: prior }, badge: 'move' };
  }
  if (edit.op.kind === 'setValue') {
    const prior = typeof current.props.value === 'string' ? current.props.value : null;
    current.props = { ...current.props, value: String(edit.op.value ?? '') };
    return { afterObject: current, inverse: { family: 'value', kind: 'setValue', value: prior }, badge: 'modify' };
  }
  if (edit.op.kind === 'setObjectProps') {
    const next: Record<string, unknown> = {};
    const inverse: Record<string, unknown> = {};
    let reversible = true;
    for (const key of ['value', 'style'] as const) {
      if (!Object.prototype.hasOwnProperty.call(edit.op.props, key)) continue;
      next[key] = edit.op.props[key];
      if (Object.prototype.hasOwnProperty.call(current.props, key)) inverse[key] = current.props[key];
      else reversible = false;
    }
    current.props = { ...current.props, ...next };
    return {
      afterObject: current,
      ...(reversible ? { inverse: { family: 'object', kind: 'setObjectProps', props: inverse } as EditOp } : {}),
      badge: 'modify',
    };
  }
  throw new DrawioSimulationError('VERIFIER_UNSUPPORTED_OPERATION', `drawio shadow does not support ${edit.op.kind}`);
}

function snapshotFromShadow(shadow: DrawioShadow): DrawioVerificationSnapshot {
  return {
    nodes: [...shadow.values()].filter((item) => item.kind === 'node').map((item) => ({
      id: item.id,
      ...(item.parent ? { parent: item.parent } : {}),
      x: item.box.left,
      y: item.box.top,
      width: item.box.width,
      height: item.box.height,
    })),
    edges: [...shadow.values()].filter((item) => item.kind === 'edge').map((item) => ({
      id: item.id,
      source: item.source ?? '',
      target: item.target ?? '',
      ...(item.parent ? { parent: item.parent } : {}),
    })),
  };
}

function removeCascade(shadow: DrawioShadow, root: string): void {
  const removing = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of shadow.values()) {
      if (object.parent && removing.has(object.parent) && !removing.has(object.id)) {
        removing.add(object.id);
        changed = true;
      }
    }
  }
  for (const object of [...shadow.values()]) {
    if (removing.has(object.id) || (object.source && removing.has(object.source)) || (object.target && removing.has(object.target))) {
      shadow.delete(object.id);
    }
  }
}

function objectPreview(object: DrawioShadowObject): PreviewValue {
  return { kind: 'object', box: { ...object.box }, props: { ...object.props } };
}

function missingPreview(id: string): PreviewValue {
  return { kind: 'object', box: box(), props: { id, missing: true } };
}

function deletedPreview(object: DrawioShadowObject | undefined, id: string): PreviewValue {
  return { kind: 'object', box: object ? { ...object.box } : box(), props: { ...(object?.props ?? { id }), deleted: true } };
}

function fallbackAnchor(cs: ChangeSet): LogicalAnchor {
  return {
    id: 'drawio-root' as LogicalAnchor['id'],
    hostId: cs.hostId as HostId,
    kind: 'object',
    ref: null,
    portable: { kind: 'object', slide: 0, elementId: '1' },
    baseRev: cs.baseRev,
  };
}

function box(x = 0, y = 0, width = 0, height = 0): BoxRect {
  return { left: x, top: y, width, height, rotate: 0 };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringProp(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' && value[key] ? value[key] as string : undefined;
}

function numberProp(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] as number : undefined;
}
