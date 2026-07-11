/**
 * Shadow verifier for Word documents — Word has no grid to recompute, so the core
 * self-check is "can each anchor land": every text/format edit's quote must exist
 * literally and uniquely in the source text, otherwise optimistic apply silently
 * no-ops (the user thinks it changed but it didn't). Issues are fed back to the
 * model in structured form → fixed in the same propose→observe→repair round.
 * Uses only core types + plain string matching; zero adapter dependencies.
 */
import type { ChangeSet, VerifyReport } from '@otterpatch/core';

const clip = (s: string): string => (s.length > 40 ? s.slice(0, 40) + '…' : s);

/**
 * Build a verifier from the full document text (the context fed to the model at propose time).
 * Returned signature is compatible with @otterpatch/agent's ChangeSetVerifier.
 */
export function buildDocVerifier(docText: string): (cs: ChangeSet) => VerifyReport {
  return (cs: ChangeSet): VerifyReport => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    const paraCount = docText.split('\n').filter((s) => s.trim() !== '').length; // getText 的清样投影:一行一段
    for (const e of cs.edits) {
      const a = cs.anchors[e.target];
      const quote = a?.portable.kind === 'flow' ? a.portable.quote.text : '';
      const paraIdx = a?.portable.kind === 'flow' ? a.portable.path[0] : undefined;
      const isStyle = e.op.kind === 'setStyle';
      const isEndTable = e.op.kind === 'insertTable' && e.op.at === 'end';
      // Appending a table to the document body has no source anchor by design.
      if (isEndTable) continue;
      // 段号锚定(para):不依赖 quote。getText 清样投影会滤掉空段,段数只是下限,越界只提醒不拦截
      if (paraIdx != null) {
        if (paraIdx < 0) errors.push('para 段号必须 ≥ 1');
        else if (paraIdx >= paraCount * 2 + 50) warnings.push(`para=${paraIdx + 1} 远超全文段数(约 ${paraCount} 段),请核对上下文里的"第N段"编号`);
        continue;
      }
      // Document-wide style edits (all=true) have no quote anchor and always land — skip location check
      if (isStyle && !quote) continue;
      if (!quote) {
        errors.push('有一条改动没有可定位的原文片段(quote 为空)也没有 para 段号,无法落地;空段落/无法唯一引用时请给 para=段号');
        continue;
      }
      const first = docText.indexOf(quote);
      if (first < 0) {
        errors.push(`“${clip(quote)}” 不在文档原文中 —— 这条改动会静默失效(不会生效)。请把 quote 换成文档里真实存在的原文片段`);
        continue;
      }
      // Uniqueness: multiple occurrences → anchor may land at the wrong spot (matches system-prompt rule ②)
      if (docText.indexOf(quote, first + 1) >= 0) {
        warnings.push(`“${clip(quote)}” 在原文中出现多次,定位可能不唯一;请带上足够上下文使其唯一`);
      }
      // Empty edit: replacement text is identical to the original
      if (e.op.kind === 'replaceText' && e.op.text === quote) {
        errors.push(`“${clip(quote)}” 的改后文字与原文完全相同 —— 这是一次空改动,没有任何效果`);
      }
      // Same quote hit by multiple edits → they may overwrite each other
      if (seen.has(quote)) warnings.push(`“${clip(quote)}” 被多条改动重复命中,可能相互覆盖`);
      seen.add(quote);
    }
    const parts: string[] = [];
    if (errors.length) parts.push('发现以下问题(会导致改动无法生效):\n' + errors.map((s) => '- ' + s).join('\n'));
    if (warnings.length) parts.push('另外这些地方请留意:\n' + warnings.map((s) => '- ' + s).join('\n'));
    const ok = errors.length === 0;
    const tail = ok ? '' : '\n请据此修正后重新调用 propose_changeset。';
    return { ok, report: (parts.join('\n') || '自检通过:每条改动的锚点都能在原文中唯一定位。') + tail };
  };
}
