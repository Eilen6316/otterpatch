# The Review Experience

Every agent proposal is reviewed **in-place, in the workspace** — not just in a side panel.

## One change-view toggle everywhere (DiffToggle)

All three workspaces share a single **DiffToggle** component (`apps/desktop/src/DiffToggle.tsx`):
label dots + a change-progress counter + a sliding segmented control + ‹ › per-change stepping;
the thumb is driven by `--dt-n` / `data-idx` and works for 2/3/4 segments — Excel's three states,
Word's four and drawio's two are the same bar.

## Word: inline tracked changes

Proposals land as three channels of inline marks (like Word's track changes / Google Docs
suggesting mode):

- **Insertions** — green, underlined (`ins.rd-ins`)
- **Deletions** — red strikethrough, visually receding (`del.rd-del`)
- **Format changes** — dotted underline + a small glyph chip (`B`/`I`/`U`/`A±`/`¶`…)
- **Whole-paragraph deletions** — `deletePara` lands as a block-deletion redline (`rd-chg-blkdel`):
  full red strikethrough in markup view, collapsed in clean/final, untouched in original; the
  paragraph is only physically removed on accept.

Around them:

- **4-state view toggle** (DiffToggle, floating over the page): 原文 / 修订 / 清样 / 改后 —
  original, full markup, clean-with-change-bars, final.
- **Per-change hover card** — type, old → new, ✓ accept / ✕ reject, right where you're reading.
  Keyboard: Tab to a change, Enter/Space opens the card.
- **Gutter change bars** on any block containing a change; rail ↔ inline hover linking both ways.
- **Document-level chips** — page-level changes (columns / margins / orientation) have no inline
  text anchor, so they appear as chips next to the toggle with their own ✓/✕. The original view
  restores the captured page state for a real before/after comparison. Unanchored document-wide
  character or paragraph formatting is not an Agent capability.

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

## Excel: three-state compare + before-state replay

Excel's DiffToggle has three states: **原文 / 对照 / 改后** (original / compare / final). 对照 =
the final result plus color-coding of changed cells (blue = pending, red = rejected); the coloring
fades as each item is dispositioned, view switches restore the real fill per decision, and it is
auto-cleared before commit — review colors never reach the file.

At proposal time the desktop captures each touched cell's **full before-state** — value *and
formula*, fill, font color, bold. Reject (or the 原文 view) replays exactly the dimensions the op
touched: rejecting a value edit doesn't clobber a style edit on the same cell, formulas come back
as formulas, user fills survive. The 原文/改后 quick toggle respects per-item decisions (a rejected
edit doesn't resurrect when you flip views).

## drawio: per-hunk review

drawio graduated from a collapsed code block to the same per-hunk list Excel/Word use: clicking a
row highlights the corresponding object on the board, with inline ✓/✕ per row; DiffToggle provides
an 原文/改后 switch. Reject/undo of update/delete/move ops on existing objects restores from the
before-snapshot (prior/next) exactly — it no longer risks deleting the user's own objects.

## ReviewBox: one interaction surface

The old dual representation ("git-diff list + current change card") is gone; everything converges
on one **ReviewBox**: an always-visible git-style unified diff (`@@ ref label` hunks with red − /
green + lines and `~` format lines) where every row has inline quick ✓/✕, dispositioned rows show
a ✓/✕ badge, and the fixed bottom action bar submits only explicitly accepted items. Hovering a
hunk lights up the corresponding inline change and vice versa.

**Approval is fail-closed.** A new proposal is visible as an optimistic workspace preview, but every
item starts unapproved. Accepted and rejected decisions are disjoint and persist across refreshes.
After reviewing the list, **Commit accepted** sends only the accepted subset; rejected items remain
reverted. **Accept all** always opens a confirmation that summarizes safe/caution/destructive counts
and calls out deletions, structural edits, and document-wide changes. Missing risk metadata is treated
as caution, and each hunk displays its effective risk level.

**Re-reviewing past turns**: on uncommitted older turns the inline ✓/✕ stays live (silent
disposition, doesn't move the review cursor); in Excel a row locks (🔒) if a later turn touched
the same cell, prompting you to undo the later turn first.

## Commit boundary

The workspace preview is not the file that reaches write-back. On import, the desktop computes a
SHA-256 and derived revision for the exact source bytes. The proposal is signed against that source.
When the user commits an explicitly accepted subset, the trusted client first calls `/review` with
the source bytes, proposal, ChangeSet, and accepted edit IDs. The local review authority returns a
signed, expiring receipt. `/commit` then starts from the original source bytes and requires the
matching proposal and receipt.

The receipt binds the accepted subset and is single-use. Changed source bytes, stale revisions,
changed ChangeSets, an undecided review list, an empty accepted set, or receipt replay all fail
closed. The output is downloadable only after backend read-back verification succeeds. Browser
development supplies separate local-service and review tokens; Electron keeps both tokens in the
main process behind narrow IPC. See [security.md](./security.md).

## Telemetry

Every per-item decision increments `localStorage['oa.telemetry']` counters keyed by
format × change-type (`text` / `style` / `value` / `structure` / `object`). Read it in the console
via `__otterTelemetry()`. Acceptance rate per category is the ground-truth "is the agent actually
expert?" metric — the lowest-scoring category is the next playbook/prompt target.
