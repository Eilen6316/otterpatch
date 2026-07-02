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
        │ shadow verification (per-format verifier registry)
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
| `packages/agent` | Intent → constrained `ChangeSet`. Provider-agnostic `ModelClient` (Claude native + OpenAI-compatible ×8). The multi-step loop, read tools, verifiers live here |
| `packages/skills` | Skill hub: SKILL.md parsing, matching, progressive disclosure, built-in capability cards + domain playbooks |
| `packages/runtime` | Headless orchestrator: `propose → diff → commit` + JSON event stream. Verifier registry + final self-check wrapper. Shared by MCP server, CLI, desktop |
| `packages/adapter-*` | Per-format compile/write-back: `univer` (Excel), `word` (redline `w:ins`/`w:del` + `rPrChange`/`pPrChange`), `drawio`, `pdf` (AcroForm), `pptx` |
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
- **The desktop applies proposals optimistically** as reviewable marks (tracked changes / grid
  values with captured before-state), so review happens in-place. Rejection replays the captured
  before-state; acceptance physically finalizes.
- **Server-side commit is independent**: the accepted subset of the ChangeSet is applied to the
  uploaded original file by the surgical write-back — the in-app preview never touches your file.
