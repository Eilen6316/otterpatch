<p align="center">
  <img src="./assets/logo.png" alt="OtterPatch" width="440" />
</p>

<p align="center"><b>English</b> · <a href="./README.zh.md">中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.fr.md">Français</a> · <a href="./README.ko.md">한국어</a></p>

> 🦦 **O**ffice **T**ransforms · **T**racked · **E**dited & **R**eviewed · surgical **Patch** write-back — an Agent-driven, reviewable **safe-commit layer** for documents.
> Circle a region → say what you want → review the diff → high-fidelity write-back.
> (Think: opening a PR against your `.xlsx` / `.docx` / `.drawio`.)

> ⚠️ Early scaffold — under active development.

## Why

Agents shouldn't edit your files directly. In OtterPatch an agent only **proposes** a structured
`ChangeSet`; the system validates it, applies it to a shadow copy, shows a **reviewable diff**
(accept/reject per block), then writes back **surgically** — only the touched parts change, the
rest stays byte-identical.

Validated on a real 531 KB `.docx`: surgical write-back kept **30/31 parts byte-identical**,
whereas a model round-trip rewrote 11/31. See `packages/writeback-surgical`.

## Docs

Contributor/integrator documentation lives in [`docs/`](./docs/README.md):
[architecture](./docs/architecture.md) · [agent loop](./docs/agent.md) ·
[skills & playbooks](./docs/skills.md) · [review UX](./docs/review-ux.md) ·
[testing](./docs/testing.md)

## Structure

```text
packages/core/                format-agnostic abstraction layer
                              (Anchor / ChangeSet / Diff / Skill / Adapter / Registry / Transaction / Writeback)
packages/agent/               intent → constrained ChangeSet; BYOK, 8 providers
                              (Claude native + OpenAI-compatible: DeepSeek/GLM/Kimi/Doubao/MiniMax/Gemini/ChatGPT)
packages/adapter-univer/      Excel adapter (Univer) — ChangeSet → sheet XML compiler
packages/adapter-drawio/      drawio adapter — mxCell op engine + diagram-level surgical write-back
packages/adapter-word/        Word adapter — word-level redline (w:ins/w:del) surgical write-back
packages/adapter-pdf/         PDF adapter — AcroForm form-fill write-back (pdf-lib)
packages/adapter-pptx/        PowerPoint adapter — slide-text surgical write-back (<a:t>)
packages/writeback-surgical/  surgical OOXML write-back — validated + tested
packages/runtime/             headless orchestrator: propose → diff → commit + JSON event stream
apps/desktop/                 progressive-disclosure cockpit UI + BYOK model config (Vite + React; Electron later)
apps/mcp-server/              OtterPatch as an MCP server (stdio) + headless CLI (otterpatch-run)
```

## Integrate via MCP

OtterPatch ships as an MCP server so any agent / IDE can drive the propose → review → write-back loop:

```text
otterpatch_skills   list built-in document skills
otterpatch_propose  intent (+ selection context) → constrained ChangeSet + reviewable diff   (BYOK)
otterpatch_diff     ChangeSet → reviewable diff
otterpatch_commit   ChangeSet + file(base64) → surgical write-back → new file + fidelity report
```

```jsonc
// register the server (BYOK key via env or per-call apiKey arg)
{ "mcpServers": { "otterpatch": { "command": "otterpatch-mcp", "env": { "OtterPatch_API_KEY": "sk-..." } } } }
```

Or run it headless and stream JSON events (one per line):

```bash
otterpatch-run --format excel --intent "fill amount = qty × price" --in book.xlsx --out book.out.xlsx
# {"type":"propose:start",...} {"type":"diff:done",...} {"type":"commit:done","ok":true,"touchedParts":["xl/worksheets/sheet1.xml"],...}
```

The cockpit UI talks to the runtime through a local HTTP bridge (`otterpatch-serve`) — start it, then point the model panel's *otterpatch-serve URL* at it (BYOK):

```bash
otterpatch-serve   # GET /health · POST /propose {format,intent,context,provider,apiKey} · POST /commit {format,fileBase64,changeSet}
```

## Develop

```bash
npm install
npm run typecheck                  # tsc -b across packages/*
npm run dev                        # cockpit UI → http://localhost:5173
npm run app -w @otterpatch/desktop       # build + launch the Electron desktop window
npm run app:pack -w @otterpatch/desktop  # package installers (electron-builder → release/)
npm test -w @otterpatch/core             # adapter registry
npm test -w @otterpatch/agent            # intent → ChangeSet (mock model + 8-provider factory)
npm test -w @otterpatch/adapter-univer   # intent → ChangeSet → surgical .xlsx write-back
npm test -w @otterpatch/adapter-drawio   # mxCell ops + cross-diagram surgical write-back
npm test -w @otterpatch/writeback-surgical
```

## Status

- [x] Monorepo scaffold; core abstraction layer + adapter registry
- [x] Surgical OOXML write-back (validated + tested)
- [x] Agent turn: natural-language intent → constrained `ChangeSet` (BYOK, 8 providers)
- [x] drawio adapter: mxCell add/delete/setProps/move + diagram-level surgical write-back
- [x] Headless runtime: intent → ChangeSet → reviewable diff → surgical write-back, end-to-end (excel/drawio)
- [x] MCP server + headless CLI with a JSON event stream (BYOK)
- [x] Word redline + PDF form-fill + PowerPoint slide-text adapters — propose→commit for excel/word/pdf/ppt/drawio
- [x] Ribbon formatting applies to the live selection (bold/italic/colors/align/number-format)
- [x] Electron desktop shell + electron-builder packaging config (12-language UI)
- [x] Closed write-back loop in the cockpit (otterpatch-serve): load a file → propose → review diff (per-item accept/reject) → accept subset → surgical write-back → download the edited file
- [x] Word: full Office-style six-tab ribbon + **inline tracked-change review** — per-change hover cards, 4-state view toggle (original/markup/clean/final), flatten-on-accept (accepting physically finalizes; no markup pollution)
- [x] Agent read tools — Excel `read_range`/`aggregate`; Word `read_blocks`/`find_text`/`get_outline`/`get_style_usage` (full-doc snapshot, both model channels)
- [x] Domain playbooks with progressive disclosure (`load_skill`): GB/T 9704 official-document layout, financial-sheet rules, chart selection
- [x] Shadow-verification registry (Excel recompute · Word anchor landability · drawio topology) with in-turn repair + final semantic self-check; prompt caching on the Anthropic channel
- [x] Page-level layout ops (columns/margins/orientation — two-column IEEE layouts) + doc-level change chips with true before/after toggling
- [x] Batch continuation ("next batch" button + opt-in auto-continue, serial & re-anchored); per-edit acceptance telemetry; key-gated capability bench (`test/expert-bench.mjs`)

## License

[Apache-2.0](./LICENSE).
