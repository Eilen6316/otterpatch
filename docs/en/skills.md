# Skills and Playbooks

`packages/skills` supplies domain guidance without granting mutation authority. The format capability
manifest remains the hard boundary; a skill can narrow or improve a workflow, but cannot add an
operation.

## Built-in catalog

The default library contains two forms of immutable built-in content:

| Kind | Purpose | System-prompt exposure |
|---|---|---|
| capability card | concise, format-level description for default `xlsx`, `docx`, and `drawio` support | trusted checksummed metadata only: ID, version, checksum, locale, description, compatible operations |
| playbook | task-specific checklist and operation idioms | only its trusted L0 metadata; full instructions load on demand as untrusted tool data |

The six default playbooks are:

| Playbook | Scope |
|---|---|
| `docx-gongwen` | GB/T 9704 official-document conventions within anchored Word formatting support |
| `docx-conventions` | general Word typography, hierarchy, spacing, and consistency checks |
| `docx-coauthoring` | serial outline/draft/review workflow for collaborative writing |
| `xlsx-financial` | reconciliation, formulas, money/percent formats, and read-before-write checks |
| `xlsx-authoring` | spreadsheet modeling and presentation rules within current cell operations |
| `chart-selection` | advisory chart-choice rules; `allowed_ops` is empty because chart write-back is unsupported |

The generator still preserves the seventh source, `pptx-design`, plus a PPTX capability card. They
are exported only through `PPTX_OPT_IN_SKILLS` for explicit frozen-adapter hosts and are absent from
`defaultLibrary()`, MCP skill listing, and stock Agent prompts. PDF has no retained skill metadata.

Each source lives at `packages/skills/skills/<name>/SKILL.md`. A build-time generator produces
`packages/skills/src/playbooks.generated.ts`; importing the package performs no filesystem I/O.

```bash
npm run generate:playbooks --workspace @otterpatch/skills
```

The skills package runs this generator automatically before build and test. Edit the `SKILL.md`
source, not the generated TypeScript.

## Matching and progressive disclosure

Cards carry a namespace, version, locale, formats, triggers/keywords, `allowed_ops`, checksum,
trust level, and optional instruction body. Matching uses:

1. exact namespaced references;
2. bounded trigger and keyword signals;
3. format and locale compatibility;
4. the intersection of `allowed_ops` and the active format's write-back operations;
5. deterministic tie-breaking by signal specificity, trust, version, and ID.

Only immutable built-ins selected by `promptBundle()` can enter the system prompt. If additional
guidance may help, the model can call:

- `find_skills(query)`: returns a bounded catalog as `untrusted_data`;
- `load_skill(namespace/name)`: resolves a capability-compatible body and returns it as
  `untrusted_data`.

Loaded skill ID/version/checksum is recorded in Agent provenance. The instruction remains reference
data: it cannot override policy, tool permissions, review requirements, or capability gates.

## External skills

A host may install an external text playbook at runtime:

```ts
library.install(skillMdText, 'file:./skills/my-company-report/SKILL.md');
```

External skills are intentionally lower trust:

- they default to the `user` namespace and cannot claim the reserved `otterpatch` namespace;
- they cannot claim built-in trust or immutability, or replace an immutable built-in;
- their description never enters the system prompt;
- their catalog metadata and body are returned only through untrusted tool results;
- `allowed_ops` is intersected with the active capability manifest before discovery or loading;
- default conflict policy rejects a same-ID/different-checksum install. A host that opts into
  replacement must supply a strictly newer version;
- frontmatter, text size, arrays, IDs, versions, locale, and checksum shape are validated and
  bounded before installation;
- executable L2 scripts are not enabled.

An advisory skill can use `allowed_ops: []`. This is the right representation for chart selection
or other expert advice when no corresponding write-back operation exists.

## Controlled Agent Skills import

The YAML compatibility layer supports quoted strings, block descriptions, sequences and nested
metadata. Duplicate keys, aliases, unknown tags, prototype keys and excessive size/depth are rejected.
Legacy numeric keywords such as `9704` retain string matching behavior. Markdown and metadata remain
untrusted data. `allowed_ops` is a compatibility restriction, never a permission grant.

`importAllowedSkill` is an administrator-only **offline** operation, separate from model tools.
It never clones/fetches, runs `npx skills add`, installs packages or executes repository code.
Its manually reviewed `SkillImportConfig` requires a private registry, allowlisted source ID/local
checkout, GitHub `owner/repository`, full 40-character commit SHA, selected `SKILL.md` path/hash,
namespace/version/formats/operations, `mode: "text-only"`, `approvedBy`, license identifier/file/hash,
and individually approved reference paths/hashes. Hashes use `sha256:<64 lowercase hex characters>`.
The license text and original Markdown are retained in the immutable release snapshot.

The importer checks origin identity (GitHub HTTPS or SCP-style SSH) and reads pinned Git objects with
lazy fetching disabled. Git must support `--no-lazy-fetch` (validated with 2.52). Uncommitted changes
are ignored. Origin configuration does not prove authorship or licensing; verify authorization
independently. Gitlinks, executable blobs, symlinks, path traversal, Windows/absolute/control-character
paths, binary NULs and invalid UTF-8 are refused. Limits: SKILL/license 128 KiB each; at most eight
`references/` or `examples/` Markdown/text files, 32 KiB each; serialized release 256 KiB. No links are followed.

