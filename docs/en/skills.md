# Skills and Playbooks

`packages/skills` supplies domain guidance without granting mutation authority. The format capability
manifest remains the hard boundary; a skill can narrow or improve a workflow, but cannot add an
operation.

## Built-in catalog

The default library contains two forms of immutable built-in content:

| Kind | Purpose | System-prompt exposure |
|---|---|---|
| capability card | concise, format-level description for `xlsx`, `docx`, `pptx`, `pdf`, and `drawio` | trusted checksummed metadata only: ID, version, checksum, locale, description, compatible operations |
| playbook | task-specific checklist and operation idioms | only its trusted L0 metadata; full instructions load on demand as untrusted tool data |

The seven current playbooks are:

| Playbook | Scope |
|---|---|
| `docx-gongwen` | GB/T 9704 official-document conventions within anchored Word formatting support |
| `docx-conventions` | general Word typography, hierarchy, spacing, and consistency checks |
| `docx-coauthoring` | serial outline/draft/review workflow for collaborative writing |
| `xlsx-financial` | reconciliation, formulas, money/percent formats, and read-before-write checks |
| `xlsx-authoring` | spreadsheet modeling and presentation rules within current cell operations |
| `chart-selection` | advisory chart-choice rules; `allowed_ops` is empty because chart write-back is unsupported |
| `pptx-design` | presentation advice plus the current single-run text-replacement boundary |

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

## Authoring rules

- Start with observations the model must collect before making changes.
- State the exact supported operations and scopes. Do not recommend unsupported structure, chart,
  master-layout, or document-wide formatting edits as if they can be committed.
- Use stable, unique anchors: A1 ranges, source quotes constrained by block number, or object IDs.
- Describe serial ordering when edits affect later anchors.
- Include explicit anti-patterns and fail-closed behavior.
- Keep metadata versioned and locale-specific; bump the version when behavior changes.
- Run `npm test --workspace @otterpatch/skills` after editing. Tests ensure every built-in stays
  checksummed, namespaced, capability-bounded, and free of obsolete operation claims.
