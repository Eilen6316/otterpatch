/**
 * drawio 影子校验器 —— 图的自检核心是"拓扑完整性":
 * update/delete/move 的目标 id 必须真实存在(否则静默 no-op);
 * 新建边的 source/target 必须指向【已存在的节点】或【同一提案里新建的节点】(悬空边是最常见的图损坏);
 * 新建 id 不得撞已有 id、也不得在提案内重复。
 * 与 word-verify 同构:纯字符串/结构检查,零适配器依赖,报告结构化回喂 propose→observe→repair。
 */
import type { ChangeSet, VerifyReport } from '@otterpatch/core';

/** 由"画板拓扑上下文"(propose 时喂给模型的 context)造一个自检器。 */
export function buildDrawioVerifier(boardContext: string): (cs: ChangeSet) => VerifyReport {
  const known = (id: string): boolean => !!id && boardContext.includes(id);
  return (cs: ChangeSet): VerifyReport => {
    const errors: string[] = [];
    const warnings: string[] = [];
    // 收集本提案新建的 id(边可以指向同提案新建的节点)
    const created = new Set<string>();
    for (const e of cs.edits) {
      if (e.op.kind === 'addObject') {
        const id = String((e.op.payload as { id?: unknown })?.id ?? '');
        if (id) {
          if (created.has(id)) errors.push(`新建对象 id "${id}" 在本提案里重复出现 —— 后者会覆盖/冲突,请换唯一 id`);
          if (known(id)) warnings.push(`新建对象 id "${id}" 与画板已有元素撞名,可能覆盖既有对象`);
          created.add(id);
        }
      }
    }
    const touched = new Set<string>();
    for (const e of cs.edits) {
      const a = cs.anchors[e.target];
      const elementId = a?.portable.kind === 'object' ? a.portable.elementId : '';
      if (e.op.kind === 'addObject') {
        const p = e.op.payload as { edge?: boolean; source?: string; target?: string; parent?: string };
        if (p.edge || p.source || p.target) {
          for (const [end, v] of [['source', p.source], ['target', p.target]] as const) {
            if (!v) { errors.push(`新建边缺少 ${end} —— 悬空边不可落地,请补上端点节点 id`); continue; }
            if (!known(v) && !created.has(v)) errors.push(`新建边的 ${end}="${v}" 既不在画板中、也不是本提案新建的节点 —— 会成为悬空边。请改成真实存在的节点 id`);
          }
        }
        if (p.parent && p.parent !== '1' && !known(p.parent) && !created.has(p.parent)) warnings.push(`新建对象的 parent="${p.parent}" 不在画板中,将落到默认层`);
        continue;
      }
      // update/delete/move:目标必须真实存在
      if (!elementId) { errors.push(`有一条 ${e.op.kind} 改动没有目标 id,无法落地`); continue; }
      if (!known(elementId)) { errors.push(`${e.op.kind} 的目标 id "${elementId}" 不在画板中 —— 这条改动会静默失效。请用上下文里真实的 cell id`); continue; }
      if (e.op.kind === 'deleteObject' && touched.has(elementId)) warnings.push(`id "${elementId}" 在本提案里先被修改又被删除,前面的修改将被浪费`);
      if (touched.has(elementId) && e.op.kind !== 'deleteObject') warnings.push(`id "${elementId}" 被多条改动重复命中,注意先后覆盖`);
      touched.add(elementId);
    }
    const parts: string[] = [];
    if (errors.length) parts.push('发现以下拓扑问题(会导致改动失效或图损坏):\n' + errors.map((s) => '- ' + s).join('\n'));
    if (warnings.length) parts.push('另外这些地方请留意:\n' + warnings.map((s) => '- ' + s).join('\n'));
    const ok = errors.length === 0;
    const tail = ok ? '' : '\n请据此修正后重新调用 propose_changeset。';
    return { ok, report: (parts.join('\n') || '自检通过:所有目标 id 真实存在,边的两端都有着落。') + tail };
  };
}