Every approved format must be active/default in the capability manifest: PDF and default PPTX remain
unavailable. Unsupported operations, changed upstream operation/format declarations, tool permissions,
scripts, hooks, dependencies or runtime requirements cause rejection instead of silent adaptation.
Unclear semantics require independent rewriting and fresh approval. Human review must also inspect
the prose; automatic parsing cannot prove arbitrary natural language is safe.

### Original pilots and administrator workflow

`examples/agent-skills/` contains independently authored Excel data-quality and Word technical-document
review pilots, including checklists, under Apache-2.0. No proprietary Office skills or unverified plugin
content was reused. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

After the pilot files exist in an audited commit, print an allowlist for review. This does not install:

```bash
npm run typecheck
node scripts/prepare-pilot-import.mjs --checkout /absolute/otterpatch \
  --revision <full-commit-sha> --registry /private/skill-registry \
  --approved-by <reviewer-id> > /private/skill-import.json
```

Verify the source, license, operations and references. Import one selected skill, inspect its returned
release hash, then explicitly enable it:

```bash
npm run skills --workspace @otterpatch/mcp-server -- import --config /private/skill-import.json --source otterpatch-pilots --path examples/agent-skills/excel-data-quality/SKILL.md
npm run skills --workspace @otterpatch/mcp-server -- inspect --config /private/skill-import.json --release <release-hash>
npm run skills --workspace @otterpatch/mcp-server -- enable --config /private/skill-import.json --id pilot/excel-data-quality --release <release-hash>
```

Repeat explicitly for `word-technical-review` if approved. Import does not change activation; a new
release is not automatically enabled. Set `OtterPatch_SKILL_REGISTRY=/private/skill-registry` and
restart hosts. Runtime, HTTP, CLI and MCP use `skillLibraryFromEnv`; Electron inherits this environment
when starting the HTTP service. Explicit Runtime libraries take precedence. Existing
`OtterPatch_SKILLS_DIR` stays compatible for local/distilled content, not third-party import approval;
its loader skips `references/` and `scripts/` as standalone skills. Approved locked imports take
precedence over conflicting loose external files; conflicts are reported. `--list-skills` exposes the
CLI catalog without a provider key. Removing an allowlist entry alone does not revoke an already
imported release: disable it and restart hosts.

Enabled external cards are discoverable through untrusted catalogs, never trusted System Prompt
metadata. `load_skill` returns their body and reference index; optional `load_skill_reference(name,path)`
returns only exact approved in-memory snapshots as `untrusted_data`, without filesystem/network
resolution. Bundle checksums enter Agent provenance. No import or activation tool is exposed to the
model, HTTP or MCP. Proposal, receipt, commit and output-verification rules are unchanged.

### Disable, rollback and limits

```bash
npm run skills --workspace @otterpatch/mcp-server -- disable --config /private/skill-import.json --id pilot/excel-data-quality --release <current-release-hash>
npm run skills --workspace @otterpatch/mcp-server -- rollback --config /private/skill-import.json --id pilot/excel-data-quality --release <previous-release-hash>
```

Restart **all** hosts after state changes; already-created libraries are snapshots. Old releases remain
available for explicit rollback and are revalidated for checksum, ID, license and current capabilities.
Disabling guidance does not revoke already-signed reviews. Keep registry/configuration private and
backed up; serialize administrator changes. Pointer replacement is atomic, but multi-administrator
CAS, distributed storage, automatic remote updates and garbage collection are not implemented.
Invalid releases/pointers are reported and omitted, never promoted or silently repaired.

Runtime pilot regressions compare a simulated model before/after activation: six Chinese/traditional
Chinese queries match the intended pilot first from 0/6 to 6/6. Tests exercise actual body/reference
loading, valid ChangeSets, provenance, mandatory review, signature/replay rejection and real XLSX/DOCX
read-back. Excel's mock display proposal changes from `0` to `0.00` after reading its checklist; Word
keeps the requested replacement while adding checklist evidence. This validates integration, not
real-model quality improvements. Real provider evaluation and native packaged-platform runs remain
separate checks. `npm run test:skill-surfaces` starts real HTTP/MCP/CLI hosts against a temporary
approved registry and checks discovery and disable behavior; CI runs it after the build.

## Authoring rules

- Start with observations the model must collect before making changes.
- State the exact supported operations and scopes. Do not recommend unsupported structure, chart,
  master-layout, or document-wide formatting edits as if they can be committed.
- Use stable, unique anchors: A1 ranges, source quotes constrained by block number, or object IDs.
- Describe serial ordering when edits affect later anchors.
- Include explicit anti-patterns and fail-closed behavior.
- Keep metadata versioned and locale-specific; bump the version when behavior changes.
- Run `npm test --workspace @otterpatch/skills` after editing. Tests ensure every built-in stays
  checksummed, namespaced, capability-bounded, and free of obsolete operation claims; they also
  verify that frozen PPTX metadata never leaks into the default library.


## Official internal-comms / 官方技能验收

See [the official internal-comms audit](./internal-comms-audit.md) for the fixed upstream SHA,
file-reference license rules, exact example resources, separate local adaptation, actual CLI lifecycle
and the distinct engineering PASS versus real-model SKIPPED result. Damaged or disabled registry
IDs cannot fall back to same-name loose files.
