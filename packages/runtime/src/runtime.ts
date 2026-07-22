/**
 * OtterPatchRuntime — headless orchestrator wiring the upstream Agent (propose) to the downstream
 * surgical writeback (commit), producing a reviewable diff in between and emitting structured events
 * for each stage. The MCP server / CLI / desktop all reuse this single kernel.
 *
 * End to end: propose (intent → ChangeSet) → diff (reviewable) → user accepts a subset → commit
 * (surgical writeback → new bytes + fidelity report).
 * Formats are resolved through AdapterRegistry; the runtime never imports a format compiler,
 * verifier, preview engine, or writeback backend directly.
 */
import { Agent, assertProposeRequestBudget } from '@otterpatch/agent';
import type { AgentResponse, ChangeSetVerifier, ModelCallOptions, ModelClient, ProposeRequest, RespondOptions, StreamEvent } from '@otterpatch/agent';
import type {
  AdapterRegistration,
  AdapterRegistry,
  ApprovalPolicy,
  CapabilityStage,
  ChangeSet,
  ChangeSetRiskContext,
  DocHandle,
  FormatCapabilityManifest,
  HostAdapter,
  WritebackBackend,
  WritebackResult,
} from '@otterpatch/core';
import {
  CAPABILITY_MANIFEST_VERSION,
  DEFAULT_POLICY,
  RESOURCE_LIMITS,
  ResourceLimitError,
  assertChangeSet,
  assertJsonBudget,
  decideApproval,
  isResourceLimitError,
} from '@otterpatch/core';
import { defaultLibrary } from '@otterpatch/skills';
import type { SkillLibrary } from '@otterpatch/skills';
import { buildDiff, type OtterPatchDiff } from './diff.js';
import { createBuiltinAdapterRegistry, decorateAdapter } from './adapters.js';
import type { OtterPatchEvent, OtterPatchEventListener } from './events.js';
import { ReviewAuthority, sha256Bytes, type ProposalEnvelope, type ReviewedProposal, type ReviewReceipt } from './review.js';

export interface CommitInput {
  format: string;
  bytes: Uint8Array;
  changeSet: ChangeSet;
  /** Optional cross-check against the receipt. Required in explicitly enabled unreviewed mode. */
  acceptedEditIds?: string[];
  /** Live document revision observed by the caller immediately before commit. */
  currentRev?: import('@otterpatch/core').DocRev;
  proposal?: ProposalEnvelope;
  reviewReceipt?: ReviewReceipt;
  /** Trusted host observations used to classify scope-sensitive risk. */
  riskContext?: ChangeSetRiskContext;
}

export interface DiffInput {
  /** Required for a format-engine preview. Inferred conservatively when omitted. */
  format?: string;
  /** Read-only sheet snapshot used to construct an isolated Excel shadow. */
  sheet?: ProposeRequest['sheet'];
  /** Structured snapshots used by non-grid adapters. */
  board?: ProposeRequest['board'];
  doc?: ProposeRequest['doc'];
  ppt?: ProposeRequest['ppt'];
  /** Trusted host observations used by the contextual risk assessment. */
  riskContext?: ChangeSetRiskContext;
}

export interface OtterPatchRuntimeOptions {
  skills?: SkillLibrary;
  allowUnreviewedCommit?: boolean;
  reviewSecret?: string | Uint8Array;
  reviewTtlMs?: number;
  approvalPolicy?: ApprovalPolicy;
  maxConcurrentModelRequests?: number;
  adapterRegistry?: AdapterRegistry;
}

export class OtterPatchRuntime {
  private readonly listeners = new Set<OtterPatchEventListener>();
  private readonly skills: SkillLibrary;
  private readonly adapters: AdapterRegistry;
  private readonly reviewAuthority: ReviewAuthority;
  private readonly allowUnreviewedCommit: boolean;
  private readonly approvalPolicy: ApprovalPolicy;
  private readonly maxConcurrentModelRequests: number;
  private activeModelRequests = 0;
  private readonly usedReviewNonces = new Map<string, number>();
  private readonly committedSources = new Map<string, number>();
  private readonly commitTails = new Map<string, Promise<void>>();

