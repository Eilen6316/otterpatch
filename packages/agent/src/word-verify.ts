/**
 * Word 文档影子校验器 —— Word 没有网格可重算,自检的核心是"锚点能不能落地":
 * 每条改文字/改格式的 quote 必须在原文里真实、唯一地存在,否则乐观应用会静默 no-op
 * (用户以为改了、其实没改)。把问题结构化回喂模型 → 同回合 propose→observe→repair 修正。
 * 只用 core 类型 + 纯字符串匹配,零适配器依赖。
 */
import type { ChangeSet, VerifyReport } from '@otterpatch/core';

const clip = (s: string): string => (s.length > 40 ? s.slice(0, 40) + '…' : s);

/**
 * 由"文档全文"(propose 时喂给模型的 context)造一个自检器。
 * 返回签名兼容 @otterpatch/agent 的 ChangeSetVerifier。
 */
export function buildDocVerifier(docText: string): (cs: ChangeSet) => VerifyReport {
  return (cs: ChangeSet): VerifyReport => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    for (const e of cs.edits) {
      const a = cs.anchors[e.target];
      const quote = a?.portable.kind === 'flow' ? a.portable.quote.text : '';
      const isStyle = e.op.kind === 'setStyle';
      // 全文格式改动(all=true)没有 quote 锚点,天然可落地 —— 跳过定位校验
      if (isStyle && !quote) continue;
      if (!quote) {
        errors.push('有一条改动没有可定位的原文片段(quote 为空),无法落地');
        continue;
      }
      const first = docText.indexOf(quote);
      if (first < 0) {
        errors.push(`“${clip(quote)}” 不在文档原文中 —— 这条改动会静默失效(不会生效)。请把 quote 换成文档里真实存在的原文片段`);
        continue;
      }
      // 唯一性:出现多次 → 定位可能落到错误位置(与系统提示规则②一致)
      if (docText.indexOf(quote, first + 1) >= 0) {
        warnings.push(`“${clip(quote)}” 在原文中出现多次,定位可能不唯一;请带上足够上下文使其唯一`);
      }
      // 空改动:改后文字与原文完全相同
      if (e.op.kind === 'replaceText' && e.op.text === quote) {
        errors.push(`“${clip(quote)}” 的改后文字与原文完全相同 —— 这是一次空改动,没有任何效果`);
      }
      // 同一 quote 被多条改动命中 → 可能相互覆盖
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
