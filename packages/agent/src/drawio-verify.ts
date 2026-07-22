/** drawio topology simulation with exact object identity. */
import type { ChangeSet, VerifyReport } from '@otterpatch/core';

export interface DrawioVerificationSnapshot {
  nodes: Array<{ id: string; parent?: string; x?: number; y?: number; width?: number; height?: number }>;
  edges: Array<{ id: string; source: string; target: string; parent?: string }>;
}

interface GraphObject {
  id: string;
  kind: 'node' | 'edge' | 'unknown';
  parent?: string;
  source?: string;
  target?: string;
}

interface Issue {
  code: string;
  editId?: string;
  message: string;
}

const SUPPORTED_DRAWIO_OPS = new Set(['setValue', 'setObjectProps', 'moveObject', 'addObject', 'deleteObject']);
const ROOT_IDS = new Set(['0', '1']);
const DRAWIO_CELL_PROPS = new Set(['id', 'value', 'style', 'vertex', 'edge', 'parent', 'source', 'target']);
const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function contextObjects(context: string): Map<string, GraphObject> {
  const objects = new Map<string, GraphObject>();
  const add = (id: string, kind: GraphObject['kind'] = 'unknown'): void => {
    const normalized = id.trim();
    if (!normalized || normalized === '文字') return;
    const current = objects.get(normalized);
    if (!current || current.kind === 'unknown') objects.set(normalized, { id: normalized, kind });
  };

  for (const match of context.matchAll(/\bid\s*=\s*([A-Za-z0-9_.:-]+)/g)) add(match[1]!);
  const nodeLine = /节点\(id=文字\):\s*([^\n]+)/.exec(context)?.[1];
  if (nodeLine) {
    for (const entry of nodeLine.split(/[、,;]/)) add(entry.split('=')[0] ?? '', 'node');
  }
  for (const match of context.matchAll(/([A-Za-z0-9_.:-]+)\s*→\s*([A-Za-z0-9_.:-]+)/g)) {
    add(match[1]!, 'node');
    add(match[2]!, 'node');
  }
  return objects;
}

function snapshotObjects(snapshot: DrawioVerificationSnapshot, issues: Issue[]): Map<string, GraphObject> {
  const objects = new Map<string, GraphObject>();
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    issues.push({ code: 'VERIFIER_INVALID_SNAPSHOT', message: 'drawio snapshot must be an object' });
    return objects;
  }
  const input = snapshot as unknown as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    issues.push({ code: 'VERIFIER_INVALID_SNAPSHOT', message: 'drawio snapshot must contain nodes and edges arrays' });
    return objects;
  }
  const put = (object: GraphObject): void => {
    if (!object.id) {
      issues.push({ code: 'VERIFIER_INVALID_OBJECT_ID', message: 'drawio snapshot contains an empty id' });
      return;
    }
    if (objects.has(object.id)) {
      issues.push({ code: 'VERIFIER_DUPLICATE_OBJECT_ID', message: `drawio snapshot contains duplicate id "${object.id}"` });
      return;
    }
    objects.set(object.id, object);
  };
  for (const candidate of input.nodes) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      issues.push({ code: 'VERIFIER_INVALID_SNAPSHOT', message: 'drawio snapshot contains a non-object node' });
      continue;
    }
    const node = candidate as { id?: unknown; parent?: unknown };
    if (typeof node.id !== 'string' || (node.parent != null && typeof node.parent !== 'string')) {
      issues.push({ code: 'VERIFIER_INVALID_SNAPSHOT', message: 'drawio snapshot node id/parent must be strings' });
      continue;
    }
    put({ id: node.id, kind: 'node', ...(node.parent ? { parent: node.parent } : {}) });
  }
  for (const candidate of input.edges) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      issues.push({ code: 'VERIFIER_INVALID_SNAPSHOT', message: 'drawio snapshot contains a non-object edge' });
      continue;
    }
    const edge = candidate as { id?: unknown; source?: unknown; target?: unknown; parent?: unknown };
    if (typeof edge.id !== 'string' || typeof edge.source !== 'string' || typeof edge.target !== 'string'
      || (edge.parent != null && typeof edge.parent !== 'string')) {
      issues.push({ code: 'VERIFIER_INVALID_SNAPSHOT', message: 'drawio snapshot edge id/source/target/parent must be strings' });
      continue;
    }
    put({
      id: edge.id,
      kind: 'edge',
      source: edge.source,
      target: edge.target,
      ...(edge.parent ? { parent: edge.parent } : {}),
    });
  }
  return objects;
}

