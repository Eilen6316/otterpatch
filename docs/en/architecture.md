# Architecture

OtterPatch is a review and commit boundary between an LLM agent and a structured document. The
agent proposes intent-level operations; trusted code owns validation, approval, write-back, and
verification.

## Product lifecycle

- Excel and Word are active, default-registered product formats.
- drawio is default-registered only as a secondary compatibility integration.
- PDF has been removed from the repository and dependency graph.
- PPTX retains its adapter, dialect, manifest, and unit tests as `opt-in` / `frozen`. A host must
  import `pptxAdapterRegistration` and call `runtime.registerAdapter(...)`; stock hosts never do.

## End-to-end pipeline

```text
 trusted host identity + user intent          untrusted document projection
                 |                                      |
                 +------------------+-------------------+
                                    v
                         bounded Agent loop
                 answer_user | ask_user | propose_changeset
                                    |
                                    v
                       UUIDv7 ChangeSet + provenance
                                    |
             schema/semantic/budget/capability validation
                                    |
                 adapter proposal check + shadow preview
                                    |
                                    v
             signed ProposalEnvelope bound to source SHA-256
                                    |
                         per-edit human review
                                    |
                                    v
            signed, expiring, single-use ReviewReceipt
                                    |
      source/revision/hash/policy/risk checks + document lock
                                    |
                                    v
                     adapter-selected write-back backend
                                    |
                   reopen output + backend.verify(...)
                                    |
                                    v
         package | locality | semantic | compatibility report
                                    |
                                    v
             verified bytes returned to the embedding host
```

The runtime never treats an in-workspace preview as the committed file. Commit starts again from
the exact source bytes bound to the proposal and receipt.

## Ownership

| Package | Responsibility |
|---|---|
| `packages/core` | `Anchor`, `ChangeSet`, semantic validation, UUIDv7, resource limits, capability/risk models, adapter and write-back contracts |
| `packages/agent` | bounded provider loop, format dialects generated from capabilities, read-only tools, untrusted-context envelope, provider controls, provenance capture |
| `packages/skills` | immutable built-in capability cards, generated playbook catalog, capability-aware matching, isolated external skill text |
| `packages/runtime` | adapter routing, proposal checks, diff construction, proposal/review signatures, risk enforcement, per-document locking, backend execution, mandatory verification |
| `packages/adapter-*` | one format control plane: manifest, validator, proposal verifier, preview, touched-part expectations, ordered write-back candidates |
| `packages/writeback-surgical` | budgeted OOXML ZIP/XML handling, intended-part patching, byte-locality comparison |
| `apps/mcp-server` | MCP stdio, explicit-confirmation CLI, authenticated loopback HTTP bridge |
| `apps/desktop` | Excel/Word/drawio workspaces, per-edit review, browser development client, sandboxed Electron main/renderer boundary |

## Trust boundaries

### Request and model

The host supplies document/user/session identity and, for file-backed work, the source SHA-256.
These values are prepared before the model call. Document context is serialized as
`{ untrusted_data: true, kind: "document_context", content: ... }` in a user message; it is never
concatenated into the system prompt. Read-tool output and external skill bodies use the same
untrusted-data boundary.

An agent-produced ChangeSet records the provider, model, provider response ID, prompt-policy
version, source hash, parent proposal, repair count, skill versions/checksums, and actor identity.
The model cannot supply or replace those fields. Proposal signing cross-checks provenance against
the trusted host identity and source hash.

### Proposal and review

`ProposalEnvelope` signs the canonical ChangeSet hash, document ID, format, base revision,
capability version, review-policy version, source hash, and expiry. `ReviewReceipt` signs the
accepted edit IDs, proposal/hash/source bindings, reviewer session, expiry, and a nonce.

Commit requires both objects by default. The receipt is single-use within a runtime process, and
the exact source is also remembered after a successful commit so a stale source cannot be committed
again. A missing, expired, tampered, mismatched, or replayed receipt fails closed.

### Commit

The accepted subset is rebuilt from the reviewed ChangeSet and validated against the selected
adapter at the write-back stage. Runtime applies contextual risk policy, serializes commits by
`[documentId, format]`, rejects stale revisions, and chooses the first backend that declares it can
handle the whole subset. Fallback is allowed only before a backend begins execution; execution
failure is terminal to avoid replay after partial side effects.

After commit, runtime calls `backend.verify(before, after, acceptedChangeSet)`. The verifier must
cover every accepted edit exactly once as `verified`, `unverifiable`, or `failed`. Runtime rejects
legacy/incomplete reports, invalid packages, semantic failure from an allegedly successful backend,
and unexpected drift. The final read-back report replaces any optimistic commit-time report.

## Fidelity report

The old scalar score is not a general quality metric. It remains only as an alias for locality's
unchanged-outside-target ratio.

| Dimension | Meaning |
|---|---|
| `packageValid` | the output can be reopened by the backend's package/parser checks |
| `locality` | intended parts, unexpected changed parts, and byte-identical ratio outside intended parts |
| `semantic` | disjoint, complete lists of verified, unverifiable, and failed edit IDs |
| `compatibility` | explicit backend limitations and application-compatibility warnings |

OOXML and drawio can report meaningful locality. Excel and Word conservatively mark applied edits
`unverifiable` until format-specific output read-back exists. Excel's pre-review grid simulation is
useful proposal evidence, but it is not a read-back of the written file. The frozen opt-in PPTX
adapter retains the same conservative semantic status but is outside the default product path.

## Adapter control plane

`AdapterRegistry` owns format aliases and priority. A `HostAdapter` supplies:

- the versioned capability manifest;
- its default/opt-in availability and active/frozen lifecycle;
- format-specific semantic validation;
- the strongest available proposal verifier;
- a shadow preview or an explicit unavailable reason;
- ordered write-back candidates.

The same `capabilities-v2` manifest controls model schema exposure, proposal/review gates,
write-back validation, `/health`, and conformance tests. The stock registry contains only manifests
with default availability. Compatibility registration methods decorate the selected adapter; they
do not create a second format table inside runtime.

## Host responsibilities

Runtime is a process-local kernel. It returns verified bytes but does not atomically replace the
user's file or persist a durable audit ledger. An embedding host must:

- write to a new file or use an atomic replace strategy;
- retain backups appropriate to the document's value;
- persist audit records if process restarts or multi-node replay protection matter;
- regenerate a proposal after any source change. OtterPatch rejects stale anchors rather than
  automatically rebasing them.

See [security.md](./security.md) for the threat model and [testing.md](./testing.md) for regression
coverage.
