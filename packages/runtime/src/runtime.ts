/**
 * OtterPatchRuntime —— headless 编排器,把"上游 Agent(propose)"和"下游外科写回(commit)"接成一条线,
 * 中间产出可审阅 diff,并对每个阶段发结构化事件。MCP server / CLI / 桌面都复用这一个内核。
 *
 * 端到端:propose(intent → ChangeSet) → diff(可审阅) → 用户接受子集 → commit(外科写回 → 新字节 + 保真报告)。
 * 写回后端按 format 路由:excel/xlsx → 外科 OOXML(Univer 编译器);drawio → 单 XML 外科。
 */
import { Agent, buildDocVerifier, buildDrawioVerifier } from '@otterpatch/agent';
import type { AgentResponse, ChangeSetVerifier, ModelClient, ProposeRequest, RespondOptions, StreamEvent } from '@otterpatch/agent';
import type { ChangeSet, DocHandle, WritebackBackend, WritebackResult } from '@otterpatch/core';
import { SurgicalOoxmlWriteback } from '@otterpatch/writeback-surgical';
import { buildXlsxCompiler, buildGridVerifier } from '@otterpatch/adapter-univer';
import { DrawioSurgicalWriteback } from '@otterpatch/adapter-drawio';
import { WordRedlineWriteback } from '@otterpatch/adapter-word';
import { PdfFormWriteback } from '@otterpatch/adapter-pdf';
import { buildPptxCompiler } from '@otterpatch/adapter-pptx';
import { defaultLibrary } from '@otterpatch/skills';
import type { SkillLibrary } from '@otterpatch/skills';
import { buildDiff, type OtterPatchDiff } from './diff.js';
import type { OtterPatchEvent, OtterPatchEventListener } from './events.js';

export interface CommitInput {
  format: string;
  bytes: Uint8Array;
  changeSet: ChangeSet;
  /** 仅提交这些 edit(逐块接受的结果);省略 = 全部接受。 */
  acceptedEditIds?: string[];
}

export interface OtterPatchRuntimeOptions {
  skills?: SkillLibrary;
}

export class OtterPatchRuntime {
  private readonly listeners = new Set<OtterPatchEventListener>();
  private readonly skills: SkillLibrary;
  private readonly backends: Record<string, () => WritebackBackend>;
  private readonly verifiers: Record<string, (req: ProposeRequest) => ChangeSetVerifier | undefined>;

  constructor(opts: OtterPatchRuntimeOptions = {}) {
    this.skills = opts.skills ?? defaultLibrary();
    this.verifiers = {
      excel: (req) => (req.sheet ? buildGridVerifier(req.sheet) : undefined),
      xlsx: (req) => (req.sheet ? buildGridVerifier(req.sheet) : undefined),
      word: (req) => (req.context.trim() ? buildDocVerifier(req.context) : undefined),
      docx: (req) => (req.context.trim() ? buildDocVerifier(req.context) : undefined),
      drawio: (req) => (req.context.trim() ? buildDrawioVerifier(req.context) : undefined),
    };
    this.backends = {
      excel: () => new SurgicalOoxmlWriteback(buildXlsxCompiler()),
      xlsx: () => new SurgicalOoxmlWriteback(buildXlsxCompiler()),
      drawio: () => new DrawioSurgicalWriteback(),
      word: () => new WordRedlineWriteback(),
      docx: () => new WordRedlineWriteback(),
      pdf: () => new PdfFormWriteback(),
      ppt: () => new SurgicalOoxmlWriteback(buildPptxCompiler()),
      pptx: () => new SurgicalOoxmlWriteback(buildPptxCompiler()),
    };
  }

