# Official internal-comms integration audit

Engineering integration passed. **Real-model quality improvement has not been measured.**

## Source and approval

Official repository: https://github.com/anthropics/skills

Pinned commit: `dbd4588f9e1033efb41dad4bef2f7947c8993d44`, inspected on 2026-10-26.
Only `skills/internal-comms/SKILL.md`, `LICENSE.txt` and the four `examples/*.md` files were selected.
Their unchanged copies, byte hashes and local additions are documented in
[upstream-lock.json](../../third-party/anthropic-internal-comms/upstream-lock.json) and
[NOTICE.md](../../third-party/anthropic-internal-comms/NOTICE.md).

The declaration is `Complete terms in LICENSE.txt`. That file contains full Apache-2.0 terms and
`Copyright 2026 Anthropic, PBC.`. Its whitespace-normalized normative text through END OF TERMS AND
CONDITIONS hashes to `59d8f0ba87ad9a2f1a431123c8d16646e5b89ba53653e818f16d136d77263c99`, independently
matched against SPDX's Apache-2.0 license-list-data text. No upstream root/skill NOTICE was found. The root THIRD_PARTY_NOTICES.md was separately reviewed
and hash-recorded: its software/font components are not bundled in these six texts; no additional
internal-comms-specific attribution was located.
No proprietary DOCX/XLSX/PPTX/PDF skill was imported.

The user explicitly authorized this source-specific audit/import demonstration. Its recorded identity
is `Codex automated review under explicit user task authorization; not a human identity`; this is
not a fabricated human reviewer, independent legal opinion or Anthropic endorsement. The checked-in
approval template leaves `approvedBy` empty. Future operators must perform review and provide a
genuine approval record. Upstream has no semver; `1.0.0` is the local import label, not an upstream tag.

Chinese signals and existing-Word scope are separate, approved, source-hash-bound adaptation data
included in the release hash. Original Markdown/instructions are unchanged. Both adaptation and
upstream instructions stay untrusted tool data, never trusted System Prompt content.

## Reproduce the explicit administrator flow

```bash
git clone --no-checkout https://github.com/anthropics/skills.git /audit/anthropics-skills
git -C /audit/anthropics-skills checkout --detach dbd4588f9e1033efb41dad4bef2f7947c8993d44
npm run typecheck
# Review all six files, the license, lock and local adaptation first:
node scripts/prepare-internal-comms-import.mjs --checkout /audit/anthropics-skills \
  --registry /private/internal-comms-registry --approved-by '<genuine-review-id>' > /private/approval.json
npm run skills --workspace @otterpatch/mcp-server -- import --config /private/approval.json --source anthropic-internal-comms --path skills/internal-comms/SKILL.md
npm run skills --workspace @otterpatch/mcp-server -- inspect --config /private/approval.json --release <returned-release>
npm run skills --workspace @otterpatch/mcp-server -- enable --config /private/approval.json --id anthropic/internal-comms --release <returned-release>
```

Set `OtterPatch_SKILL_REGISTRY=/private/internal-comms-registry` and restart hosts. CLI discovery:
`npm run run --workspace @otterpatch/mcp-server -- --list-skills`.
HTTP/MCP/CLI use the same library initializer. Electron inherits the service environment; packaged
Electron was not launched here. The importer itself never fetches or enables anything automatically.

`node scripts/demo-internal-comms.mjs --config /private/approval.json --out /private/lifecycle.json`
explicitly runs CLI import/inspect/enable, fresh-process discovery, disable/absence and rollback to the
persisted release, plus engineering-only Agent body/reference loading and provenance checks.
[Actual lifecycle results](../reports/internal-comms-lifecycle.json) passed with release
`0291416e875cb704f80ce5d541b09303a4715c48cb2afbe9390c8e203b3e99b2`. Different approval identities
produce different hashes; do not reuse that hash as a generic approval.

Use administrator `disable` or `rollback` with the same ID and selected release, then restart all hosts.
Do not delete activation pointers: their filenames reserve IDs against loose-file impersonation even
when the release/pointer is corrupt or disabled. Entire-registry deletion or hostile administrator
modification is outside that guarantee. Skill toggles do not revoke existing signed reviews.

