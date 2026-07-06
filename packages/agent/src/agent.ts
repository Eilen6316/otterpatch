/**
 * Agent — entry point from intent to ChangeSet. Picks the HostDialect by req.format and
 * injects the convention layer (ConventionStack: rules on how to do things) and the skill
 * library (SkillLibrary: what it can do) into the system prompt on demand.
 * Optional validator + maxRetries: on validation failure, feed structured errors back and
 * retry within the same turn (inspired by codex apply_patch's apply-report-iterate loop).
 * Later: skill-script execution, capability negotiation, shadow validation.
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
  /** Validates a proposal; if not ok, errors are fed back to the model for retry. Omit = no validation (single shot). */
  validator?: Validator;
  /** Max retries after validation failure (default 0). */
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

  /** Builds the dialect with conventions/skills injected. */
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

  /** Progressive skill disclosure L1: if the library has skills with playbooks, add a load_skill tool to the loop (fetch full text on hit instead of pre-stuffing the prompt). */
  private withSkillTools(opts?: RespondOptions): RespondOptions | undefined {
    const lib = this.skills;
    if (!lib || opts?.extraTools) return opts; // don't override when the caller already provides extraTools
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

  /** Smart routing: the model decides whether to answer a question or propose changes (falls back to propose). */
  async respond(req: ProposeRequest, opts?: RespondOptions): Promise<AgentResponse> {
    const d = this.dialectFor(req);
    if (this.model.respond) return this.model.respond(req, d, this.withSkillTools(opts));
    return { kind: 'changeset', changeSet: await this.model.proposeChangeSet(req, d) };
  }

  /** Streaming routing: pass through if respondStream exists; otherwise fall back to a one-shot result and emit delta/done events. */
  async respondStream(req: ProposeRequest, onEvent: (e: StreamEvent) => void, opts?: RespondOptions): Promise<AgentResponse> {
    const d = this.dialectFor(req);
    if (this.model.respondStream) return this.model.respondStream(req, d, onEvent, this.withSkillTools(opts));
    let r: AgentResponse;
    if (this.model.respond) {
      r = await this.model.respond(req, d, this.withSkillTools(opts));
    } else {
      const cs = await this.model.proposeChangeSet(req, d);
      if (opts?.verify) {
        const v = await opts.verify(cs);
        r = v.ok ? { kind: 'changeset' as const, changeSet: cs } : { kind: 'answer' as const, text: '提案校验失败。\n' + v.report };
      } else {
        r = { kind: 'changeset', changeSet: cs };
      }
    }
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
