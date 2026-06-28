/**
 * Agent —— 意图 → ChangeSet 的入口。按 req.format 选 HostDialect,并把
 * 约定层(ConventionStack:怎么做的规矩)与技能库(SkillLibrary:会做什么)按需注入系统提示。
 * 可选校验器 + maxRetries:校验失败时把错误结构化回喂、同回合重试修正(借鉴 codex apply_patch 的
 * 应用-回报-迭代闭环)。后续接技能脚本执行、能力协商、影子校验。
 */
import type { ChangeSet } from '@otterpatch/core';
import type { SkillLibrary } from '@otterpatch/skills';
import type { ConventionStack } from './conventions.js';
import { DIALECTS } from './dialects.js';
import type { HostDialect, ModelClient, ProposeRequest } from './model.js';

export interface ChangeSetValidation {
  ok: boolean;
  errors: string[];
}
export type Validator = (cs: ChangeSet) => ChangeSetValidation;

export interface AgentOptions {
  /** 校验提案;不 ok 时把 errors 回喂模型重试。省略=不校验(单次)。 */
  validator?: Validator;
  /** 校验失败最多重试几次(默认 0)。 */
  maxRetries?: number;
}

export class Agent {
  constructor(
    private readonly model: ModelClient,
    private readonly dialects: Record<string, HostDialect> = DIALECTS,
    private readonly skills?: SkillLibrary,
    private readonly conventions?: ConventionStack,
    private readonly opts: AgentOptions = {},
  ) {}

  async propose(req: ProposeRequest): Promise<ChangeSet> {
    const dialect = this.dialects[req.format];
    if (!dialect) throw new Error(`Agent: no dialect for format "${req.format}"`);

    const parts = [dialect.systemPrompt];
    const conv = this.conventions?.render();
    if (conv) parts.push(conv);
    const skl = this.skills?.render(req.format, req.intent);
    if (skl) parts.push(skl);
    const d: HostDialect = parts.length > 1 ? { ...dialect, systemPrompt: parts.join('\n\n') } : dialect;

    const validator = this.opts.validator;
    const maxRetries = this.opts.maxRetries ?? 0;
    let errors: string[] = [];
    for (let attempt = 0; ; attempt++) {
      const r: ProposeRequest = errors.length
        ? { ...req, context: req.context + '\n\n[上次提案校验失败,请据此修正]\n' + errors.map((e) => '- ' + e).join('\n') }
        : req;
      const cs = await this.model.proposeChangeSet(r, d);
      if (!validator) return cs;
      const v = validator(cs);
      if (v.ok || attempt >= maxRetries) return cs;
      errors = v.errors;
    }
  }
}
