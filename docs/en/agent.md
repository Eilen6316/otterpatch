# The Agent Loop

The model may reason about a document, but trusted code decides which operations exist, whether a
proposal is valid, and whether anything can be committed.

## Three exits

Every conversational turn ends through exactly one tool:

- `answer_user`: answer or analyze without changing the document;
- `ask_user`: request a small guided choice when guessing would be costly;
- `propose_changeset`: the only mutation exit. It returns a plan plus structured operations, never
  raw OOXML/XML or direct filesystem commands.

Provider channels share the same dialect, read tools, budget accounting, proposal verifier, and
repair protocol. A prose-only result is nudged once into the appropriate tool; failure to produce a
usable result then fails explicitly.

## Prompt boundary

Fixed policy, the active capability constraints, and immutable built-in skill metadata are trusted
system text. Request-specific document content is encoded in the user message:

```json
{"untrusted_data":true,"kind":"document_context","content":"..."}
```

Document instructions such as "ignore previous rules" therefore remain data. Full snapshots are
available only to bounded read tools. External skill bodies are also returned as untrusted tool
data. See [security.md](./security.md).

## Independent budgets and transport controls

The default loop limits are:

| Budget | Limit |
|---|---:|
| total model calls | 12 |
| read-tool calls | 8 |
| proposal repairs | caller-selected, maximum 4 |
| truncation repairs | 1 |
| cumulative output | 65,536 tokens |
| total duration | 120 seconds |

These counters do not borrow from one another. Provider output is also bounded by 16,384 tokens
and 300,000 characters.

Each provider attempt uses the smaller of its 90-second timeout and the remaining loop budget.
SDK retries are disabled. Eligible network, timeout, 409, 429, and 5xx failures receive at most two
controlled retries with jittered exponential backoff; `Retry-After` is honored up to 60 seconds.
Repeated failures open a provider/model circuit before one half-open probe. Errors use a stable
taxonomy (`authentication`, `permission`, `invalid_request`, `rate_limit`, `timeout`, `network`,
`unavailable`, `aborted`).

One `AbortSignal` runs from UI cancellation or HTTP disconnect through runtime, provider requests,
and retry waits. Once a response stream yields output it is never replayed. Raw provider reasoning
and thinking deltas are suppressed; callers receive generated status events and final-answer data.

## Read tools

| Format | Tool | Purpose |
|---|---|---|
| Excel | `read_range` | exact typed values for a bounded A1 area |
| Excel | `aggregate` | typed aggregation with explicit `headerRows`, `groupBy`, and `where` |
| Word | `read_blocks` | complete text for bounded block ranges |
| Word | `find_text` | every occurrence plus block numbers for uniqueness checks |
| Word | `get_outline` | heading tree and level-skip diagnosis |
| Word | `get_style_usage` | style/font/size/alignment distribution |
| any | `load_skill` | fetch a capability-compatible playbook as untrusted tool data |

Sheet cells preserve host-observed number, percent, currency, date, text, blank, error, and boolean
types. Aggregation never turns display strings such as `"50%"` into numbers. Word snapshots retain
block boundaries and image metadata. Tool result size and source range are bounded before execution.

## Capability-driven proposal construction

Each format dialect is built around the same `capabilities-v2` manifest used by runtime. Only
operations with current proposal and write-back support appear in the model schema, and stock hosts
instantiate only default/active adapters. The dialect builder then creates anchors and operations,
attaches trusted provenance, and immediately runs `assertChangeSet`.

Agent provenance includes provider/model identity, the actual provider response ID, source hash,
prompt-policy version, parent proposal, repair attempt, loaded skill versions/checksums, session,
user, and document identity. ChangeSet IDs are monotonic UUIDv7. Repair attempts preserve the same
trusted bindings while recording the new response identity and attempt number.

## Proposal checks and repair

The selected `HostAdapter` supplies the strongest deterministic proposal verifier it can support:

| Format | Current proposal check |
|---|---|
| Excel | expands supported ranges into an isolated grid shadow, applies values/formulas/styles/clear, and recalculates the supported formula subset; unknown functions, cycles, incomplete observations, conflicts, and out-of-snapshot targets fail closed |
| Word | requires a real unique quote or a valid structured paragraph anchor; when both are present the paragraph constrains the quote |
| drawio | replays board edits and rejects duplicate IDs, missing parents, parent cycles, self references, and dangling edges |

The Agent package retains the frozen PPTX dialect and exact slide/paragraph/run verifier for hosts
that explicitly register `pptxAdapterRegistration`. It is not reachable through the stock runtime,
MCP, HTTP, CLI, or desktop. PDF has no dialect because support was removed.

A deterministic failure returns a structured code/report to the model within the same turn. Runtime
allows at most two proposal repairs in its built-in path.

For a ChangeSet with at least five edits, `withFinalModelReview` requests one additional holistic
model pass after deterministic checks succeed. It is explicitly labeled `model_review` and
non-deterministic. It can improve completeness, but it is not semantic verification and never
replaces backend output read-back.

## Word operation details

- Flow anchors can combine a source quote with a one-based top-level block index. A top-level table
  counts as one block; paragraphs inside it do not. This mirrors the importer and writer.
- Whole-paragraph deletion is represented as a reviewed delete operation and lands in descending
  block order to avoid index drift.
- Image operations currently remove an image run or resize `wp:extent`/`a:ext` proportionally.
- Local character style needs a non-empty quote; paragraph style needs a paragraph anchor. Page
  columns, margins, and orientation require an empty document-level anchor and explicit
  document scope. Unanchored document-wide character/paragraph styling is not supported.
- Table insertion uses structured rectangular string data and explicit document placement.

## Skills, batching, and history

Built-in playbooks are matched by format, intent, locale, and current operation capabilities. Their
version and checksum enter provenance. External skills cannot enter trusted system text and cannot
extend capabilities. See [skills.md](./skills.md).

Large jobs are split into serial batches. Each accepted batch produces a new request against the
current document state; auto-continue is opt-in and capped at five consecutive batches. Parallel
reads are safe, but parallel writers would resolve anchors against stale revisions.

Conversation history stores compact net outcomes such as accepted/rejected edit summaries instead
of transient UI state. This helps the next turn avoid proposing already-landed work while staying
inside the fixed history budget.

Anthropic caches only the stable system block. Request-specific document data remains in the user
message and does not cross the trust boundary for cache efficiency.
