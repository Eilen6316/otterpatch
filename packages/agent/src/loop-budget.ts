import { RESOURCE_LIMITS, ResourceLimitError, utf8ByteLength, type VerifyReport } from '@otterpatch/core';

export interface AgentLoopLimits {
  modelCalls: number;
  readToolCalls: number;
  truncationRepairs: number;
  totalOutputTokens: number;
  totalDurationMs: number;
}

const DEFAULT_LIMITS: AgentLoopLimits = {
  modelCalls: RESOURCE_LIMITS.agentModelCalls,
  readToolCalls: RESOURCE_LIMITS.agentReadToolCalls,
  truncationRepairs: RESOURCE_LIMITS.agentTruncationRepairs,
  totalOutputTokens: RESOURCE_LIMITS.agentTotalOutputTokens,
  totalDurationMs: RESOURCE_LIMITS.agentTotalDurationMs,
};

function positiveLimit(value: number, resource: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${resource} must be a positive safe integer`);
  return value;
}

export function validProposalRepairs(value?: number): number {
  const repairs = value ?? 1;
  if (!Number.isSafeInteger(repairs) || repairs < 0 || repairs > RESOURCE_LIMITS.agentProposalRepairs) {
    throw new ResourceLimitError('agent_proposal_repairs', RESOURCE_LIMITS.agentProposalRepairs, Number(repairs));
  }
  return repairs;
}

/** Independent, per-request budgets for the provider agent loop. */
export class AgentLoopBudget {
  private readonly startedAt: number;
  private modelCalls = 0;
  private readToolCalls = 0;
  private proposalRepairs = 0;
  private truncationRepairs = 0;
  private outputTokens = 0;

  readonly limits: AgentLoopLimits;
  readonly maxProposalRepairs: number;

  constructor(
    maxProposalRepairs: number,
    limits: Partial<AgentLoopLimits> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.maxProposalRepairs = validProposalRepairs(maxProposalRepairs);
    this.limits = {
      modelCalls: positiveLimit(limits.modelCalls ?? DEFAULT_LIMITS.modelCalls, 'agent_model_calls'),
      readToolCalls: positiveLimit(limits.readToolCalls ?? DEFAULT_LIMITS.readToolCalls, 'agent_read_tool_calls'),
      truncationRepairs: positiveLimit(limits.truncationRepairs ?? DEFAULT_LIMITS.truncationRepairs, 'agent_truncation_repairs'),
      totalOutputTokens: positiveLimit(limits.totalOutputTokens ?? DEFAULT_LIMITS.totalOutputTokens, 'agent_total_output_tokens'),
      totalDurationMs: positiveLimit(limits.totalDurationMs ?? DEFAULT_LIMITS.totalDurationMs, 'agent_total_duration_ms'),
    };
    this.startedAt = this.now();
  }

  beginModelCall(): number {
    this.assertDuration();
    if (this.modelCalls >= this.limits.modelCalls) {
      throw new ResourceLimitError('agent_model_calls', this.limits.modelCalls, this.modelCalls + 1);
    }
    this.modelCalls++;
    return this.remainingDurationMs();
  }

  finishStep(): void {
    this.assertDuration();
  }

  tryReadTools(count: number): boolean {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('read-tool count must be a non-negative safe integer');
    this.assertDuration();
    if (this.readToolCalls + count > this.limits.readToolCalls) return false;
    this.readToolCalls += count;
    return true;
  }

  tryProposalRepair(): boolean {
    this.assertDuration();
    if (this.proposalRepairs >= this.maxProposalRepairs) return false;
    this.proposalRepairs++;
    return true;
  }

  tryTruncationRepair(): boolean {
    this.assertDuration();
    if (this.truncationRepairs >= this.limits.truncationRepairs) return false;
    this.truncationRepairs++;
    return true;
  }

  recordOutput(text: string, reportedTokens?: number): void {
    const tokens = reportedTokens !== undefined && Number.isFinite(reportedTokens) && reportedTokens >= 0
      ? Math.ceil(reportedTokens)
      : utf8ByteLength(text);
    this.outputTokens += tokens;
    if (this.outputTokens > this.limits.totalOutputTokens) {
      throw new ResourceLimitError('agent_total_output_tokens', this.limits.totalOutputTokens, this.outputTokens);
    }
    this.assertDuration();
  }

  remainingDurationMs(): number {
    const elapsed = Math.max(0, this.now() - this.startedAt);
    const remaining = this.limits.totalDurationMs - elapsed;
    if (remaining <= 0) {
      throw new ResourceLimitError('agent_total_duration_ms', this.limits.totalDurationMs, elapsed);
    }
    return remaining;
  }

  private assertDuration(): void {
    this.remainingDurationMs();
  }
}

export function verificationFailureText(report: VerifyReport): string {
  const code = report.code ? ` (${report.code})` : '';
  return `Proposal verification failed${code}; repair budget exhausted.\n${report.report}`;
}

export function readToolLimitText(): string {
  return `Agent stopped after reaching the read-tool limit (${RESOURCE_LIMITS.agentReadToolCalls}). Narrow the request or provide a smaller source range.`;
}
