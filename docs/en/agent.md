# The Agent Loop

Everything the model can do, and how we keep it honest.

## Routing (three exits, one loop)

The system prompt (`ROUTING_PREAMBLE`, `packages/agent/src/prompts/agent-loop.ts`) fixes the
contract: the model must end every turn in exactly one tool call —

- `answer_user` — questions/consulting; never touches the document
- `propose_changeset` — the **only** mutation exit; plan first, edits reviewed before landing
- `ask_user` — a guided clarify table (2–4 options per question) when the intent is genuinely
  ambiguous and guessing is costly

Between those exits, both model channels (`anthropic.ts`, `openai-compat.ts`) run the same bounded
loop over the provider-agnostic tool definitions in `sheet-tools.ts` / `doc-tools.ts`. Budgets are
independent: 12 total model calls, 8 read-tool calls, the configured proposal-repair allowance
(capped at 4), one truncation repair, 65,536 cumulative output tokens, and 120 seconds total.
Provider-reported output tokens are used when available; streaming fallbacks use a conservative
UTF-8 byte count. Exhausting one repair category never borrows from another.

Provider transport is controlled explicitly instead of relying on SDK defaults. Each HTTP attempt
uses the smaller of the 90-second provider timeout and the request's remaining 120-second budget;
SDK retries are disabled. Transient network, timeout, 409, 429, and 5xx failures receive at most two
retries with exponential backoff (250 ms, capped at 4 s, with jitter), while a longer `Retry-After`
is honored up to 60 seconds. Three
failed requests open a provider/model circuit for 30 seconds, followed by one half-open probe.
Errors are normalized into stable categories such as `authentication`, `rate_limit`, `timeout`,
`network`, and `unavailable`. One `AbortSignal` runs from the desktop cancel control through the
local HTTP disconnect handler and Runtime into provider calls and retry sleeps.
Only request establishment is retried; once a response stream has yielded output, a transport
failure is surfaced instead of replaying a potentially duplicated tool call or draft.

## Read tools (perceive before acting)

| Format | Tool | Purpose |
|---|---|---|
| Excel | `read_range` | exact cell values for any A1 range (never guess from samples) |
| Excel | `aggregate` | typed column aggregation with explicit `headerRows`, plus `groupBy` / `where` |
| Word | `read_blocks` | full text of paragraph ranges (the prompt context truncates long paragraphs — quotes must come from real text) |
| Word | `find_text` | all occurrences with block numbers — quote-uniqueness checks |
| Word | `get_outline` | heading tree + level-skip diagnosis |
| Word | `get_style_usage` | style/font/size/alignment distribution — the raw material of a typography audit |
| any | `load_skill` | pull a domain playbook's full instructions (see [skills.md](./skills.md)) |

Snapshots ride along on the request (`ProposeRequest.sheet` / `.doc`) and are only visible to the
tools — they are not pasted into the prompt. Word context/snapshots annotate images per paragraph
(`[图片 alt 宽×高]`), so the agent knows where each image sits and how big it is.
Sheet cells carry host-observed scalar kinds (number, percent, currency, date, text, blank, error,
or boolean). Aggregation uses underlying numeric values and never converts display strings such as
`"50%"`; callers must state how many leading rows are headers.

## Word structured ops: dual-channel anchoring / deletePara / images

- **Dual-channel anchoring**: `quote` (source-text fragment, preferred) + `para` (1-based
  paragraph number, from the context's "第N段" or `read_blocks`). Empty paragraphs and duplicated
  text become anchorable; a failed quote lookup falls back to the paragraph number.
- **deletePara**: a whole-paragraph deletion op (clear empty paragraphs, drop redundant ones).
  Within a batch it lands in **descending** paragraph order to prevent index drift; deletions left
  pending across turns are physically finalized when the next proposal arrives, so paragraph
  numbers match the snapshot.
- **Image ops** (`setObjectProps`): `img=remove` deletes only the image, keeping the paragraph's
  text; `img=resize` + `imgWidth` scales proportionally. Users can also click-select an image in
  the workspace as the circled target (selection outline, reported as a "第N段" position).
- **Excel value × format hard gate** (prompt-level): writing into a percent-formatted cell must
  use decimals — 41% is `0.41`; writing `120` renders as 12000%, a units accident. Mock data must
  look real (variance within columns, derived columns as formulas, ratios as decimals).
- **Diff label completion**: line spacing / paragraph styles / columns / margins / page
  orientation no longer collapse into a generic "apply format" label; `deleteRange` and image ops
  get proper labels; flow refs with an empty quote display as "第N段".

## Checks: lint → simulation → output verification

Every `propose_changeset` runs the strongest check supported by its format before it becomes a
diff (registry in `packages/runtime/src/runtime.ts`, `registerVerifier(format, make)`). Reports
carry an explicit `level` (`lint`, `simulation`, or `verification`) and a stable failure `code`:

- **Excel simulation** (`buildGridVerifier`) — expands every range cell, applies supported value,
  formula, clear, and style operations, then recalculates supported formulas. A complete formula
  matrix is required; unknown functions, cycles, missing style observations, conflicting overlaps, and
  out-of-snapshot targets fail closed.
- **Word lint** (`buildDocVerifier`) — every quote must resolve uniquely, or the edit must carry a
  valid structured paragraph index. Duplicate quotes are blocking ambiguity, not warnings.
- **drawio topology simulation** (`buildDrawioVerifier`) — with a structured board snapshot it
  replays additions, relationship edits, moves, and cascading deletes, then rejects duplicate ids,
  missing parents, parent cycles, self references, and dangling edges. Legacy text context gets
  exact-token lint only, never substring matching.

Failures are returned to the model as a structured report in the same turn. The capability
manifest no longer advertises preview or verification for formats that only have writeback support.

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
