# OtterPatch Documentation

These documents describe the current `main` implementation for contributors and integrators.
Capability claims come from the versioned manifest; security claims identify both enforced controls
and host responsibilities.

| Document | Contents |
|---|---|
| [architecture.md](./architecture.md) | trust-aware propose, review, commit, and verification pipeline; package ownership; host responsibilities |
| [security.md](./security.md) | threat model, prompt/skill isolation, provenance, signed review authority, resource/provider/HTTP/Electron controls, limitations |
| [agent.md](./agent.md) | routing, prompt boundary, read tools, provider budgets, proposal checks, provenance, batching |
| [skills.md](./skills.md) | built-in/generated playbooks, capability-aware disclosure, external-skill trust rules |
| [review-ux.md](./review-ux.md) | workspace previews, per-edit decisions, Word/Excel/drawio replay, source-bound commit flow |
| [testing.md](./testing.md) | current CI baseline, workspace/adversarial tests, real write-back, Playwright and packaged desktop smoke |
| [ooxml-redline-notes.md](./ooxml-redline-notes.md) | native Word revision semantics, covered behavior, remaining OOXML backlog |
| [bench.md](./bench.md) | historical capability-bench calibration record; current suite lives in `test/expert-bench.mjs` |

## Invariants

1. **One mutation exit:** model-driven document changes are structured ChangeSets.
2. **Untrusted data stays data:** document and external-skill content never gains system authority.
3. **Capabilities fail closed:** the same manifest constrains proposal, preview, verification, and
   write-back.
4. **Identity is bound:** agent provenance, source SHA-256, derived revision, ChangeSet hash,
   policy, and format remain linked through proposal and receipt.
5. **Approval is explicit:** every committed edit ID comes from a signed, expiring review receipt
   by default.
6. **Commit is serialized and verified:** runtime locks per document, never replays a started
   backend, and requires output read-back.
7. **The host owns persistence:** verified bytes still need backup-aware atomic storage and durable
   audit handling from the embedding application.
