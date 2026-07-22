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
import { Agent, assertProposeRequestBudget, assertSheetSnapshotBudget, buildDocVerifier, buildDrawioVerifier } from '@otterpatch/agent';
import type { AgentResponse, ChangeSetVerifier, ModelClient, ProposeRequest, RespondOptions, StreamEvent } from '@otterpatch/agent';
import type { ApprovalPolicy, CellValue, ChangeSet, ChangeSetRiskContext, DocHandle, WritebackBackend, WritebackResult } from '@otterpatch/core';
import {
  CAPABILITY_MANIFEST_VERSION,
  DEFAULT_POLICY,
  RESOURCE_LIMITS,
  ResourceLimitError,
  assertChangeSet,
  assertFormatCapabilities,
  assertJsonBudget,
  capabilityManifests,
  decideApproval,
  isResourceLimitError,
  supportsFormatOperation,
} from '@otterpatch/core';
import { SurgicalOoxmlWriteback } from '@otterpatch/writeback-surgical';
import {
  GridChangeSetEngine,
  GridSimulationError,
  buildXlsxCompiler,
  buildGridVerifier,
  expandGridRange,
  gridEngineSupports,
  gridShadowFromSnapshot,
  sheetSnapshotContains,
  sheetSnapshotHasCompleteFormulaState,
  sheetSnapshotHasStyleAt,
  type GridShadow,
  type SheetSnapshot,
} from '@otterpatch/adapter-univer';
import { DrawioSurgicalWriteback } from '@otterpatch/adapter-drawio';
import { WordRedlineWriteback } from '@otterpatch/adapter-word';
import { PdfFormWriteback } from '@otterpatch/adapter-pdf';
import { buildPptxCompiler } from '@otterpatch/adapter-pptx';
import { defaultLibrary } from '@otterpatch/skills';
import type { SkillLibrary } from '@otterpatch/skills';
import {
  buildDiff,
  type DiffObservation,
  type DiffSupport,
  type OtterPatchDiff,
  type OtterPatchDiffEffect,
} from './diff.js';
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
  sheet?: SheetSnapshot;
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
}

