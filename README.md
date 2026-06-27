# OPAL

**English** · [中文](./README.zh.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [한국어](./README.ko.md)

> **O**ffice **P**atch & **A**gent **L**ayer — an Agent-driven, reviewable **safe-commit layer** for documents.
> Circle a region → say what you want → review the diff → high-fidelity write-back.
> (Think: opening a PR against your `.xlsx` / `.docx` / `.drawio`.)

> ⚠️ Early scaffold — under active development.

## Why

Agents shouldn't edit your files directly. In OPAL an agent only **proposes** a structured
`ChangeSet`; the system validates it, applies it to a shadow copy, shows a **reviewable diff**
(accept/reject per block), then writes back **surgically** — only the touched parts change, the
rest stays byte-identical.

Validated on a real 531 KB `.docx`: surgical write-back kept **30/31 parts byte-identical**,
whereas a model round-trip rewrote 11/31. See `packages/writeback-surgical`.

## Structure

```text
packages/core/                format-agnostic abstraction layer
                              (Anchor / ChangeSet / Diff / Skill / Adapter / Registry / Transaction / Writeback)
packages/agent/               intent → constrained ChangeSet; BYOK, 8 providers
                              (Claude native + OpenAI-compatible: DeepSeek/GLM/Kimi/Doubao/MiniMax/Gemini/ChatGPT)
packages/adapter-univer/      Excel adapter (Univer) — ChangeSet → sheet XML compiler
packages/adapter-drawio/      drawio adapter — mxCell op engine + diagram-level surgical write-back
packages/writeback-surgical/  surgical OOXML write-back — validated + tested
apps/desktop/                 progressive-disclosure cockpit UI + BYOK model config (Vite + React; Electron later)
```

## Develop

```bash
npm install
npm run typecheck                  # tsc -b across packages/*
npm run dev                        # cockpit UI → http://localhost:5173
npm test -w @opal/core             # adapter registry
npm test -w @opal/agent            # intent → ChangeSet (mock model + 8-provider factory)
npm test -w @opal/adapter-univer   # intent → ChangeSet → surgical .xlsx write-back
npm test -w @opal/adapter-drawio   # mxCell ops + cross-diagram surgical write-back
npm test -w @opal/writeback-surgical
```

## Status

- [x] Monorepo scaffold; core abstraction layer + adapter registry
- [x] Surgical OOXML write-back (validated + tested)
- [x] Agent turn: natural-language intent → constrained `ChangeSet` (BYOK, 8 providers)
- [x] drawio adapter: mxCell add/delete/setProps/move + diagram-level surgical write-back
- [ ] Univer adapter live loop: circle → ChangeSet → shadow → diff → write-back
- [ ] Wire cockpit UI to the real agent + write-back backend

## License

[Apache-2.0](./LICENSE).