function removeCascade(objects: Map<string, GraphObject>, id: string): void {
  const removing = new Set([id]);
  const children = new Map<string, string[]>();
  for (const object of objects.values()) {
    if (!object.parent) continue;
    const siblings = children.get(object.parent) ?? [];
    siblings.push(object.id);
    children.set(object.parent, siblings);
  }
  const queue = [id];
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]!) ?? []) {
      if (removing.has(child)) continue;
      removing.add(child);
      queue.push(child);
    }
  }
  for (const object of [...objects.values()]) {
    if (removing.has(object.id) || (object.source && removing.has(object.source)) || (object.target && removing.has(object.target))) {
      objects.delete(object.id);
    }
  }
}

function validateTopology(objects: Map<string, GraphObject>, issues: Issue[]): void {
  for (const object of objects.values()) {
    if (object.parent && !ROOT_IDS.has(object.parent)) {
      const parent = objects.get(object.parent);
      if (!parent) issues.push({ code: 'VERIFIER_MISSING_PARENT', message: `对象 "${object.id}" 的 parent="${object.parent}" 不存在` });
      else if (parent.kind === 'edge') issues.push({ code: 'VERIFIER_INVALID_PARENT', message: `对象 "${object.id}" 的 parent="${object.parent}" 是一条边` });
    }
    if (object.kind === 'edge') {
      if (!object.source || !object.target) {
        issues.push({ code: 'VERIFIER_DANGLING_EDGE', message: `边 "${object.id}" 缺少 source 或 target` });
        continue;
      }
      if (object.source === object.target) {
        issues.push({ code: 'VERIFIER_SELF_REFERENCE', message: `边 "${object.id}" 引用了自身节点 "${object.source}"` });
      }
      const source = objects.get(object.source);
      const target = objects.get(object.target);
      if (!source || !target || source.kind === 'edge' || target.kind === 'edge') {
        issues.push({ code: 'VERIFIER_DANGLING_EDGE', message: `边 "${object.id}" 的端点 ${object.source}→${object.target} 没有完整着落` });
      }
    }
  }

  const done = new Set<string>();
  for (const object of objects.values()) {
    if (done.has(object.id)) continue;
    const path: string[] = [];
    const local = new Set<string>();
    let cursor: GraphObject | undefined = object;
    while (cursor && !done.has(cursor.id) && !ROOT_IDS.has(cursor.id)) {
      if (local.has(cursor.id)) {
        issues.push({ code: 'VERIFIER_PARENT_CYCLE', message: `对象 "${object.id}" 的 parent 链形成循环` });
        break;
      }
      local.add(cursor.id);
      path.push(cursor.id);
      cursor = cursor.parent && !ROOT_IDS.has(cursor.parent) ? objects.get(cursor.parent) : undefined;
    }
    for (const id of path) done.add(id);
  }
}