  constructor(opts: OtterPatchRuntimeOptions = {}) {
    this.skills = opts.skills ?? defaultLibrary();
    this.adapters = opts.adapterRegistry ?? createBuiltinAdapterRegistry();
    this.reviewAuthority = new ReviewAuthority(opts.reviewSecret, opts.reviewTtlMs);
    this.allowUnreviewedCommit = opts.allowUnreviewedCommit ?? false;
    this.approvalPolicy = opts.approvalPolicy ?? DEFAULT_POLICY;
    this.maxConcurrentModelRequests = opts.maxConcurrentModelRequests ?? RESOURCE_LIMITS.concurrentModelRequests;
    if (!Number.isSafeInteger(this.maxConcurrentModelRequests) || this.maxConcurrentModelRequests <= 0 || this.maxConcurrentModelRequests > RESOURCE_LIMITS.concurrentModelRequests) {
      throw new ResourceLimitError('concurrent_model_requests', RESOURCE_LIMITS.concurrentModelRequests, this.maxConcurrentModelRequests);
    }
  }

  /** Subscribe to the event stream; returns an unsubscribe function. */
  on(cb: OtterPatchEventListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  private emit(e: OtterPatchEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // Telemetry/UI listeners are observers and must never abort propose or commit.
      }
    }
  }

  /** Register a complete adapter. Higher priority wins for overlapping formats. */
  registerAdapter(registration: AdapterRegistration): void {
    this.adapters.register(registration);
  }
  /** Compatibility API: override the selected adapter's primary writeback candidate. */
  registerWriteback(format: string, make: () => WritebackBackend): void {
    decorateAdapter(this.adapters, format, { writebacks: () => [make()] });
  }
  /** Add a lower-priority backend used when the primary cannot handle or verify a ChangeSet. */
  registerWritebackFallback(format: string, make: () => WritebackBackend): void {
    decorateAdapter(this.adapters, format, { writebacks: (base) => [...base, make()] });
  }
  /** Register/override the pre-commit checker for a format (lint, simulation, or output verification). */
  registerVerifier(format: string, make: (req: ProposeRequest) => ChangeSetVerifier | undefined): void {
    decorateAdapter(this.adapters, format, {
      proposalVerifier: (input) => make(input.snapshot as ProposeRequest),
    });
  }
  formats(): string[] {
    return this.adapters.formats();
  }
  capabilities(): { version: typeof CAPABILITY_MANIFEST_VERSION; formats: readonly FormatCapabilityManifest[] } {
    return { version: CAPABILITY_MANIFEST_VERSION, formats: this.adapters.manifests() };
  }

  /** Intent → constrained ChangeSet (injects the built-in skill library; BYOK model supplied by the caller). */
  async propose(req: ProposeRequest, model: ModelClient, control: ModelCallOptions = {}): Promise<ChangeSet> {
    assertProposeRequestBudget(req);
    control.signal?.throwIfAborted();
    const release = this.acquireModelSlot();
    let adapter: HostAdapter | undefined;
    this.emit({ type: 'propose:start', format: req.format, intent: req.intent });
    try {
      adapter = this.adapters.create(req.format, req.hostId);
      const routedReq = routeRequest(req, adapter);
      const agent = new Agent(model, undefined, this.skills, undefined, {
        approvalPolicy: this.approvalPolicy,
        allowUnreviewedCommit: this.allowUnreviewedCommit,
      });
      const r = await agent.respond(routedReq, this.verifyOpts(routedReq, adapter, control));
      control.signal?.throwIfAborted();
      if (r.kind !== 'changeset') throw new Error(r.kind === 'answer' ? r.text : 'proposal requires clarification');
      const cs = r.changeSet;
      assertAdapterValid(adapter, cs, 'propose');
      this.emit({ type: 'propose:done', changeSetId: cs.id, editCount: cs.edits.length, ...(cs.meta.planSummary ? { planSummary: cs.meta.planSummary } : {}) });
      return cs;
    } catch (err) {
      this.emit({ type: 'error', stage: 'propose', message: errMsg(err) });
      throw err;
    } finally {
      adapter?.dispose();
      release();
    }
  }

  /** Format check after a proposal: Excel performs simulation; Word performs anchor lint;
   *  drawio simulates topology and PPTX resolves text against exact run boundaries. */
  private verifyOpts(req: ProposeRequest, adapter: HostAdapter, control: ModelCallOptions = {}): RespondOptions | undefined {
    const structural = adapter.proposalVerifier({ context: req.context, snapshot: req });
    if (!structural && !control.signal) return undefined;
    return {
      ...(control.signal ? { signal: control.signal } : {}),
      ...(structural ? { verify: withFinalModelReview(structural), maxRepairs: 2 } : {}),
    };
  }

  /** Smart routing: the model decides on its own whether to answer a question or propose changes. */
  async respond(req: ProposeRequest, model: ModelClient, control: ModelCallOptions = {}): Promise<AgentResponse> {
    assertProposeRequestBudget(req);
    control.signal?.throwIfAborted();
    const release = this.acquireModelSlot();
    let adapter: HostAdapter | undefined;
    this.emit({ type: 'propose:start', format: req.format, intent: req.intent });
    try {
      adapter = this.adapters.create(req.format, req.hostId);
      const routedReq = routeRequest(req, adapter);
      const agent = new Agent(model, undefined, this.skills, undefined, {
        approvalPolicy: this.approvalPolicy,
        allowUnreviewedCommit: this.allowUnreviewedCommit,
      });
      const r = await agent.respond(routedReq, this.verifyOpts(routedReq, adapter, control));
      control.signal?.throwIfAborted();
      if (r.kind === 'changeset') {
        assertAdapterValid(adapter, r.changeSet, 'propose');
        this.emit({ type: 'propose:done', changeSetId: r.changeSet.id, editCount: r.changeSet.edits.length, ...(r.changeSet.meta.planSummary ? { planSummary: r.changeSet.meta.planSummary } : {}) });
      }
      return r;
    } catch (err) {
      this.emit({ type: 'error', stage: 'propose', message: errMsg(err) });
      throw err;
    } finally {
      adapter?.dispose();
      release();
    }
  }

  /** Streaming routing: emits bounded status and answer deltas via onEvent. */
  async respondStream(req: ProposeRequest, model: ModelClient, onEvent: (e: StreamEvent) => void, control: ModelCallOptions = {}): Promise<AgentResponse> {
    assertProposeRequestBudget(req);
    control.signal?.throwIfAborted();
    const release = this.acquireModelSlot();
    let adapter: HostAdapter | undefined;
    this.emit({ type: 'propose:start', format: req.format, intent: req.intent });
    try {
      adapter = this.adapters.create(req.format, req.hostId);
      const routedReq = routeRequest(req, adapter);
      const agent = new Agent(model, undefined, this.skills, undefined, {
        approvalPolicy: this.approvalPolicy,
        allowUnreviewedCommit: this.allowUnreviewedCommit,
      });
      const r = await agent.respondStream(routedReq, onEvent, this.verifyOpts(routedReq, adapter, control));
      control.signal?.throwIfAborted();
      if (r.kind === 'changeset') {
        assertAdapterValid(adapter, r.changeSet, 'propose');
        this.emit({ type: 'propose:done', changeSetId: r.changeSet.id, editCount: r.changeSet.edits.length, ...(r.changeSet.meta.planSummary ? { planSummary: r.changeSet.meta.planSummary } : {}) });
      }
      return r;
    } catch (err) {
      this.emit({ type: 'error', stage: 'propose', message: errMsg(err) });
      throw err;
    } finally {
      adapter?.dispose();
      release();
    }
  }

  /** ChangeSet → reviewable diff. */
  async diff(cs: ChangeSet, input: DiffInput = {}): Promise<OtterPatchDiff> {
    assertChangeSet(cs);
    let adapter: HostAdapter | undefined;
    try {
      const format = (input.format ?? inferFormat(cs)).toLowerCase();
      const snapshot = {
        ...(input.sheet ? { sheet: input.sheet } : {}),
        ...(input.board ? { board: input.board } : {}),
        ...(input.doc ? { doc: input.doc } : {}),
        ...(input.ppt ? { ppt: input.ppt } : {}),
      };
      assertJsonBudget(snapshot, 'adapter_preview_input');
      adapter = this.adapters.create(format, cs.hostId);
      const preview = await adapter.preview(cs, { snapshot });
      const diff = buildDiff(cs, {
        format,
        supportByEdit: preview.supportByEdit,
        expectedTouchedPartsByEdit: preview.expectedTouchedPartsByEdit,
        ...(preview.shadow ? { shadow: preview.shadow } : {}),
        ...(preview.indirectEffects ? { indirectEffects: preview.indirectEffects } : {}),
        ...(preview.unavailableReason ? { unavailableReason: preview.unavailableReason } : {}),
        ...(input.riskContext ? { riskContext: input.riskContext } : {}),
      });
      this.emit({ type: 'diff:done', diff });
      return diff;
    } catch (err) {
      this.emit({ type: 'error', stage: 'diff', message: errMsg(err) });
      throw err;
    } finally {
      adapter?.dispose();
    }
  }

  /** Sign a model proposal before it is shown for review, optionally binding exact source bytes by hash. */
  createProposal(cs: ChangeSet, format: string, documentId = cs.hostId, sourceFileSha256?: string): ProposalEnvelope {
    const adapter = this.adapters.create(format, cs.hostId);
    try {
      if (!adapter.writebacks().length) throw new Error(`OtterPatchRuntime: no writeback backend for format "${format}"`);
      assertAdapterValid(adapter, cs, 'propose');
      return sourceFileSha256
        ? this.reviewAuthority.createProposal(cs, format, documentId, sourceFileSha256)
        : this.reviewAuthority.createProposal(cs, format, documentId);
    } finally {
      adapter.dispose();
    }
  }

  /** Bind the reviewed proposal to exact source bytes and accepted edit IDs. */
  reviewProposal(
    proposal: ProposalEnvelope,
    cs: ChangeSet,
    acceptedEditIds: string[],
    sourceBytes: Uint8Array,
    reviewerSessionId: string,
  ): ReviewedProposal {
    return this.reviewAuthority.review(proposal, cs, acceptedEditIds, sourceBytes, reviewerSessionId);
  }

  /** Accepted subset → surgical writeback → new bytes + fidelity report. */
  async commit(input: CommitInput): Promise<WritebackResult> {
    assertChangeSet(input.changeSet);
    let adapter: HostAdapter;
    try {
      adapter = this.adapters.create(input.format, input.changeSet.hostId);
    } catch {
      throw new Error(`OtterPatchRuntime: no writeback backend for format "${input.format}"`);
    }
    try {
      return await this.commitUsingAdapter(input, adapter);
    } finally {
      adapter.dispose();
    }
  }

  private async commitUsingAdapter(input: CommitInput, adapter: HostAdapter): Promise<WritebackResult> {
    assertAdapterValid(adapter, input.changeSet, 'writeback');
    const backends = [...adapter.writebacks()];
    if (!backends.length) throw new Error(`OtterPatchRuntime: no writeback backend for format "${input.format}"`);
    if (input.currentRev !== undefined && input.currentRev !== input.changeSet.baseRev) {
      throw new Error('changeset is stale: baseRev ' + input.changeSet.baseRev + ' != currentRev ' + input.currentRev);
    }
    let acceptedEditIds: string[];
    let receiptNonce: string | undefined;
    let receiptExpiresAt: number | undefined;
    let hasVerifiedReview = false;
    if (input.proposal && input.reviewReceipt) {
      acceptedEditIds = this.reviewAuthority.verifyForCommit(
        input.proposal,
        input.reviewReceipt,
        input.changeSet,
        input.format,
        input.bytes,
        input.acceptedEditIds,
      );
      receiptNonce = input.reviewReceipt.nonce;
      receiptExpiresAt = Date.parse(input.reviewReceipt.expiresAt);
      hasVerifiedReview = true;
    } else {
      if (input.proposal || input.reviewReceipt) throw new Error('proposal and review receipt must be supplied together');
      if (!this.allowUnreviewedCommit) throw new Error('commit requires a signed proposal and review receipt');
      if (!input.acceptedEditIds) throw new Error('unreviewed commit requires explicit acceptedEditIds');
      acceptedEditIds = input.acceptedEditIds;
    }
    const cs: ChangeSet = { ...input.changeSet, edits: filterAcceptedEdits(input.changeSet, acceptedEditIds) };
    const approval = decideApproval(cs, this.approvalPolicy, { ...input.riskContext, format: input.format });
    if (approval.needsApproval.length && !hasVerifiedReview) {
      throw new Error('unreviewed commit requires human approval for edits: ' + approval.needsApproval.join(', '));
    }
    const sourceHash = input.proposal?.sourceFileSha256 ?? sha256Bytes(input.bytes);
    const documentId = input.proposal?.documentId ?? input.changeSet.hostId;
    const documentKey = JSON.stringify([documentId, input.format]);
    const sourceKey = JSON.stringify([documentId, input.format, sourceHash]);
    try {
      return await this.withDocumentLock(documentKey, async () => {
        if (receiptNonce && this.usedReviewNonces.has(receiptNonce)) throw new Error('review receipt has already been used');
        if (this.committedSources.has(sourceKey)) throw new Error('source file has already been committed; regenerate the proposal from the latest file');
        if (this.committedSources.size >= 10_000) {
          throw new ResourceLimitError('committed_source_cache_entries', 10_000, this.committedSources.size + 1, 'Restart the short-lived runtime before accepting more documents.');
        }
        if (receiptNonce) this.consumeReviewNonce(receiptNonce, receiptExpiresAt!);
        const before: DocHandle = { hostId: cs.hostId, bytes: input.bytes, rev: cs.baseRev };
        const res = await this.commitWithFallback(backends, input.format, cs, before);
        if (res.ok) this.rememberCommittedSource(sourceKey);
        this.emit({ type: 'commit:done', ok: res.ok, touchedParts: res.touchedParts, fidelity: res.fidelity.score, bytes: res.bytes.length });
        return res;
      });
    } catch (err) {
      this.emit({ type: 'error', stage: 'commit', message: errMsg(err) });
      throw err;
    }
  }

  private async commitWithFallback(
    backends: WritebackBackend[],
    format: string,
    cs: ChangeSet,
    before: DocHandle,
  ): Promise<WritebackResult> {
    const failures: string[] = [];
    for (let index = 0; index < backends.length; index++) {
      const backend = backends[index]!;
      const can = backend.canHandle(cs);
      if (!can.ok) {
        failures.push(`${backend.id}: ${can.reason ?? 'cannot handle changeset'}`);
        continue;
      }
      this.emit({ type: 'commit:start', format, strategy: backend.strategy, editCount: cs.edits.length });
      try {
        const result = await backend.commit(cs, before);
        const after: DocHandle = { hostId: cs.hostId, bytes: result.bytes, rev: (Number(cs.baseRev) + 1) as import('@otterpatch/core').DocRev };
        const verification = await backend.verify(before, after, cs);
        assertVerification(verification, cs);
        if (!verification.verification.packageValid) {
          throw new Error('writeback verification found an invalid output package');
        }
        if (result.ok && verification.verification.semantic.failedEdits.length) {
          throw new Error('writeback semantic verification failed: ' + verification.verification.semantic.failedEdits.map((failure) => failure.editId).join(', '));
        }
        if (verification.drift.length) {
          throw new Error('writeback verification found unexpected drift: ' + verification.drift.map((d) => d.part).join(', '));
        }
        const verifiedResult = { ...result, fidelity: verification };
        const withFallback = index > 0 ? { ...verifiedResult, fallbackUsed: backend.strategy } : verifiedResult;
        return withFallback;
      } catch (error) {
        if (isResourceLimitError(error)) throw error;
        throw new Error(`writeback backend ${backend.id} failed after execution started: ${errMsg(error)}`, { cause: error });
      }
    }
    throw new Error('all writeback backends failed: ' + failures.join('; '));
  }

  private async withDocumentLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.commitTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.commitTails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.commitTails.get(key) === tail) this.commitTails.delete(key);
    }
  }

  private rememberCommittedSource(key: string): void {
    this.committedSources.set(key, Date.now());
  }

  private acquireModelSlot(): () => void {
    if (this.activeModelRequests >= this.maxConcurrentModelRequests) {
      throw new ResourceLimitError(
        'concurrent_model_requests',
        this.maxConcurrentModelRequests,
        this.activeModelRequests + 1,
        'Wait for an active model request to finish before retrying.',
      );
    }
    this.activeModelRequests++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeModelRequests--;
    };
  }

  private consumeReviewNonce(nonce: string, expiresAt: number): void {
    const limit = 10_000;
    if (this.usedReviewNonces.size >= limit) {
      const now = Date.now();
      for (const [usedNonce, expiry] of this.usedReviewNonces) {
        if (expiry < now) this.usedReviewNonces.delete(usedNonce);
      }
    }
    if (this.usedReviewNonces.size >= limit) {
      throw new ResourceLimitError('review_nonce_cache_entries', limit, this.usedReviewNonces.size + 1, 'Wait for expired review receipts to be pruned.');
    }
    this.usedReviewNonces.set(nonce, expiresAt);
  }
}