## License and reference boundaries

Direct supported SPDX declarations must match approval; unknown/proprietary/conflicting declarations
are refused. Existing direct approvals still rely on human review and exact license hashes; limited
text checks are not legal classification. File-reference declarations require exact known syntax,
the same locked repository-relative license path, original declaration and audit source. Currently
only file-referenced canonical Apache-2.0 normative terms are supported, not arbitrary prose inferred
from a filename. Validation repeats when loading releases.

`examples/` and `references/` share the same per-file approval, Git-object read, 32 KiB/file, 8-file and
256 KiB/bundle restrictions. Traversal, symlinks, submodules, executable/binary/unapproved content
remain blocked. There is no script, Shell, OOXML or third-party tool-permission executor.

## Engineering versus real quality evaluation

Review follow-up against `b2ca574`: registry IDs are reserved from pointer filenames before
parsing. Disabled entries, corrupt releases, truncated pointers and mismatched pointer identities
cannot fall back to same-ID loose files; errors remain observable. Original license declarations
and approved SPDX identifiers are separate. Individually approved `examples/` and `references/`
share path, size and hash checks. Local search metadata is locked with the upstream checksum;
natural-language regressions include “帮我检查这份项目周报”.

Matching tests establish retrieval when `find_skills` is called, not autonomous model discovery
or correct use. Discovery remains model-selected, without a mandatory retrieval stage. External
descriptions, bodies and adaptations stay outside the trusted System Prompt. Real discovery,
loading and quality benefits still require the A/B measurements below.

`npm run test:internal-comms` reconstructs an offline fixture from the six byte-verified official
files; it does not forge an upstream Git repository. The real Git/administrator CLI import was run
separately. Twelve deterministic model scenarios exercise the actual official body and all four
references, valid anchored changes, selective review, invalid/replayed receipts, seven real DOCX
byte writebacks, three clarifications and two refusals. Other tests cover narrow Chinese discovery,
unchanged negative builtin matching and explicit no-key skipping (14 tests total).
`INTERNAL_COMMS_ARTIFACT_DIR=/private/examples npm run test:internal-comms` saves synthetic before/
after DOCX and verification reports. Review is a simulated trusted host, not actual human assessment.

Real A/B is a separate command:

```bash
# Supply BYOK credentials securely through environment settings, never command arguments/logs.
npm run eval:internal-comms -- --real --out /private/real-ab.json
```

It reuses the BYOK provider, runs the same 12 inputs per group with the same model/maxTokens/provider
defaults, alternates A/B ordering, observes real retrieval/body/reference calls and proposal failures,
and records rule-based completion, document fact/number/protected-region checks, verification,
0..4 reproducible safety rubric and per-task outputs. Provider-reported non-streaming token counts
are captured; unexposed billing is null. It does not supply fixed seed/repeated samples, an independent
human writing-quality score, or a complete semantic quality evaluator. Synthetic rule-based review
is explicitly labeled. B being no better must not be hidden.

| Actual real evaluation | A: disabled | B: enabled |
|---|---|---|
| Planned tasks | 12 | 12 |
| Executed model calls | 0 | 0 |
| Quality, completion, fidelity, load rates | SKIPPED | SKIPPED |
| Token / cost measurements | unavailable | unavailable |

**SKIPPED — no real model evaluation**: no BYOK key was present in environment/configuration.
See [real report](../reports/internal-comms-real-ab.json). A zero exit status or Mock success is not a
real evaluation PASS. The [engineering report](../reports/internal-comms-engineering.json) is separate.

The supported use is existing-Word review, local polishing and terminology consistency, through
existing capabilities and signed human-review boundaries. Full document creation, arbitrary paragraph
insertion, company knowledge gathering, Slack/email/calendar and external programs are not supplied
by importing this skill. Missing facts require clarification. PDF/default PPTX remain unavailable.
Next steps are an actual BYOK A/B run and human review of outputs; other text skills still require
their own license/content/capability audit, and proprietary or script-heavy skills are not preapproved.
