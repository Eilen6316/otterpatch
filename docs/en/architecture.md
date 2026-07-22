# Architecture

OtterPatch is a **safe-commit layer** between an LLM agent and your Office documents. Think of it
as opening a pull request against an `.xlsx` / `.docx` / `.drawio` file.

## Pipeline

```
 user intent + selection
        │
        ▼
┌─────────────────┐   dialect (per-format tool schema)
│  Agent (LLM)    │◄─ skills (capability cards + playbooks)
│  multi-step loop│◄─ read tools (sheet: read_range/aggregate · doc: read_blocks/find_text/…)
└───────┬─────────┘
        │ propose_changeset (the ONLY mutation exit)
        ▼
┌─────────────────┐
│ ChangeSet       │  format-agnostic: anchors (quote / A1 / cell-id) + edit ops
└───────┬─────────┘
        │ declared check: lint / simulation / output verification
        │   fail → structured report fed back → model repairs (propose→observe→repair, ≤2 rounds)
        │   pass + large changeset → one final semantic self-check round
        ▼
┌─────────────────┐
│ Reviewable diff │  workspace: inline tracked changes / grid replay / board highlight
│                 │  rail: git-style unified diff, per-item accept/reject
└───────┬─────────┘
        │ accepted subset
        ▼
┌─────────────────┐
│ Surgical commit │  OOXML / XML patch — untouched parts byte-identical
│                 │  + fidelity report (touched parts, score)
└─────────────────┘
```

## Package map

| Package | Role |
|---|---|
| `packages/core` | Format-agnostic types: `Anchor`, `ChangeSet`, `EditOp`, `AbstractStyle`, adapter registry, writeback contracts |
| `packages/agent` | Intent → constrained `ChangeSet`. Provider-agnostic `ModelClient` (Claude native + OpenAI-compatible ×8), multi-step loop, and read tools |
| `packages/skills` | Skill hub: SKILL.md parsing, matching, progressive disclosure, built-in capability cards + domain playbooks |
| `packages/runtime` | Format-agnostic headless orchestrator. It resolves one `HostAdapter` through `AdapterRegistry` for proposal verification, preview, and writeback, then emits the JSON event stream used by MCP, CLI, and desktop |
| `packages/adapter-*` | Per-format control planes: capability manifest, deterministic validator, optional shadow preview, touched-part description, and ordered writeback candidates. `univer` and `drawio` provide headless shadows; Word/PDF/PPTX disclose unavailable rendering explicitly |
| `packages/writeback-surgical` | The OOXML surgical write-back engine (validated: 30/31 parts byte-identical on a real 531 KB docx) |
| `apps/desktop` | The cockpit UI (Vite + React + Electron): workspaces (Univer sheet, rich-text Word, drawio board), review rail, BYOK model panel |
| `apps/mcp-server` | MCP server (stdio) + headless CLI + `otterpatch-serve` local HTTP bridge for the cockpit |

## Data flow details

- **Context is a projection, not the file.** Each workspace assembles a read-only context for the
  model: Excel sends a sheet overview + full-grid snapshot (for read tools, not the prompt); Word
  sends a per-paragraph style summary + style-system digest, plus a full-document block snapshot
  (`ProposeRequest.doc`) for the read tools. Pending tracked changes are excluded via the *clean
  projection* (the model always sees the "as-accepted" text — no context poisoning).
- **Anchors are logical, not positional.** Word edits anchor on `quote` (verified real & unique),
  Excel on A1 refs, drawio on cell ids. The doc verifier / grid verifier / topology verifier reject
  anchors that can't land, and the model repairs them in-turn.
- **The desktop previews proposals optimistically, but approves nothing implicitly.** Reviewable
  marks (tracked changes / grid values with captured before-state) make in-place review possible,
  while each item starts in an unapproved state. Rejection replays the captured before-state;
  acceptance physically finalizes, and commit receives only the explicitly accepted subset.
- **Server-side commit is independent**: the accepted subset of the ChangeSet is applied to the
  uploaded original file by the surgical write-back — the in-app preview never touches your file.
- **Desktop credentials stay in the main process.** The preload exposes bounded proposal,
  cancellation, and reviewed-commit IPC methods only. It never exposes local-service tokens or a
  generic fetch primitive; every IPC payload is schema- and size-checked before the main process
  adds authentication headers.
- **Format routing has one owner.** Runtime does not maintain backend or verifier maps. Built-in and
  host-provided adapters are selected by `AdapterRegistry`; aliases such as `xlsx`, `docx`, and
  `pptx` resolve to the same manifest and adapter implementation.
