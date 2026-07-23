<p align="center">
  <img src="./assets/logo.png" alt="OtterPatch" width="440" />
</p>

<p align="center"><b>English</b> · <a href="./README.zh.md">中文</a></p>

> **O**ffice **T**ransforms · **T**racked · **E**dited & **R**eviewed · surgical **Patch** write-back.
> Circle a region, describe the change, review each edit, then write back to the original format.

> **Development preview (`0.0.1`).** The safety boundaries described below are enforced in code,
> but format support is intentionally narrow and the API may still change. Keep a backup of any
> important document and check the capability table before relying on a workflow.

**Product scope:** Excel and Word are the active product mainline. drawio remains a secondary
compatibility integration and is not a feature-expansion target. PDF support has been removed.
The retained PPTX adapter is frozen and explicit opt-in only; stock runtime, desktop, MCP, HTTP,
and CLI surfaces do not expose it.

## What OtterPatch does

An agent never receives a general-purpose file mutation tool. It may answer, ask for clarification,
or propose one structured `ChangeSet`. OtterPatch then:

1. keeps document content in an explicitly untrusted user-data envelope;
2. validates the ChangeSet schema, semantics, resource budgets, and format capability manifest;
3. runs the strongest available deterministic proposal check and builds a reviewable diff;
4. signs a proposal bound to the ChangeSet, format, policy, source SHA-256, and revision;
5. commits only the edit IDs in a signed, expiring, single-use review receipt;
6. serializes writes per document, applies the selected backend, reopens the output, and requires a
   structured verification report before returning bytes to the host.

For the active OOXML writers and uncompressed drawio, surgical write-back changes only intended
package parts or diagrams. On a 531 KB `.docx` fixture, 30 of 31 package parts remained
byte-identical.

## Supported scope

The `capabilities-v2` manifest in [`packages/core/src/capabilities.ts`](./packages/core/src/capabilities.ts)
is the source of truth for availability, lifecycle, proposal, preview, verification, and
write-back gates.

| Format | Availability | Current write-back operations | Proposal preview/check | Important boundary |
|---|---|---|---|---|
| Excel (`xlsx`) | mainline, default | value, formula, style, number format, clear range | headless grid shadow and deterministic simulation | supported formula subset only; unknown functions, cycles, missing observations, and oversized ranges fail closed; output edit-level read-back is `unverifiable` |
| Word (`docx`) | mainline, default | anchored text replacement/deletion, scoped character and paragraph style, page columns/margins/orientation, image remove/resize, table insertion | unique quote/paragraph anchor checks; rich preview is rendered by the desktop host | writes native revisions in `word/document.xml`; generic edit-level output read-back is reported as `unverifiable` |
| drawio | secondary compatibility, default | label/property updates, move, add, delete | headless board replay and topology verification | only uncompressed diagrams; identity/topology fields are constrained; no planned feature expansion |
| PowerPoint (`pptx`) | frozen, opt-in | unique single-run text replacement | exact slide/paragraph/run boundary check | retained for explicit host registration only; absent from every stock product surface |

PDF is unsupported and no longer exists as an adapter, dependency, Agent dialect, skill, schema, or
write-back test. It is not an experimental product option.

Unsupported operations are hidden from the model and rejected again at runtime. A host cannot make
them available by constructing a plausible-looking ChangeSet.

## Run locally

Prerequisite: Node.js 22 and npm.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

### Browser development

Use two terminals:

```bash
# Terminal A: build TypeScript, start the loopback HTTP service, print one-time local tokens
npm run serve

# Terminal B: start the Vite cockpit at http://localhost:5173
npm run dev
```

In the cockpit model settings, enter a provider API key and the **Local service token** and
**Review token** printed by `npm run serve`. Browser-development tokens are stored only for the
local Vite origin and must be updated when a service restart generates new values. Every local
`POST` requires `X-OtterPatch-Token`; `/review` additionally requires
`X-OtterPatch-Review-Token`. `GET /health` is the only anonymous endpoint.

To pin development credentials or origins instead of generating defaults:

```text
OtterPatch_TOKEN
OtterPatch_REVIEW_TOKEN
OtterPatch_ALLOWED_ORIGINS
OtterPatch_PORT
```

