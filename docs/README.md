# OtterPatch Docs

Documentation for contributors and integrators. Start with the architecture, then dive into the layer you're touching.

| Doc | What it covers |
|---|---|
| [architecture.md](./architecture.md) | The propose → diff → review → commit pipeline, package map, core invariants |
| [agent.md](./agent.md) | The agent loop: routing, read tools, shadow verification & repair, self-check, prompt caching, batching |
| [skills.md](./skills.md) | Skill system: capability cards vs. playbooks, progressive disclosure (`load_skill`), external SKILL.md install |
| [review-ux.md](./review-ux.md) | The review experience: Word inline tracked changes (flatten-on-accept), doc-level chips, Excel before-state replay |
| [testing.md](./testing.md) | Test pyramid: package unit tests, headless e2e harness, capability bench, acceptance telemetry |

## The one-paragraph pitch

Agents shouldn't edit your files directly. In OtterPatch an agent only **proposes** a structured
`ChangeSet`; the system verifies it against a shadow copy (and makes the model repair its own
mistakes), shows a **reviewable diff** — inline tracked changes in the workspace, a git-style diff
in the rail — and only after per-item human approval writes back **surgically**: only the touched
parts of the file change, everything else stays byte-identical.

## Core invariants (do not break these)

1. **Single mutation exit** — every document change goes through `propose_changeset`. No other tool mutates documents.
2. **Review before commit** — nothing lands in the file without per-item human accept/reject.
3. **Surgical write-back** — untouched parts stay byte-identical; fidelity is measured and reported.
4. **Serial writes** — proposals are anchored against the current document state; batches continue serially (never parallel writers), so anchors can't go stale mid-flight.
