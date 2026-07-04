# Testing

Four layers: package unit tests (fast, always run), headless e2e against the built cockpit
(mocked model), live evals (real model driving the real cockpit, key-gated), and a capability
bench (real model, scored). All test scripts live in `test/` and are committed (no more root
`_*.mjs` scratch scripts); live evals take their API key from the `OA_EVAL_KEY` env var, the
bench from `OTTERPATCH_BENCH_KEY`.

## Package unit tests (`npm test -w @otterpatch/<pkg>`)

| Package | Covers |
|---|---|
| `agent` | dialect construction, provider factory, message normalization, repair loop, json salvage, **doc tools** (read_blocks/find_text/outline/style-usage), **word verifier** (quote landability), **drawio verifier** (dangling edges / ghost ids) |
| `skills` | SKILL.md parsing, matching & ranking (incl. playbook tiebreak), render/L0, `instructionsFor`, playbook content |
| `runtime` | event stream, verifier registry wiring, **final self-check** protocol (large-changeset review round) |
| `adapter-*`, `writeback-surgical` | compile + surgical write-back fidelity; `adapter-word` gained 7 tests: deletePara (quote / para number / self-closing empty para / empty para with pPr), image resize/remove, `w:tbl` block-order mirroring, paragraph format on an empty paragraph |

Runner: `node --import tsx --test` (see each package.json). Note: package.json files must stay
**BOM-free** — tsx's JSON reader rejects a UTF-8 BOM.

## Headless e2e (`node test/<name>.mjs`)

`test/harness.mjs` statically serves `apps/desktop/dist` and drives headless Chromium
(Playwright); `/propose-stream` is intercepted with fixed SSE — no model, no key. **Build first**
(`npm run build -w @otterpatch/desktop`).

| Suite | Asserts |
|---|---|
| `word-agent-mock` (23) | context includes per-paragraph formatting + selection; loose-match landing; inline marks; 4-state toggle; accept-all physically clears all marks |
| `word-review-e2e` (10) | hover-card accept flattens one change; no text vanishing in any view state; second-turn context excludes deleted text; reload mid-review keeps approvals working |
| `word-docfmt-e2e` (10) | doc-level chips for `all=true` + page-level (two-column) changes; true before/after toggling; chip accept/reject; batch-continue button |
| `word-autobatch-e2e` (5) | ⚡auto-continue sends "下一批" after acceptance without a click; stops when the plan stops declaring batches |
| `excel-agent-mock` (14) | git-style diff; real grid values via the `__univerGet` hook: reject restores 120, view toggle doesn't resurrect rejected edits, accept-all re-lands them |
| `richdoc-toolbar` (21) | ribbon commands actually mutate the document; icon de-duplication; instant tooltips |
| `ui-smoke` (7) | app boots, grid renders, selection chip, drawio drop, zero console errors |

Conventions: assert **effects, not presence** (a card that opens must also *work* when clicked —
presence-only assertions once masked a dead accept button); read real state (computed styles, grid
values via test hooks) rather than class names when possible.

## Live evals (real model + real cockpit; needs a local serve + `OA_EVAL_KEY`)

Drive the real model against a running `otterpatch-serve` (`http://localhost:4319`) and assert
end-to-end:

| npm script | Asserts |
|---|---|
| `eval:excel` | consulting doesn't touch the grid / totals row lands as a formula / chart overlay appears |
| `eval:excel:sanity` | value × number-format sanity (reads proposal ops directly, e.g. percent cells must take decimals) |
| `eval:word` | general Word capability smoke |
| `eval:word:struct` | empty-paragraph cleanup / deletePara / image awareness / resize / remove — 13 assertions |
| `eval:word:commit` | the hero loop: import a docx → propose → accept all → surgical write-back download → unzip and assert `w:ins`/`w:del`/paragraph-mark deletion — 10 assertions |

Without `OA_EVAL_KEY` they error out (exit 2) — no accidental dry runs on a fake key.

## Capability bench (`test/expert-bench.mjs`, key-gated)

Runs the real model through 16 tasks (Word polish/structure/gongwen/ambiguous, Excel
formula/anomaly/chart/ambiguous, multi-turn continue/revert scenarios, plus this week's
`w-cleanup-empty` / `w-img-resize` / `w-img-remove` / `x-pct-mock`) and scores two layers:

1. **Objective invariants** — response kind (changeset vs clarify), required tool calls
   (`read_blocks`, `aggregate`, `load_skill`…), required op shapes (`=SUM`, `chart`), **forbidden
   op shapes** (`opsForbid`, e.g. an image-removal task must not emit `deleteRange`), and
   structured custom checks (`check`, e.g. "values written into a gross-margin cell must be ≤2").
2. **LLM judge** — 1–5 rubric score per task.

Results append to `test/bench-results.jsonl` for trend tracking. Without `OTTERPATCH_BENCH_KEY`
it prints SKIP and exits 0 (CI-safe).

```bash
OTTERPATCH_BENCH_KEY=sk-ant-... node test/expert-bench.mjs
BENCH_ONLY=w-gongwen OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs   # single task
```

## Acceptance telemetry (the production signal)

The desktop counts every per-item accept/reject by format × change type
(`localStorage['oa.telemetry']`, console: `__otterTelemetry()`). Falling acceptance in a category
is a regression signal no offline test can give you — feed it back into playbooks and prompts.