function assertVerification(report: import('@otterpatch/core').FidelityReport, changeSet: ChangeSet): void {
  if (!Number.isFinite(report.score) || report.score < 0 || report.score > 1 || !Array.isArray(report.drift)) {
    throw new Error('writeback verifier returned an invalid fidelity report');
  }
  const verification = report.verification;
  if (!verification || typeof verification !== 'object') throw new Error('writeback verifier omitted structured verification metrics');
  const ratio = verification.locality?.unchangedPartRatio;
  const validArrays = Array.isArray(verification.locality?.intendedParts)
    && Array.isArray(verification.locality?.unexpectedParts)
    && Array.isArray(verification.semantic?.verifiedEdits)
    && Array.isArray(verification.semantic?.unverifiableEdits)
    && Array.isArray(verification.semantic?.failedEdits)
    && Array.isArray(verification.compatibility?.warnings);
  if (typeof verification.packageValid !== 'boolean' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1
    || report.score !== ratio || !validArrays) {
    throw new Error('writeback verifier returned invalid verification metrics');
  }
  const intended = verification.locality.intendedParts;
  const unexpected = verification.locality.unexpectedParts;
  const verified = verification.semantic.verifiedEdits;
  const unverifiable = verification.semantic.unverifiableEdits;
  const failed = verification.semantic.failedEdits;
  const allStrings = [...intended, ...unexpected, ...verified, ...unverifiable, ...verification.compatibility.warnings].every((value) => typeof value === 'string');
  const failureShape = failed.every((failure) => failure && typeof failure.editId === 'string' && typeof failure.reason === 'string' && failure.reason.length > 0);
  const partition = [...verified, ...unverifiable, ...failed.map((failure) => failure.editId)];
  const expectedIds = changeSet.edits.map((edit) => edit.id);
  const sameIds = partition.length === expectedIds.length
    && new Set(partition).size === partition.length
    && expectedIds.every((editId) => partition.includes(editId));
  const uniqueParts = new Set(intended).size === intended.length
    && new Set(unexpected).size === unexpected.length
    && unexpected.every((part) => !intended.includes(part));
  if (!allStrings || !failureShape || !sameIds || !uniqueParts) {
    throw new Error('writeback verifier returned inconsistent verification metrics');
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

function assertAdapterValid(adapter: HostAdapter, cs: ChangeSet, stage: CapabilityStage): void {
  const validation = adapter.validate(cs, stage);
  if (validation.ok) return;
  const details = validation.issues.map((issue) => `${issue.editId || 'changeset'}: ${issue.message ?? issue.code}`).join('; ');
  throw new Error(`${adapter.meta.format} adapter rejected ${stage}: ${details}`);
}

function routeRequest(req: ProposeRequest, adapter: HostAdapter): ProposeRequest {
  return req.format === adapter.meta.format ? req : { ...req, format: adapter.meta.format };
}

function inferFormat(cs: ChangeSet): string {
  const kinds = new Set(Object.values(cs.anchors).map((anchor) => anchor.portable.kind));
  if (kinds.size === 1 && kinds.has('grid')) return 'excel';
  if (kinds.size === 1 && kinds.has('flow')) return 'word';
  if (kinds.size === 1 && kinds.has('object')) return 'drawio';
  return 'unknown';
}

/**
 * Final model review: for large changesets (≥ minEdits edits) that pass structural checks, ask
 * the model to review the whole edit group (completeness / conflicts / better alternatives).
 * Costs one extra round only for large proposals; targets the failure mode where each edit is
 * individually correct but the set as a whole misses the intent. This is deliberately labeled
 * non-deterministic and must never be presented as semantic verification.
 */
export function withFinalModelReview(structural: ChangeSetVerifier, minEdits = 5): ChangeSetVerifier {
  let reviewRequested = false;
  return async (cs) => {
    const v = await structural(cs);
    if (!v.ok) return v;
    if (!reviewRequested && cs.edits.length >= minEdits) {
      reviewRequested = true;
      return {
        ok: false,
        level: 'model_review',
        code: 'FINAL_MODEL_REVIEW_REQUIRED',
        details: { kind: 'model_review', deterministic: false },
        report: '确定性结构检查已通过。现在进行一次非确定性的模型整体复盘:①是否完整达成用户意图,有没有漏掉同类问题;②各条改动之间是否冲突或重复命中;③有没有专业上更优的做法。' +
          '全部满意就原样重新提交同一组改动;发现问题就提交修正版。模型复盘不是 semantic verification,不要因此缩减本来正确的改动。',
      };
    }
    return v;
  };
}