  /** 订阅事件流;返回取消订阅函数。 */
  on(cb: OtterPatchEventListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  private emit(e: OtterPatchEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** 注册/覆盖某格式的写回后端(Word 红线 / PDF 等后续接入)。 */
  registerWriteback(format: string, make: () => WritebackBackend): void {
    this.backends[format] = make;
  }
  /** 注册/覆盖某格式的影子校验器(与 backends 同款注册表;ppt/pdf 等后续接入)。 */
  registerVerifier(format: string, make: (req: ProposeRequest) => ChangeSetVerifier | undefined): void {
    this.verifiers[format] = make;
  }
  formats(): string[] {
    return Object.keys(this.backends);
  }

  /** 意图 → 受约束 ChangeSet(注入内置技能库;BYOK model 由调用方提供)。 */
  async propose(req: ProposeRequest, model: ModelClient): Promise<ChangeSet> {
    this.emit({ type: 'propose:start', format: req.format, intent: req.intent });
    try {
      const agent = new Agent(model, undefined, this.skills);
      const cs = await agent.propose(req);
      this.emit({ type: 'propose:done', changeSetId: cs.id, editCount: cs.edits.length, ...(cs.meta.planSummary ? { planSummary: cs.meta.planSummary } : {}) });
      return cs;
    } catch (err) {
      this.emit({ type: 'error', stage: 'propose', message: errMsg(err) });
      throw err;
    }
  }

  /** 提案产出后的影子校验(按 format 走注册表):Excel 重算/越界;Word 锚点可落地;drawio 拓扑完整。
   *  外面再包一层收尾语义自检(withFinalSelfCheck)。 */
  private verifyOpts(req: ProposeRequest): RespondOptions | undefined {
    const structural = this.verifiers[req.format]?.(req);
    if (!structural) return undefined;
    return { verify: withFinalSelfCheck(structural), maxRepairs: 2 };
  }

  /** 智能路由:模型自行决定『回答问题』还是『提出改动』。 */
  async respond(req: ProposeRequest, model: ModelClient): Promise<AgentResponse> {
    this.emit({ type: 'propose:start', format: req.format, intent: req.intent });
    try {
      const agent = new Agent(model, undefined, this.skills);
      const r = await agent.respond(req, this.verifyOpts(req));
      if (r.kind === 'changeset') {
        this.emit({ type: 'propose:done', changeSetId: r.changeSet.id, editCount: r.changeSet.edits.length, ...(r.changeSet.meta.planSummary ? { planSummary: r.changeSet.meta.planSummary } : {}) });
      }
      return r;
    } catch (err) {
      this.emit({ type: 'error', stage: 'propose', message: errMsg(err) });
      throw err;
    }
  }

  /** 流式路由:把 reasoning/answer 增量通过 onEvent 吐出。 */
  async respondStream(req: ProposeRequest, model: ModelClient, onEvent: (e: StreamEvent) => void): Promise<AgentResponse> {
    this.emit({ type: 'propose:start', format: req.format, intent: req.intent });
    try {
      const agent = new Agent(model, undefined, this.skills);
      const r = await agent.respondStream(req, onEvent, this.verifyOpts(req));
      if (r.kind === 'changeset') {
        this.emit({ type: 'propose:done', changeSetId: r.changeSet.id, editCount: r.changeSet.edits.length, ...(r.changeSet.meta.planSummary ? { planSummary: r.changeSet.meta.planSummary } : {}) });
      }
      return r;
    } catch (err) {
      this.emit({ type: 'error', stage: 'propose', message: errMsg(err) });
      throw err;
    }
  }

  /** ChangeSet → 可审阅 diff。 */
  diff(cs: ChangeSet): OtterPatchDiff {
    const d = buildDiff(cs);
    this.emit({ type: 'diff:done', diff: d });
    return d;
  }

  /** 接受子集 → 外科写回 → 新字节 + 保真报告。 */
  async commit(input: CommitInput): Promise<WritebackResult> {
    const make = this.backends[input.format];
    if (!make) throw new Error(`OtterPatchRuntime: no writeback backend for format "${input.format}"`);
    const backend = make();
    const cs: ChangeSet = input.acceptedEditIds
      ? { ...input.changeSet, edits: input.changeSet.edits.filter((e) => input.acceptedEditIds!.includes(e.id)) }
      : input.changeSet;
    this.emit({ type: 'commit:start', format: input.format, strategy: backend.strategy, editCount: cs.edits.length });
    try {
      const can = backend.canHandle(cs);
      if (!can.ok) throw new Error(`writeback cannot handle changeset: ${can.reason ?? 'unknown'}`);
      const doc: DocHandle = { hostId: cs.hostId, bytes: input.bytes, rev: cs.baseRev };
      const res = await backend.commit(cs, doc);
      this.emit({ type: 'commit:done', ok: res.ok, touchedParts: res.touchedParts, fidelity: res.fidelity.score, bytes: res.bytes.length });
      return res;
    } catch (err) {
      this.emit({ type: 'error', stage: 'commit', message: errMsg(err) });
      throw err;
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 收尾语义自检:大改动(≥minEdits 条)结构校验通过后,再让模型把整组改动【作为整体】复盘一次
 * (完整性/冲突/更优解)——满意则原样重交、不满意交修正版。只对大提案多花一轮,
 * 专治"逐条都对、整体却没达成意图"。每个请求只触发一次(闭包记账)。
 */
export function withFinalSelfCheck(structural: ChangeSetVerifier, minEdits = 5): ChangeSetVerifier {
  let selfChecked = false;
  return async (cs) => {
    const v = await structural(cs);
    if (!v.ok) return v;
    if (!selfChecked && cs.edits.length >= minEdits) {
      selfChecked = true;
      return {
        ok: false,
        report: '结构自检通过。收尾自检(最后一步):请把这组改动作为【整体】复盘 —— ①是否完整达成用户意图,有没有漏掉同类问题;②各条改动之间是否冲突/重复命中同一处;③有没有专业上更优的做法。' +
          '全部满意就【原样重新提交同一组改动】;发现问题就提交修正版。这是收尾确认,不要因此缩减本来正确的改动。',
      };
    }
    return v;
  };
}
