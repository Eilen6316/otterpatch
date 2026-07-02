# The Agent Loop

Everything the model can do, and how we keep it honest.

## Routing (three exits, one loop)

The system prompt (`ROUTING_PREAMBLE`, `packages/agent/src/prompts/agent-loop.ts`) fixes the
contract: the model must end every turn in exactly one tool call —

- `answer_user` — questions/consulting; never touches the document
- `propose_changeset` — the **only** mutation exit; plan first, edits reviewed before landing
- `ask_user` — a guided clarify table (2–4 options per question) when the intent is genuinely
  ambiguous and guessing is costly

Between those, the model may call **read tools** for up to `STEP_LIMIT = 8` loop steps. Both model
channels (`anthropic.ts`, `openai-compat.ts`) implement the identical loop over the shared
provider-agnostic tool definitions in `sheet-tools.ts` / `doc-tools.ts`.

## Read tools (perceive before acting)

| Format | Tool | Purpose |
|---|---|---|
| Excel | `read_range` | exact cell values for any A1 range (never guess from samples) |
| Excel | `aggregate` | column aggregation with `groupBy` / `where` — pivots, sums, anomaly stats |
| Word | `read_blocks` | full text of paragraph ranges (the prompt context truncates long paragraphs — quotes must come from real text) |
| Word | `find_text` | all occurrences with block numbers — quote-uniqueness checks |
| Word | `get_outline` | heading tree + level-skip diagnosis |
| Word | `get_style_usage` | style/font/size/alignment distribution — the raw material of a typography audit |
| any | `load_skill` | pull a domain playbook's full instructions (see [skills.md](./skills.md)) |

Snapshots ride along on the request (`ProposeRequest.sheet` / `.doc`) and are only visible to the
tools — they are not pasted into the prompt.

## Shadow verification: propose → observe → repair

Every `propose_changeset` is verified before it becomes a diff (verifier registry in
`packages/runtime/src/runtime.ts`, `registerVerifier(format, make)`):

- **Excel** (`buildGridVerifier`) — recompute + bounds + duplicate-hit checks
- **Word** (`buildDocVerifier`) — every quote must exist **and be unique** in the source text; empty
  edits and duplicate hits are flagged
- **drawio** (`buildDrawioVerifier`) — topology integrity: `update/delete/move` targets must exist;
  new edges must connect to existing or same-proposal nodes (no dangling edges); no duplicate ids

Failures are returned to the model as a structured report in the same turn; it may repair up to
`maxRepairs = 2` times.

**Final self-check** (`withFinalSelfCheck`): once a *large* changeset (≥5 edits) passes structural
verification, the model gets exactly one "review your own work as a whole" round — completeness,
conflicts, better approaches — then resubmits (unchanged if satisfied). Small changesets skip this.

## Prompt caching

The Anthropic channel splits the system prompt into a **stable prefix** (routing + dialect +
skills — identical across turns) and a **volatile tail** (this turn's document snapshot), each with
a `cache_control` breakpoint. Result: every step of an 8-step loop hits the cache for the entire
system prompt; across turns the stable prefix still hits.

## Batching (serial, never parallel)

Long outputs are split into batches: the plan declares "first N items", and after acceptance the
user can click **继续下一批** — or enable **⚡自动续批** (auto-continue, opt-in, persisted), which
auto-sends "下一批" after each acceptance, capped at 5 consecutive auto-batches. Each batch is a
full propose → verify → review round anchored against the *current* document.

Why not parallel sub-agents for batches? All anchors (quotes / A1 refs) are resolved against one
document revision; the moment batch A lands, batch B's anchors go stale — silent no-ops or
mislanded edits. Parallelism is safe for **reads** (diagnosis fan-out) but writes must converge to
a single serially-anchored changeset. If sub-agents are ever introduced, the design is:
parallel readers → one writer → one changeset → one review.

## History & state the model sees

`buildHistory` projects each past turn into one line, including the **net outcome** — "user
accepted N items" / "user reverted these" — so the model never re-proposes landed changes or builds
on reverted ones. Approval state survives context trimming (dropped turns leave a status summary).
