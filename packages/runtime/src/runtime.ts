/**
 * OtterPatchRuntime — headless orchestrator wiring the upstream Agent (propose) to the downstream
 * surgical writeback (commit), producing a reviewable diff in between and emitting structured events
 * for each stage. The MCP server / CLI / desktop all reuse this single kernel.
 *
 * End to end: propose (intent → ChangeSet) → diff (reviewable) → user accepts a subset → commit
 * (surgical writeback → new bytes + fidelity report).
 * Writeback backends are routed by format: excel/xlsx → surgical OOXML (Univer compiler);
 * drawio → single-XML surgical edit.
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
  /** Commit only these edits (result of per-block acceptance); omitted = accept all. */
  acceptedEditIds?: string[];
  /** Live document revision observed by the caller immediately before commit. */
  currentRev?: import('@otterpatch/core').DocRev;
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

  /** Subscribe to the event stream; returns an unsubscribe function. */
  on(cb: OtterPatchEventListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  private emit(e: OtterPatchEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Register/override the writeback backend for a format (Word redline / PDF etc. to be added later). */
  registerWriteback(format: string, make: () => WritebackBackend): void {
    this.backends[format] = make;
  }
  /** Register/override the shadow verifier for a format (same registry pattern as backends; ppt/pdf etc. later). */
  registerVerifier(format: string, make: (req: ProposeRequest) => ChangeSetVerifier | undefined): void {
    this.verifiers[format] = make;
  }
  formats(): string[] {
    return Object.keys(this.backends);
  }

  /** Intent → constrained ChangeSet (injects the built-in skill library; BYOK model supplied by the caller). */
  async propose(req: ProposeRequest, model: ModelClient): Promise<ChangeSet> {
    this.emit({ type: 'propose:start', format: req.format, intent: req.intent });
    try {
      const agent = new Agent(model, undefined, this.skills);
      const r = await agent.respond(req, this.verifyOpts(req));
      if (r.kind !== 'changeset') throw new Error(r.kind === 'answer' ? r.text : 'proposal requires clarification');
      const cs = r.changeSet;
      this.emit({ type: 'propose:done', changeSetId: cs.id, editCount: cs.edits.length, ...(cs.meta.planSummary ? { planSummary: cs.meta.planSummary } : {}) });
      return cs;
    } catch (err) {
      this.emit({ type: 'error', stage: 'propose', message: errMsg(err) });
      throw err;
    }
  }

  /** Shadow verification after a proposal is produced (routed by format via the registry): Excel recalculation/out-of-bounds; Word anchors resolvable; drawio topology intact.
   *  Wrapped in an outer final semantic self-check (withFinalSelfCheck). */
  private verifyOpts(req: ProposeRequest): RespondOptions | undefined {
    const structural = this.verifiers[req.format]?.(req);
    if (!structural) return undefined;
    return { verify: withFinalSelfCheck(structural), maxRepairs: 2 };
  }

  /** Smart routing: the model decides on its own whether to answer a question or propose changes. */
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

  /** Streaming routing: emits reasoning/answer deltas via onEvent. */
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

  /** ChangeSet → reviewable diff. */
  diff(cs: ChangeSet): OtterPatchDiff {
    const d = buildDiff(cs);
    this.emit({ type: 'diff:done', diff: d });
    return d;
  }

  /** Accepted subset → surgical writeback → new bytes + fidelity report. */
  async commit(input: CommitInput): Promise<WritebackResult> {
    const make = this.backends[input.format];
    if (!make) throw new Error(`OtterPatchRuntime: no writeback backend for format "${input.format}"`);
    const backend = make();
    if (input.currentRev !== undefined && input.currentRev !== input.changeSet.baseRev) {
      throw new Error('changeset is stale: baseRev ' + input.changeSet.baseRev + ' != currentRev ' + input.currentRev);
    }
    const cs: ChangeSet = input.acceptedEditIds
      ? { ...input.changeSet, edits: filterAcceptedEdits(input.changeSet, input.acceptedEditIds) }
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

function filterAcceptedEdits(cs: ChangeSet, acceptedEditIds: string[]): ChangeSet['edits'] {
  if (!acceptedEditIds.length) throw new Error('acceptedEditIds must not be empty');
  const editIds = new Set(cs.edits.map((e) => e.id));
  const seen = new Set<string>();
  for (const id of acceptedEditIds) {
    if (!editIds.has(id)) throw new Error('acceptedEditIds contains unknown edit id: ' + id);
    if (seen.has(id)) throw new Error('acceptedEditIds contains duplicate edit id: ' + id);
    seen.add(id);
  }
  return cs.edits.filter((e) => seen.has(e.id));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Final semantic self-check: for large changesets (≥ minEdits edits) that pass structural
 * verification, have the model review the whole edit group as a unit (completeness / conflicts /
 * better alternatives) — resubmit unchanged if satisfied, or submit a corrected version.
 * Costs one extra round only for large proposals; targets the failure mode where each edit is
 * individually correct but the set as a whole misses the intent. Fires at most once per request
 * (tracked via closure state).
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