function report(level: 'lint' | 'simulation', issues: Issue[], warnings: string[], objectCount: number): VerifyReport {
  if (issues.length) {
    const payload = { ok: false, level, code: issues[0]!.code, issues, warnings };
    return { ok: false, level, code: issues[0]!.code, details: { issues, warnings }, report: JSON.stringify(payload) };
  }
  const warningText = warnings.length ? '\n另外这些地方请留意:\n' + warnings.map((warning) => '- ' + warning).join('\n') : '';
  return {
    ok: true,
    level,
    report: `${level === 'simulation' ? '拓扑模拟' : '拓扑检查'}通过:${objectCount} 个对象,id 精确匹配且所有关系完整。${warningText}`,
    details: { objectCount, warnings },
  };
}

/** Structured snapshots get simulation; legacy text contexts get exact-token lint only. */
export function buildDrawioVerifier(source: string | DrawioVerificationSnapshot): (cs: ChangeSet) => VerifyReport {
  const level = typeof source === 'string' ? 'lint' as const : 'simulation' as const;
  return (cs: ChangeSet): VerifyReport => {
    const issues: Issue[] = [];
    const warnings: string[] = [];
    const objects = typeof source === 'string' ? contextObjects(source) : snapshotObjects(source, issues);
    const futureAdds = new Set<string>();
    for (const edit of cs.edits) {
      if (edit.op.kind !== 'addObject') continue;
      const payload = edit.op.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        issues.push({ code: 'VERIFIER_INVALID_OBJECT_PAYLOAD', editId: edit.id, message: '新建对象 payload 必须是对象' });
        continue;
      }
      const id = (payload as { id?: unknown }).id;
      if (typeof id !== 'string' || !id.trim()) issues.push({ code: 'VERIFIER_INVALID_OBJECT_ID', editId: edit.id, message: '新建对象缺少非空字符串 id' });
      else if (ROOT_IDS.has(id)) issues.push({ code: 'VERIFIER_DUPLICATE_OBJECT_ID', editId: edit.id, message: `新建对象 id "${id}" 与 drawio 根对象冲突` });
      else if (futureAdds.has(id)) issues.push({ code: 'VERIFIER_DUPLICATE_OBJECT_ID', editId: edit.id, message: `新建对象 id "${id}" 在提案中重复` });
      else if (objects.has(id)) issues.push({ code: 'VERIFIER_DUPLICATE_OBJECT_ID', editId: edit.id, message: `新建对象 id "${id}" 与现有对象冲突` });
      else futureAdds.add(id);
    }

    const touched = new Set<string>();
    for (const edit of cs.edits) {
      if (!SUPPORTED_DRAWIO_OPS.has(edit.op.kind)) {
        issues.push({ code: 'VERIFIER_UNSUPPORTED_OPERATION', editId: edit.id, message: `drawio topology simulation does not support ${edit.op.kind}` });
        continue;
      }
      const anchor = cs.anchors[edit.target];
      const targetId = anchor?.portable.kind === 'object' ? anchor.portable.elementId : '';

      if (edit.op.kind === 'addObject') {
        if (!edit.op.payload || typeof edit.op.payload !== 'object' || Array.isArray(edit.op.payload)) continue;
        const payload = edit.op.payload as Record<string, unknown>;
        const id = typeof payload.id === 'string' ? payload.id : '';
        if (!id) continue;
        if (ROOT_IDS.has(id) || objects.has(id)) {
          if (!issues.some((issue) => issue.editId === edit.id && issue.code === 'VERIFIER_DUPLICATE_OBJECT_ID')) {
            issues.push({ code: 'VERIFIER_DUPLICATE_OBJECT_ID', editId: edit.id, message: `新建对象 id "${id}" 在执行位置已存在` });
          }
          continue;
        }
        const relationship = (key: 'parent' | 'source' | 'target'): string | undefined => {
          const value = payload[key];
          if (value == null) return undefined;
          if (typeof value !== 'string') {
            issues.push({ code: 'VERIFIER_INVALID_OBJECT_PAYLOAD', editId: edit.id, message: `新建对象 ${key} 必须是字符串` });
            return undefined;
          }
          if (!value) {
            issues.push({ code: 'VERIFIER_INVALID_OBJECT_PAYLOAD', editId: edit.id, message: `新建对象 ${key} 不能是空字符串` });
            return undefined;
          }
          return value;
        };
        const explicitParent = relationship('parent');
        const sourceId = relationship('source');
        const target = relationship('target');
        if (issues.some((issue) => issue.editId === edit.id && issue.code === 'VERIFIER_INVALID_OBJECT_PAYLOAD')) continue;
        const parent = (explicitParent ?? targetId) || undefined;
        const isEdge = Boolean(payload.edge || sourceId || target);
        objects.set(id, {
          id,
          kind: isEdge ? 'edge' : 'node',
          ...(parent ? { parent } : {}),
          ...(sourceId ? { source: sourceId } : {}),
          ...(target ? { target } : {}),
        });
        continue;
      }

      if (!targetId || !objects.has(targetId)) {
        issues.push({ code: 'VERIFIER_TARGET_NOT_FOUND', editId: edit.id, message: `${edit.op.kind} 的目标 id "${targetId}" 不在画板中` });
        continue;
      }
      if (touched.has(targetId)) {
        warnings.push(edit.op.kind === 'deleteObject'
          ? `id "${targetId}" 在本提案里先被修改又被删除,前面的修改不会保留`
          : `id "${targetId}" 被多条改动重复命中,请确认执行顺序`);
      }
      touched.add(targetId);

      if (edit.op.kind === 'deleteObject') {
        removeCascade(objects, targetId);
        continue;
      }
      if (edit.op.kind !== 'setObjectProps') continue;

      const object = objects.get(targetId)!;
      const props = edit.op.props;
      const unsupportedProps = Object.keys(props).filter((key) => !DRAWIO_CELL_PROPS.has(key));
      if (unsupportedProps.length) {
        issues.push({
          code: 'VERIFIER_UNSUPPORTED_OBJECT_PROPERTY',
          editId: edit.id,
          message: `drawio 写回不支持属性 ${unsupportedProps.join(', ')}`,
        });
        continue;
      }
      const unsupportedTopologyProps = ['edge', 'vertex'].filter((key) => hasOwn(props, key));
      if (unsupportedTopologyProps.length) {
        issues.push({
          code: 'VERIFIER_UNSUPPORTED_OBJECT_PROPERTY',
          editId: edit.id,
          message: `drawio 拓扑模拟不支持修改属性 ${unsupportedTopologyProps.join(', ')}`,
        });
        continue;
      }
      const prop = (key: string, fallback?: string): string | undefined => hasOwn(props, key) ? String(props[key]) : fallback;
      const nextId = prop('id', targetId) ?? targetId;
      if (!nextId) {
        issues.push({ code: 'VERIFIER_INVALID_OBJECT_ID', editId: edit.id, message: '对象 id 不能改为空字符串' });
        continue;
      }
      if (hasOwn(props, 'parent') && !prop('parent')) {
        issues.push({ code: 'VERIFIER_INVALID_OBJECT_PROPERTY', editId: edit.id, message: '对象 parent 不能改为空字符串' });
        continue;
      }
      if (nextId !== targetId && (ROOT_IDS.has(nextId) || objects.has(nextId))) {
        issues.push({ code: 'VERIFIER_DUPLICATE_OBJECT_ID', editId: edit.id, message: `对象 id "${nextId}" 已存在` });
        continue;
      }
      const updated: GraphObject = {
        ...object,
        id: nextId,
        ...(hasOwn(props, 'parent') ? { parent: prop('parent')! } : {}),
        ...(hasOwn(props, 'source') ? { source: prop('source')! } : {}),
        ...(hasOwn(props, 'target') ? { target: prop('target')! } : {}),
      };
      if (nextId !== targetId) objects.delete(targetId);
      objects.set(nextId, updated);
    }

    validateTopology(objects, issues);
    return report(level, issues, warnings, objects.size);
  };
}