export class OtterPatchRuntime {
  private readonly listeners = new Set<OtterPatchEventListener>();
  private readonly skills: SkillLibrary;
  private readonly backends: Record<string, () => WritebackBackend>;
  private readonly fallbackBackends: Record<string, Array<() => WritebackBackend>> = {};
  private readonly verifiers: Record<string, (req: ProposeRequest) => ChangeSetVerifier | undefined>;
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
    this.reviewAuthority = new ReviewAuthority(opts.reviewSecret, opts.reviewTtlMs);
    this.allowUnreviewedCommit = opts.allowUnreviewedCommit ?? false;
    this.approvalPolicy = opts.approvalPolicy ?? DEFAULT_POLICY;
    this.maxConcurrentModelRequests = opts.maxConcurrentModelRequests ?? RESOURCE_LIMITS.concurrentModelRequests;
    if (!Number.isSafeInteger(this.maxConcurrentModelRequests) || this.maxConcurrentModelRequests <= 0 || this.maxConcurrentModelRequests > RESOURCE_LIMITS.concurrentModelRequests) {
      throw new ResourceLimitError('concurrent_model_requests', RESOURCE_LIMITS.concurrentModelRequests, this.maxConcurrentModelRequests);
    }
    this.verifiers = {
      excel: (req) => (req.sheet ? buildGridVerifier(req.sheet) : undefined),
      xlsx: (req) => (req.sheet ? buildGridVerifier(req.sheet) : undefined),
      word: (req) => (req.doc ? buildDocVerifier(req.doc) : req.context.trim() ? buildDocVerifier(req.context) : undefined),
      docx: (req) => (req.doc ? buildDocVerifier(req.doc) : req.context.trim() ? buildDocVerifier(req.context) : undefined),
      drawio: (req) => (req.board ? buildDrawioVerifier(req.board) : req.context.trim() ? buildDrawioVerifier(req.context) : undefined),
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
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // Telemetry/UI listeners are observers and must never abort propose or commit.
      }
    }
  }

  /** Register/override the writeback backend for a format (Word redline / PDF etc. to be added later). */
  registerWriteback(format: string, make: () => WritebackBackend): void {
    this.backends[format] = make;
  }
  /** Add a lower-priority backend used when the primary cannot handle or verify a ChangeSet. */
  registerWritebackFallback(format: string, make: () => WritebackBackend): void {
    (this.fallbackBackends[format] ??= []).push(make);
  }
  /** Register/override the pre-commit checker for a format (lint, simulation, or output verification). */
  registerVerifier(format: string, make: (req: ProposeRequest) => ChangeSetVerifier | undefined): void {
    this.verifiers[format] = make;
  }
  formats(): string[] {
    return Object.keys(this.backends);
  }
  capabilities(): { version: typeof CAPABILITY_MANIFEST_VERSION; formats: ReturnType<typeof capabilityManifests> } {
    return { version: CAPABILITY_MANIFEST_VERSION, formats: capabilityManifests() };
  }

  /** Intent → constrained ChangeSet (injects the built-in skill library; BYOK model supplied by the caller). */
  async propose(req: ProposeRequest, model: ModelClient): Promise<ChangeSet> {
    assertProposeRequestBudget(req);
    const release = this.acquireModelSlot();
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
    } finally {
      release();
    }
  }

  /** Format check after a proposal: Excel performs simulation; Word performs anchor lint;
   *  drawio simulates topology when a structured board snapshot is supplied. */
  private verifyOpts(req: ProposeRequest): RespondOptions | undefined {
    const structural = this.verifiers[req.format]?.(req);
    if (!structural) return undefined;
    return { verify: withFinalSelfCheck(structural), maxRepairs: 2 };
  }

  /** Smart routing: the model decides on its own whether to answer a question or propose changes. */
  async respond(req: ProposeRequest, model: ModelClient): Promise<AgentResponse> {
    assertProposeRequestBudget(req);
    const release = this.acquireModelSlot();
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
    } finally {
      release();
    }
  }

  /** Streaming routing: emits reasoning/answer deltas via onEvent. */
  async respondStream(req: ProposeRequest, model: ModelClient, onEvent: (e: StreamEvent) => void): Promise<AgentResponse> {
    assertProposeRequestBudget(req);
    const release = this.acquireModelSlot();
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
    } finally {
      release();
    }
  }

  /** ChangeSet → reviewable diff. */
  async diff(cs: ChangeSet, input: DiffInput = {}): Promise<OtterPatchDiff> {
    assertChangeSet(cs);
    try {
      if (input.sheet) {
        assertJsonBudget(input.sheet, 'sheet_snapshot');
        assertSheetSnapshotBudget(input.sheet);
      }
      const format = (input.format ?? inferFormat(cs)).toLowerCase();
      const observation = await buildDiffObservation(cs, format, input.sheet, input.riskContext);
      const diff = buildDiff(cs, observation);
      this.emit({ type: 'diff:done', diff });
      return diff;
    } catch (err) {
      this.emit({ type: 'error', stage: 'diff', message: errMsg(err) });
      throw err;
    }
  }

  /** Sign a model proposal before it is shown for review. The source file is bound when review completes. */
  createProposal(cs: ChangeSet, format: string, documentId = cs.hostId): ProposalEnvelope {
    if (!this.backends[format]) throw new Error(`OtterPatchRuntime: no writeback backend for format "${format}"`);
    assertFormatCapabilities(format, cs, 'propose');
    return this.reviewAuthority.createProposal(cs, format, documentId);
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
    assertFormatCapabilities(input.format, input.changeSet, 'writeback');
    const make = this.backends[input.format];
    if (!make) throw new Error(`OtterPatchRuntime: no writeback backend for format "${input.format}"`);
    const backends = [make(), ...(this.fallbackBackends[input.format] ?? []).map((factory) => factory())];
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
    let partial: WritebackResult | undefined;
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
        assertVerification(verification);
        if (verification.drift.length) {
          throw new Error('writeback verification found unexpected drift: ' + verification.drift.map((d) => d.part).join(', '));
        }
        const withFallback = index > 0 ? { ...result, fallbackUsed: backend.strategy } : result;
        if (result.ok) return withFallback;
        partial = withFallback;
        failures.push(`${backend.id}: partial writeback`);
      } catch (error) {
        if (isResourceLimitError(error)) throw error;
        failures.push(`${backend.id}: ${errMsg(error)}`);
      }
    }
    if (partial) return partial;
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

