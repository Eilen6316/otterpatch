# `test/` integration and browser suites

Package unit tests live with their owners. This directory contains cross-package regressions,
Playwright behavior tests, screenshots/manual utilities, and key-gated model evaluations. The full
matrix is documented in [`docs/en/testing.md`](../docs/en/testing.md) and
[`docs/zh/testing.md`](../docs/zh/testing.md).

## Deterministic commands

```bash
npm run test:real-writeback     # xlsx/docx/docx-table/pptx/drawio/pdf
npm run test:serve-security     # local auth, review authority, binding, limits
npm run build                   # required before Playwright scripts
npm run test:ui                 # quick UI smoke
node test/word-review-e2e.mjs   # run one browser suite directly
```

CI runs 13 browser scripts listed in `.github/workflows/ci.yml`; `test:ui` is only the fast subset.
`harness.mjs` statically serves `apps/desktop/dist` and starts Playwright Chromium. Most deterministic
browser suites mock the local-service response and require no model key.

## Real-model utilities

```bash
OtterPatch_API_KEY=... npm run smoke
OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs
```

Other `eval:*`, `excel-agent.mjs`, and `expert-eval.mjs` files are manual development utilities.
Several older UI live-eval scripts still need migration to the authenticated browser/Electron token
transport; they are not CI gates.

Never commit provider keys, `OtterPatch_TOKEN`, `OtterPatch_REVIEW_TOKEN`, private documents, or
generated screenshots containing sensitive data. Keep new cross-package scripts in this directory,
not as root-level scratch files.