`OtterPatch_ALLOWED_ORIGINS` accepts only exact loopback HTTP(S) origins or `null`, separated by
commas. The service always binds to `127.0.0.1`.

### Electron desktop

```bash
npm run build
npm run app --workspace @otterpatch/desktop

# Build an unpacked installer directory
npm run app:pack:dir --workspace @otterpatch/desktop
```

Electron starts the local service itself. Service and review tokens stay in the main process;
the sandboxed renderer receives only bounded propose, cancel, and reviewed-commit IPC methods.

## Integrate

`apps/mcp-server` exposes the same runtime through MCP stdio, a headless CLI, and the local HTTP
bridge. These stock surfaces accept only Excel, Word, and drawio formats (including `xlsx`/`docx`
aliases).

```text
otterpatch_skills   list immutable built-in skill metadata
otterpatch_propose  intent + trusted request identity + read-only snapshot -> ChangeSet, diff, signed proposal
otterpatch_diff     ChangeSet + host snapshot -> shadow-derived diff or an explicit unavailable reason
otterpatch_commit   source file + ChangeSet + signed proposal + review receipt -> verified output
```

The stock MCP stdio surface does not mint a human review receipt. A host that embeds
`@otterpatch/runtime` can use its own trusted review UI and the same `ReviewAuthority`; a plain
stdio client can propose and diff, but cannot use the default reviewed commit by itself. The
HTTP/Electron path is the complete built-in reviewed flow. Unreviewed MCP commit is off by default
and can only be enabled explicitly with `OTTERPATCH_ALLOW_UNREVIEWED_COMMIT=1`; even then,
`acceptedEditIds` and a live `currentRev` are required.

Build and register the stdio entry point with an MCP client:

```json
{
  "mcpServers": {
    "otterpatch": {
      "command": "node",
      "args": ["/absolute/path/to/otterpatch/apps/mcp-server/dist/mcp.js"],
      "env": { "OtterPatch_API_KEY": "your-provider-key" }
    }
  }
}
```

Run an explicitly confirmed headless pass:

```bash
npm run run --workspace @otterpatch/mcp-server -- \
  --yes --format excel --intent "fill amount = quantity * price" \
  --in book.xlsx --out book.out.xlsx
```

Without `--yes`, the CLI emits the proposal and diff but refuses to write a file.

## Verification output

`FidelityReport.score` remains only as a compatibility alias for locality. Consumers should use
the structured dimensions:

```text
verification.packageValid
verification.locality       intended parts, unexpected parts, unchanged outside-part ratio
verification.semantic       verified, unverifiable, and failed edit IDs
verification.compatibility  explicit format/backend warnings
```

Runtime rejects legacy or edit-incomplete reports, invalid packages, and unexpected drift. It
returns the final read-back report, not the backend's optimistic commit-time estimate.

## Repository map

```text
packages/core/                ChangeSet, validation, capability, risk, limits, adapter contracts
packages/agent/               bounded multi-provider agent loop, read tools, provenance
packages/skills/              immutable built-ins, generated playbooks, external-skill isolation
packages/adapter-univer/      Excel shadow, verifier, and worksheet compiler
packages/adapter-word/        Word anchors, native redlines, style/page/table/image write-back
packages/adapter-drawio/      mxCell model, topology verifier, diagram write-back
packages/adapter-pptx/        frozen opt-in single-run slide-text writer (not stock-registered)
packages/writeback-surgical/  budgeted OOXML read/repack and locality verification
packages/runtime/             adapter-owned propose/diff/review/commit orchestration
apps/mcp-server/              MCP, CLI, and authenticated loopback HTTP service
apps/desktop/                 Vite/React cockpit and sandboxed Electron shell
```

## Documentation

Start at [`docs/`](./docs/README.md):
[architecture](./docs/en/architecture.md) · [security](./docs/en/security.md) ·
[agent loop](./docs/en/agent.md) · [skills](./docs/en/skills.md) ·
[review UX](./docs/en/review-ux.md) · [testing](./docs/en/testing.md) ·
[Word OOXML notes](./docs/en/ooxml-redline-notes.md)

## License

[Apache-2.0](./LICENSE).
