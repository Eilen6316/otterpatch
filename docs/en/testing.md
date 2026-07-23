# Testing

The authoritative test matrix is [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
Avoid documenting assertion counts: they change frequently and provide less signal than the behavior
contract.

## Local CI baseline

Use Node.js 22. A reproducible local baseline is:

```bash
npm ci
npm run typecheck
npm test
npm run test:real-writeback
npm run build
npm run test:serve-security
npm run test:ui
```

`npm test` runs every workspace with a declared test script. `npm run build` builds every workspace
and generates the static playbook manifest before compiling the skills package.

## Workspace tests

| Area | Current contract |
|---|---|
| `core` | UUIDv7, strict ChangeSet semantics/provenance, resource/range limits, risk scope, capability manifests, registry and revision hashing |
| `agent` | trusted/untrusted prompt boundary, provider response identity, dialect/capability alignment, typed read tools, independent repair budgets, retries/circuit/cancellation, reasoning suppression, Word/drawio proposal verification |
| `skills` | generated catalog, namespace/trust/version/checksum rules, external-skill isolation, locale/matching, capability intersection, obsolete-operation regression checks |
| `runtime` | adapter conformance, signed proposal/review binding, source/revision checks, single-use receipts, risk enforcement, document locking, fallback rules, listener isolation, structured fidelity validation |
| format adapters | exact write-back behavior, dropped-edit honesty, anchor ambiguity, formula recalculation, XML tokenization, drawio topology, PDF field read-back, PPTX run boundaries |
| desktop | review-state algebra, snapshot binding, browser token plumbing, IPC schema/size bounds, clean Word projection, Excel/drawio replay, commit receipt flow |
| MCP/HTTP | document decoding limits, client abort propagation, token/origin/rate/concurrency security helpers |

The runner is `node --import tsx --test`; package-specific commands use workspace names, for
example:

```bash
npm test --workspace @otterpatch/runtime
npm test --workspace @otterpatch/desktop
```

## Real write-back and service security

`npm run test:real-writeback` creates and patches real-format fixtures for XLSX, DOCX text, DOCX
tables, PPTX, uncompressed drawio, and PDF. It verifies the requested output and important locality
invariants.

`npm run test:serve-security` starts isolated service instances and checks generated/configured
tokens, exact-origin CORS, anonymous/authorized behavior, review-token enforcement, proposal/source
binding, revision spoofing, body limits, and rate limiting. It requires no provider key.

Security-sensitive unit regressions additionally cover adversarial prompt text, malicious or
oversized ChangeSets, ZIP/path/XML corpora, unsupported formula/cycle behavior, hostile skill
metadata, receipt replay, invalid Fidelity reports, and untrusted Electron IPC payloads.

## Browser behavior contract

After `npm run build`, CI installs Playwright Chromium and runs these scripts against
`apps/desktop/dist` with mocked local-service responses:

```text
ui-smoke
drawio-review-e2e
richdoc-toolbar
richdoc-projection-e2e
richdoc-editing-e2e
richdoc-revisions-e2e
word-agent-mock
word-review-e2e
word-table-e2e
word-docfmt-e2e
word-autobatch-e2e
word-docx-import-e2e
excel-agent-mock
```

They exercise effects rather than component presence: values and formulas are replayed, accepted
Word revisions flatten, rejected changes restore before-state, table/block order survives import,
review state persists, and no console/page errors occur. Run one directly with:

```bash
node test/word-review-e2e.mjs
```

`npm run test:ui` is the fast `ui-smoke` subset, not the complete browser matrix.

## Packaged desktop smoke

CI has a separate Windows and macOS job that:

1. installs the Electron runtime;
2. builds the packaged local service;
3. creates an unpacked desktop application;
4. launches the production app and verifies that it loaded the expected local UI.

Relevant local commands:

```bash
npm run build --workspace @otterpatch/mcp-server
npm run app:pack:dir --workspace @otterpatch/desktop
npm run test:packaged --workspace @otterpatch/desktop
```

## Real-model checks

The CI `real-model-smoke` job runs on `main` only when the repository secret
`OtterPatch_API_KEY` exists:

```bash
OtterPatch_API_KEY=... OtterPatch_PROVIDER=claude npm run smoke
```

The capability bench is headless and appends scored results to `test/bench-results.jsonl`:

```bash
OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs
BENCH_ONLY=w-gongwen OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs
```

It combines objective invariants with an LLM judge. Missing `OTTERPATCH_BENCH_KEY` prints `SKIP`
and exits successfully.

The `eval:*`, `excel-agent.mjs`, and `expert-eval.mjs` scripts are manual development utilities,
not CI gates. Several UI live-eval scripts predate the current Electron/browser local-token split
and still serve a production Vite bundle outside Electron; migrate them to an authenticated browser
development or Electron bridge before treating their result as authoritative. Their model keys
(`OA_EVAL_KEY` or `OTTERPATCH_TEST_KEY`) must never be committed.

## Test hygiene

- Keep deterministic fixtures and test scripts under `test/` or their owning package.
- Do not use real provider keys, service tokens, review tokens, or private documents in fixtures.
- Prefer `npm ci` in CI and when validating the lockfile.
- Assert fail-closed behavior and returned structure, not only a happy-path UI element.
- A test that intentionally skips must say why and use a distinct key gate.
