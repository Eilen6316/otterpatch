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
import type { AgentResponse, HostDialect, ModelClient, ProposeRequest, RespondOptions, StreamEvent } from './model.js';

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

  /** 组装注入了约定/技能的 dialect。 */
  private dialectFor(req: ProposeRequest): HostDialect {
    const dialect = this.dialects[req.format];
    if (!dialect) throw new Error(`Agent: no dialect for format "${req.format}"`);
    const parts = [dialect.systemPrompt];
    const conv = this.conventions?.render();
    if (conv) parts.push(conv);
    const skl = this.skills?.render(req.format, req.intent);
    if (skl) parts.push(skl);
    return parts.length > 1 ? { ...dialect, systemPrompt: parts.join('\n\n') } : dialect;
  }

  /** 技能渐进披露 L1:库里有带手册的技能时,给 loop 追加 load_skill 工具(命中后拉全文,不预塞 prompt)。 */
  private withSkillTools(opts?: RespondOptions): RespondOptions | undefined {
    const lib = this.skills;
    if (!lib || opts?.extraTools) return opts; // 调用方已带 extraTools 时不覆盖
    const withBody = lib.all().filter((c) => c.instructions);
    if (!withBody.length) return opts;
    const extraTools: NonNullable<RespondOptions['extraTools']> = {
      defs: [{
        name: 'load_skill',
        description: '按名字加载一个技能的完整打法手册(检查清单/惯用法/反例)。系统提示"可用技能"里标注【有打法手册】的技能与当前任务相关时,动手前先加载并按手册执行。',
        parameters: { type: 'object', properties: { name: { type: 'string', description: '技能名,如 docx-gongwen' } }, required: ['name'] },
      }],
      exec: (name, args) => {
        if (name !== 'load_skill') return null;
        const n = String((args as { name?: unknown } | null)?.name ?? '');
        return lib.instructionsFor(n) ?? `(未找到技能 "${n}";带手册的技能: ${withBody.map((c) => c.name).join('、')})`;
      },
    };
    return { ...(opts ?? {}), extraTools };
  }

  /** 智能路由:模型自行决定回答问题还是提出改动(回退到 propose)。 */
  async respond(req: ProposeRequest, opts?: RespondOptions): Promise<AgentResponse> {
    const d = this.dialectFor(req);
    if (this.model.respond) return this.model.respond(req, d, this.withSkillTools(opts));
    return { kind: 'changeset', changeSet: await this.model.proposeChangeSet(req, d) };
  }

  /** 流式路由:有 respondStream 则透传;否则回退到一次性结果并补发增量/done。 */
  async respondStream(req: ProposeRequest, onEvent: (e: StreamEvent) => void, opts?: RespondOptions): Promise<AgentResponse> {
    const d = this.dialectFor(req);
    if (this.model.respondStream) return this.model.respondStream(req, d, onEvent, this.withSkillTools(opts));
    const r = this.model.respond ? await this.model.respond(req, d, this.withSkillTools(opts)) : { kind: 'changeset' as const, changeSet: await this.model.proposeChangeSet(req, d) };
    if (r.kind === 'answer') onEvent({ type: 'answer', delta: r.text });
    onEvent({ type: 'done', result: r });
    return r;
  }

  async propose(req: ProposeRequest): Promise<ChangeSet> {
    const d = this.dialectFor(req);

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
