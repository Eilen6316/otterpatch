/**
 * Agent —— 意图 → ChangeSet 的入口。当前薄(直接委托模型);
 * 后续接技能检索(SkillRegistry)、计划、能力协商、影子校验。
 */
import type { ChangeSet } from '@office-agent/core';
import type { ModelClient, ProposeRequest } from './model.js';

export class Agent {
  constructor(private readonly model: ModelClient) {}

  propose(req: ProposeRequest): Promise<ChangeSet> {
    return this.model.proposeChangeSet(req);
  }
}