function assertVerification(report: import('@otterpatch/core').FidelityReport): void {
  if (!Number.isFinite(report.score) || report.score < 0 || report.score > 1 || !Array.isArray(report.drift)) {
    throw new Error('writeback verifier returned an invalid fidelity report');
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

function inferFormat(cs: ChangeSet): string {
  const kinds = new Set(Object.values(cs.anchors).map((anchor) => anchor.portable.kind));
  if (kinds.size === 1 && kinds.has('grid')) return 'excel';
  if (kinds.size === 1 && kinds.has('flow')) return 'word';
  if (kinds.size === 1 && kinds.has('object')) return 'drawio';
  return 'unknown';
}

async function buildDiffObservation(
  cs: ChangeSet,
  format: string,
  sheet: SheetSnapshot | undefined,
  riskContext: ChangeSetRiskContext | undefined,
): Promise<DiffObservation> {
  const base: DiffObservation = {
    format,
    ...(riskContext ? { riskContext } : {}),
  };
  if (format !== 'excel' && format !== 'xlsx') {
    return { ...base, unavailableReason: `No ${format} preview simulation is registered.` };
  }
  if (!sheet) {
    return { ...base, unavailableReason: 'Excel diff requires a read-only sheet snapshot.' };
  }

  const supportByEdit: Record<string, DiffSupport> = {};
  for (const edit of cs.edits) {
    const anchor = cs.anchors[edit.target];
    const gridAnchor = anchor?.portable.kind === 'grid' ? anchor.portable : undefined;
    let refs: string[] = [];
    if (gridAnchor) {
      try {
        refs = expandGridRange(gridAnchor.a1);
      } catch {
        refs = [];
      }
    }
    const snapshotCoversTargets = Boolean(gridAnchor
      && refs.length > 0
      && refs.every((ref) => sheetSnapshotContains(sheet, ref, gridAnchor.sheet)));
    const needsStyleSnapshot = edit.op.kind === 'setStyle' || edit.op.kind === 'setNumberFormat';
    const needsFormulaSnapshot = edit.op.kind === 'setValue' || edit.op.kind === 'setFormula' || edit.op.kind === 'deleteRange';
    const snapshotCoversStyles = !needsStyleSnapshot || (
      gridAnchor
      && refs.every((ref) => sheetSnapshotHasStyleAt(sheet, ref, gridAnchor.sheet))
    );
    const snapshotCoversFormulas = !needsFormulaSnapshot || sheetSnapshotHasCompleteFormulaState(sheet);
    if (!supportsFormatOperation(format, edit.op.kind, 'preview') || !supportsFormatOperation(format, edit.op.kind, 'writeback')) {
      supportByEdit[edit.id] = 'unsupported';
    } else if (
      gridEngineSupports(edit.op.kind)
      && snapshotCoversTargets
      && snapshotCoversStyles
      && snapshotCoversFormulas
    ) {
      supportByEdit[edit.id] = 'verified';
    } else {
      supportByEdit[edit.id] = 'partial';
    }
  }

  const executable = cs.edits.filter((edit) => supportByEdit[edit.id] === 'verified');
  if (!executable.length) {
    return {
      ...base,
      supportByEdit,
      unavailableReason: 'The Excel simulation engine did not simulate any proposed operations.',
    };
  }

  try {
    const beforeGrid = gridShadowFromSnapshot(sheet);
    const afterGrid = gridShadowFromSnapshot(sheet);
    const engine = new GridChangeSetEngine();
    const beforeResult = await engine.shadowApply({ ...cs, edits: [] }, beforeGrid);
    const shadow = await engine.shadowApply({ ...cs, edits: executable }, afterGrid);
    const indirectEffects = formulaEffects(
      cs,
      executable.map((edit) => edit.id),
      sheet,
      beforeGrid,
      afterGrid,
      beforeResult.effects.recalculated ?? [],
      shadow.effects.recalculated ?? [],
    );
    const partialCount = Object.values(supportByEdit).filter((support) => support !== 'verified').length;
    return {
      ...base,
      shadow,
      supportByEdit,
      indirectEffects,
      ...(partialCount ? { unavailableReason: `${partialCount} operation(s) were not fully simulated.` } : {}),
    };
  } catch (error) {
    for (const editId of Object.keys(supportByEdit)) {
      if (supportByEdit[editId] === 'verified') supportByEdit[editId] = 'partial';
    }
    return {
      ...base,
      supportByEdit,
      unavailableReason: `Excel simulation failed: ${error instanceof GridSimulationError ? error.code + ': ' : ''}${errMsg(error)}`,
    };
  }
}

function bareGridRef(value: string): string {
  return value.replace(/^.*!/, '').replace(/\$/g, '').toUpperCase();
}

function formulaEffects(
  cs: ChangeSet,
  editIds: string[],
  sheet: SheetSnapshot,
  beforeGrid: GridShadow,
  afterGrid: GridShadow,
  beforeRows: CellValue[][],
  afterRows: CellValue[][],
): OtterPatchDiffEffect[] {
  const directTargets = new Set(
    cs.edits
      .filter((edit) => editIds.includes(edit.id)
        && (edit.op.kind === 'setValue' || edit.op.kind === 'setFormula' || edit.op.kind === 'deleteRange'))
      .map((edit) => cs.anchors[edit.target])
      .filter((anchor) => anchor?.portable.kind === 'grid')
      .flatMap((anchor) => anchor?.portable.kind === 'grid' ? expandGridRange(anchor.portable.a1).map(bareGridRef) : []),
  );
  const before = recalculatedMap(beforeRows);
  const after = recalculatedMap(afterRows);
  const refs = new Set([...before.keys(), ...after.keys()]);
  const sheetName = sheet.name ?? (/^(.*?)!/.exec(sheet.a1)?.[1]?.replace(/^'|'$/g, ''));
  const effects: OtterPatchDiffEffect[] = [];
  for (const ref of refs) {
    if (directTargets.has(ref)) continue;
    const beforeValue = before.get(ref);
    const afterValue = after.get(ref);
    const beforeFormula = beforeGrid.get(ref)?.formula;
    const afterFormula = afterGrid.get(ref)?.formula;
    if (Object.is(beforeValue, afterValue) && beforeFormula === afterFormula) continue;
    const target = sheetName ? `${sheetName}!${ref}` : ref;
    const effect: OtterPatchDiffEffect = {
      target,
      kind: 'formula-recalculation',
      summary: `formula recalculated at ${target}`,
      editIds: [...editIds],
    };
    if (before.has(ref)) effect.before = { kind: 'cell', value: beforeValue ?? null, ...(beforeFormula ? { formula: beforeFormula } : {}) };
    if (after.has(ref)) effect.after = { kind: 'cell', value: afterValue ?? null, ...(afterFormula ? { formula: afterFormula } : {}) };
    effects.push(effect);
  }
  return effects;
}

function recalculatedMap(rows: CellValue[][]): Map<string, CellValue> {
  const result = new Map<string, CellValue>();
  for (const row of rows) {
    const ref = row[0];
    if (typeof ref !== 'string') continue;
    result.set(ref.toUpperCase(), row[1] ?? null);
  }
  return result;
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
        level: 'lint',
        code: 'FINAL_SEMANTIC_SELF_CHECK_REQUIRED',
        report: '结构自检通过。收尾自检(最后一步):请把这组改动作为【整体】复盘 —— ①是否完整达成用户意图,有没有漏掉同类问题;②各条改动之间是否冲突/重复命中同一处;③有没有专业上更优的做法。' +
          '全部满意就【原样重新提交同一组改动】;发现问题就提交修正版。这是收尾确认,不要因此缩减本来正确的改动。',
      };
    }
    return v;
  };
}
