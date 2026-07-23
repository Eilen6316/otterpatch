# Capability Bench: Calibration History

This is a historical snapshot of the six calibration rounds run on 2026-07-02. The current bench
contains 16 tasks; [`test/expert-bench.mjs`](../../test/expert-bench.mjs) and
[`test/bench-results.jsonl`](../../test/bench-results.jsonl) are the source of truth.

The bench combines objective invariants (response kind, required tools, required/forbidden
ChangeSet shapes, anchors) with an LLM judge scored from 1 to 5.

## 2026-07-02: DeepSeek / deepseek-v4-pro

| Round | Tasks | Invariant failures | Mean judge | Change and finding |
|---|---:|---:|---:|---|
| R1 | 8 | 2 | 2.75 | Baseline: ambiguous requests triggered broad edits; judge handling did not fit reasoning models |
| R2 | 8 | 1 | 3.38 | Added hard clarification rule and reasoning-content judge fallback; `w-gongwen` then hit the step limit |
| R3 | 8 | 0 | 4.00 | Increased expert-loop step budget from 8 to 12 |
| R4 | 12 | 1* | 4.42 | Added four multi-turn cases and improved Word polish/gongwen guidance; the only failure was a bench anchor assertion bug |
| R5 | 12 | 3 | 4.67 | Improved continuation and chart defaults; found three prose-only exits that fooled the judge |
| R6 | 12 | 0 | 4.58 | Added `NUDGE_TOOLIFY` and made typed text-numbers visible to `read_range`; objective suite cleared |

## Lessons retained

1. Prompt changes guide preference; tool output changes what the model can observe; channel/runtime
   checks enforce contracts. Use the strongest appropriate layer.
2. Objective invariants catch attractive but invalid prose that an LLM judge may reward.
3. Single-run scores have variance. Require repeated evidence before treating a score movement as a
   model or prompt regression.
4. Desktop per-edit acceptance/rejection remains the product signal; offline evaluation is a guard,
   not a substitute.

## Reproduce the current suite

```bash
OTTERPATCH_BENCH_KEY=<key> \
OTTERPATCH_BENCH_PROVIDER=deepseek \
BENCH_MODEL=deepseek-v4-pro \
node test/expert-bench.mjs
```

Without a key, the script prints `SKIP` and exits successfully.
