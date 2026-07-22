/**
 * Agent model layer (format-agnostic): intent + selection context → constrained ChangeSet.
 * Each host format (Excel/drawio/...) has its own HostDialect: system prompt + tool schema + ChangeSet construction,
 * selected by ProposeRequest.format. Model implementations (Claude/OpenAI-compatible/Mock) only do
 * "call model per dialect → get raw proposal → dialect.buildChangeSet"; the model never emits OOXML/XML directly.
 */
import type { ChangeSet, DocRev, LogicalAnchor, VerifyReport } from '@otterpatch/core';

export interface ProposeRequest {
  hostId: string;
  format: string; // 'excel' | 'drawio' | ... (selects the dialect)
  intent: string;
  baseRev: DocRev;
  anchors: LogicalAnchor[]; // User selection (pixels already converted to anchors)
  context: string; // Read-only snapshot of the selection, fed to the model
  sessionId?: string;
  /** Internal validator feedback for a retry. Kept separate from untrusted document context. */
  proposalFeedback?: string[];
  /** Full sheet data (passed locally to serve, not stuffed into the model prompt; consumed on demand by the read_range/aggregate tools). */
  sheet?: { a1: string; values: unknown[][] };
  /** Full Word document snapshot (per-paragraph text + styles; likewise not in the prompt, fetched on demand via read_blocks/find_text/get_outline/get_style_usage). */
  doc?: { blocks: Array<{ style: string; text: string; font?: string; size?: number; align?: string; lineSpacing?: number }> };
  /** Multi-turn conversation history (user messages + agent answers/change summaries) so this request carries context. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** A host-format "dialect": system prompt + tool (JSON Schema) + construction from raw proposal to ChangeSet. */
export interface HostDialect {
  format: string;
  systemPrompt: string;
  toolName: string;
  toolDescription: string;
  parameters: Record<string, unknown>; // Tool-input JSON Schema (reused as Anthropic input_schema / OpenAI function.parameters)
  buildChangeSet(req: ProposeRequest, proposal: unknown): ChangeSet;
}

/** One candidate option for a clarifying question: user can click it, or type their own under "other". */
export interface ClarifyOption { label: string; description?: string }
/** A clarifying question: Claude Code-style guided choice list (2-4 options) + free-form input allowed; multi = multi-select. */
export interface ClarifyQuestion { header?: string; question: string; options: ClarifyOption[]; multi?: boolean }

/** Agent response to a request: answer a question (chat) / propose sheet changes (diff pending review) / ask clarifying questions back when intent is vague. */
export type AgentResponse =
  | { kind: 'answer'; text: string }
  | { kind: 'changeset'; changeSet: ChangeSet }
  | { kind: 'clarify'; questions: ClarifyQuestion[] };

/** Streaming delta events: thinking (reasoning), answer body (answer), edit-tool input deltas (draft, for "render while generating"), a read-only/verify tool was called, and completion. */
export type StreamEvent =
  | { type: 'reasoning'; delta: string }
  | { type: 'answer'; delta: string }
  | { type: 'draft'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; result: AgentResponse };

/** Shadow verifier: applies the proposal to a shadow copy, recalculates, and produces feedable observations (for propose→observe→repair). */
export type ChangeSetVerifier = (cs: ChangeSet) => VerifyReport | Promise<VerifyReport>;

/** Options for respond/respondStream: shadow verification + repair round cap + host-supplied extra tools. */
export interface RespondOptions {
  /** Run one shadow verification after a proposal; when ok=false, feed the report back to the model so it can fix. Omit = no verification. */
  verify?: ChangeSetVerifier;
  /** Max number of re-proposal attempts when verification fails (default 1). */
  maxRepairs?: number;
  /** Host-supplied read-only tools (e.g. load_skill progressive disclosure): defs merge into the tool menu; exec returning null = not its tool, fall through to the data-fetch routing. */
  extraTools?: { defs: Array<{ name: string; description: string; parameters: Record<string, unknown> }>; exec: (name: string, args: unknown) => string | null };
}

/** Any model implementation (real Claude / OpenAI-compatible / Mock). */
export interface ModelClient {
  /** Produce a ChangeSet only (forced-execution path, kept for definitely-editing scenarios/tests). */
  proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet>;
  /** Smart routing: model itself decides "answer" vs "propose changes" (tool_choice:auto). Optional; falls back to proposeChangeSet if absent. */
  respond?(req: ProposeRequest, dialect: HostDialect, opts?: RespondOptions): Promise<AgentResponse>;
  /** Streaming variant: emits reasoning/answer deltas while generating, ultimately returns the same result as respond. Optional. */
  respondStream?(req: ProposeRequest, dialect: HostDialect, onEvent: (e: StreamEvent) => void, opts?: RespondOptions): Promise<AgentResponse>;
}

/** For tests/offline: given a (req → raw proposal) function, deterministically builds the ChangeSet via the dialect. */
export class MockModelClient implements ModelClient {
  constructor(private readonly fn: (req: ProposeRequest) => unknown) {}
  async proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet> {
    return dialect.buildChangeSet(req, this.fn(req));
  }
  async respond(req: ProposeRequest, dialect: HostDialect, opts?: RespondOptions): Promise<AgentResponse> {
    const cs = dialect.buildChangeSet(req, this.fn(req));
    if (opts?.verify) {
      const v = await opts.verify(cs);
      if (!v.ok) return { kind: 'answer', text: 'Proposal verification failed.\\n' + v.report };
    }
    return { kind: 'changeset', changeSet: cs };
  }
}
