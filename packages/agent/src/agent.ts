/**
 * Agent —— 意图 → ChangeSet 的入口。按 req.format 选 HostDialect;
 * 若注入了 SkillLibrary,则按 (format, intent) 命中技能,把其 L0(name/description)注入系统提示
 * (渐进披露:Agent 据此决定是否展开技能正文)。后续接技能脚本执行、能力协商、影子校验。
 */
import type { ChangeSet } from '@opal/core';
import type { SkillLibrary } from '@opal/skills';
import { DIALECTS } from './dialects.js';
import type { HostDialect, ModelClient, ProposeRequest } from './model.js';

export class Agent {
  constructor(
    private readonly model: ModelClient,
    private readonly dialects: Record<string, HostDialect> = DIALECTS,
    private readonly skills?: SkillLibrary,
  ) {}

  async propose(req: ProposeRequest): Promise<ChangeSet> {
    const dialect = this.dialects[req.format];
    if (!dialect) throw new Error(`Agent: no dialect for format "${req.format}"`);
    const snippet = this.skills?.render(req.format, req.intent);
    const d: HostDialect = snippet
      ? { ...dialect, systemPrompt: dialect.systemPrompt + '\n\n' + snippet }
      : dialect;
    return this.model.proposeChangeSet(req, d);
  }
}
