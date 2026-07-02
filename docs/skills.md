# Skills

`packages/skills` is the knowledge hub: what the agent *knows how to do well*, kept out of the
core prompts so it can grow without bloating every request.

## Two kinds of built-in skills

| Kind | Example | Content | Injected as |
|---|---|---|---|
| **Capability cards** | `xlsx`, `docx`, `pptx`, `pdf`, `drawio` | one-line "what this format supports" | L0: name + description in the system prompt |
| **Playbooks** (打法手册) | `docx-gongwen`, `xlsx-financial`, `chart-selection` | checklists + changeset idioms + anti-patterns | L0 card, tagged 【有打法手册】; full text on demand via `load_skill` |

Built-in playbooks live as **real SKILL.md files** under `packages/skills/skills/<name>/SKILL.md`
(Anthropic Agent Skills directory convention — one folder per skill, YAML frontmatter for L0,
markdown body for L1). `playbooks.ts` is just a loader; edit the markdown, no code changes needed:

- **`docx-gongwen`** — GB/T 9704 official-document layout: title/body font-size system (二号小标宋
  title, 三号仿宋 body), the 一、/(一)/1./(1) heading-number hierarchy, full-width punctuation,
  and the changeset idioms to land them (`block` for real headings before any `all=true` sweep).
- **`xlsx-financial`** — reconciliation checks (totals = formulas, never hardcoded), money/percent
  number formats, anomaly detection, and the hard line: verify with `read_range`/`aggregate` before
  writing any numeric conclusion; never overwrite原始数据.
- **`chart-selection`** — a decision tree from question → chart type, plus professional floor rules
  (zero-baseline bars, ≤6 colors, meaningful sort order, conclusion-style titles).

## Progressive disclosure

1. `SkillLibrary.match(intent, format)` scores cards: format hit +3, each keyword hit +1, and a
   +0.5 tiebreak for playbooks **only when a keyword actually matched** (generic intents still rank
   the plain capability card first).
2. `render()` injects the top cards (L0) into the system prompt; playbook cards carry an explicit
   instruction: *load it with `load_skill` before acting if relevant*.
3. The `load_skill` tool (wired by `Agent.withSkillTools` through `RespondOptions.extraTools`)
   returns the playbook's full markdown as a tool result — knowledge arrives only when needed.

## External skills

Anything industry- or team-specific stays out of the built-ins. Hosts can install a standard
`SKILL.md` (Anthropic Agent Skills compatible — YAML frontmatter + markdown body) at runtime:

```ts
library.install(skillMdText, 'file:./skills/my-company-report.md');
```

The parsed card joins matching/rendering/`load_skill` immediately. L2 (executable scripts) is
deliberately not enabled — text playbooks deliver most of the value at zero sandbox risk.

## Writing a good playbook

- Lead with a **checklist the model runs before acting** — diagnosis beats prescriptions.
- Include **changeset idioms**: which ops, in which order (e.g. "set real headings via `block`
  first, then `all=true` for the body baseline — otherwise the sweep flattens your titles").
- Include **anti-patterns** ("don't fake headings with manual bold+size").
- Keep it under ~50 lines. It's loaded into a live context; density wins.
