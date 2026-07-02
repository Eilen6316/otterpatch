# The Review Experience

Every agent proposal is reviewed **in-place, in the workspace** — not just in a side panel.

## Word: inline tracked changes

Proposals land as three channels of inline marks (like Word's track changes / Google Docs
suggesting mode):

- **Insertions** — green, underlined (`ins.rd-ins`)
- **Deletions** — red strikethrough, visually receding (`del.rd-del`)
- **Format changes** — dotted underline + a small glyph chip (`B`/`I`/`U`/`A±`/`¶`…)

Around them:

- **4-state view toggle** (floating over the page): 原文 / 修订 / 清样 / 改后 — original, full
  markup, clean-with-change-bars, final. Sliding-thumb segmented control with a change counter and
  ‹ › step navigation.
- **Per-change hover card** — type, old → new, ✓ accept / ✕ reject, right where you're reading.
  Keyboard: Tab to a change, Enter/Space opens the card.
- **Gutter change bars** on any block containing a change; rail ↔ inline hover linking both ways.
- **Doc-level chips** — `all=true` (whole-document format) and page-level changes (columns /
  margins / orientation) have no inline anchor, so they appear as chips next to the toggle with
  their own ✓/✕; the 原文 view truly reverts them (fonts, column count, page state) for a real
  before/after comparison.

### Flatten-on-accept (the architectural core)

**Accepting is physical, not cosmetic.** On accept, the deletion is removed from the DOM, the
insertion is unwrapped into plain (styled) content, and all revision attributes are stripped. The
wrapper degrades to an invisible `data-undo` span that keeps *this round's* undo working; it is
swept when the next proposal arrives.

Why it matters — everything downstream stays clean **by construction**:

- The agent context (`getText`/`getContext`) reads a *clean projection* (deletions excluded), so
  the next turn's quotes can't straddle old/new text — no compounding corruption loop.
- Word count, find & replace, print, copy all see only the real document.
- Reload mid-review is safe: acceptance bookkeeping (`changeSetId::editId`) persists; `applyEdit`
  is idempotent; reject falls back to a DOM-level restore when the in-memory undo map is gone.

### Batching UX

If the plan declares batches ("先做第一批…"), the accepted turn shows **继续下一批 ›** plus an
**⚡自动续批** opt-in toggle (persisted). Auto-continue sends "下一批" after each acceptance —
serially, each batch re-anchored and re-reviewed — capped at 5 consecutive batches.

## Excel: before-state replay

At proposal time the desktop captures each touched cell's **full before-state** — value *and
formula*, fill, font color, bold. Reject (or the 原文 view) replays exactly the dimensions the op
touched: rejecting a value edit doesn't clobber a style edit on the same cell, formulas come back
as formulas, user fills survive. The 原文/改后 quick toggle respects per-item decisions (a rejected
edit doesn't resurrect when you flip views).

## The rail (both formats)

An always-visible **git-style unified diff**: `@@ ref label` hunks with red − / green + lines and
`~` format lines, per-item accept/reject, progress bar, "已采纳 · N 处" with undo. Hovering a hunk
lights up the corresponding inline change and vice versa.

## Telemetry

Every per-item decision increments `localStorage['oa.telemetry']` counters keyed by
format × change-type (`text` / `style` / `value` / `structure` / `object`). Read it in the console
via `__otterTelemetry()`. Acceptance rate per category is the ground-truth "is the agent actually
expert?" metric — the lowest-scoring category is the next playbook/prompt target.
