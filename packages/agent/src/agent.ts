/**
 * Agent —— 意图 → ChangeSet 的入口。按 req.format 选 HostDialect,委托模型;
 * 后续接技能检索(SkillRegistry)、计划、能力协商、影子校验。
 */
import type { ChangeSet } from '@opal/core';
import { DIALECTS } from './dialects.js';
import type { HostDialect, ModelClient, ProposeRequest } from './model.js';

export class Agent {
  constructor(
    private readonly model: ModelClient,
    private readonly dialects: Record<string, HostDialect> = DIALECTS,
  ) {}

  async propose(req: ProposeRequest): Promise<ChangeSet> {
    const dialect = this.dialects[req.format];
    if (!dialect) throw new Error(`Agent: no dialect for format "${req.format}"`);
    return this.model.proposeChangeSet(req, dialect);
  }
}
