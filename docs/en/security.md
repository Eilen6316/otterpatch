# Security Model

This document describes the boundaries enforced by the current code, plus the responsibilities that
remain with an embedding host. It is not a claim that a `0.0.1` development preview is suitable for
every production environment.

## Assets and attackers

OtterPatch protects source document bytes, review decisions, provider credentials, and the authority
to write a changed file. Inputs treated as potentially hostile include document text/XML/ZIPs,
external skill files, model output, MCP/HTTP payloads, renderer IPC, and provider responses.

The design assumes trusted local application code and an uncompromised runtime process. It does not
attempt to defend against an attacker who already controls that process, the user's OS account, or
the embedding host's review authority.

## Enforced controls

### Prompt and skill isolation

- Request-specific document content is user data, never system text.
- The system prompt contains fixed policy, current capability constraints, and immutable built-in
  skill metadata only.
- External `SKILL.md` descriptions cannot enter the system prompt or claim the reserved `otterpatch`
  namespace. Their bodies are returned as `untrusted_data` tool results.
- Skill matching and loading intersect `allowed_ops` with the active format manifest. A skill cannot
  grant an operation the backend does not support.
- Executable L2 skill scripts are not enabled.

### Agent identity and provenance

- Agent ChangeSet IDs are monotonic RFC 9562 UUIDv7 values.
- Trusted request code captures provider, model, provider response ID, prompt-policy version,
  source SHA-256, parent proposal, repair attempt, skill version/checksum, session, user, and
  document identity.
- `assertChangeSet` rejects incomplete provenance, placeholder `mock` sessions, malformed hashes,
  duplicate edit IDs, invalid operation payloads, and resource-limit violations.
- Proposal signing cross-checks the agent's actor/source bindings instead of trusting model output.

### Review authority

- Proposals and receipts use domain-separated HMAC-SHA256 signatures over canonical JSON.
- Proposal and receipt TTL defaults to 30 minutes.
- A receipt binds the exact proposal, ChangeSet hash, source SHA-256, accepted edit IDs, reviewer
  session, policy version, and nonce.
- Runtime rejects receipt replay, source replay after reservation or successful commit, stale policy/capability
  versions, changed files, changed ChangeSets, and changed accepted subsets.
- Unreviewed commit is disabled by default. The MCP opt-in
  `OTTERPATCH_ALLOW_UNREVIEWED_COMMIT=1` is intentionally hazardous and still requires explicit
  edit IDs and a live revision.

### Runtime and write-back

- `capabilities-v2` marks each known format as default/opt-in and active/frozen. The stock adapter
  registry, host schemas, `/health`, desktop picker, and default skill library expose only default
  formats.
- Capability and semantic validation run before review and again before write-back.
- Scope-aware risk policy is enforced by runtime, not just displayed by the UI.
- The Promise queue serializes `[documentId, canonical format]` within one process. Shared-store
  transactions separately enforce single admission per `[documentId, canonical format, source SHA-256]`
  across processes; the queue is not a cross-process lock.
- A fallback backend may be selected only before execution begins.
- Output verification is mandatory and reports package validity, locality, per-edit semantic status,
  and compatibility warnings. Unknown semantic state is `unverifiable`, never silently `verified`.
- Event listeners are isolated from the commit path.

### Resource and provider controls

- HTTP bodies, decoded documents, ZIP entry counts/sizes/ratios, total expansion, XML nesting,
  ChangeSet size/depth/nodes/strings, A1 range area, tool output, context/history, model output,
  duration, and concurrency all have hard limits.
- Provider calls use explicit timeouts, bounded retries/backoff, circuit breaking, normalized errors,
  and end-to-end cancellation. A stream is never replayed after it starts yielding output.
- Public streaming exposes bounded status/final-answer data, not raw provider reasoning or thinking
  deltas.

### Local HTTP and Electron

- `otterpatch-serve` binds only to `127.0.0.1`.
- Every `POST` requires a generated or configured local token; `/review` also requires a distinct
  review token. Token comparison is timing-safe and error messages redact known secrets.
- CORS accepts exact configured loopback origins only. Wildcards, remote origins, and malformed
  origins are rejected. POST rate and concurrency gates apply before work begins.
- In browser development, the user explicitly enters both local tokens. They are stored in that
  local development origin's storage.
- In Electron, tokens stay in the main process. The renderer has `contextIsolation`, sandboxing,
  and no Node integration; preload exposes narrow schema/size-checked IPC, not credentials or a
  generic authenticated fetch primitive.

## Shared review state: deployment and transaction boundaries

`OtterPatch_REVIEW_STATE_DIR` selects `FileReviewAuthorityStore`. All participating services must
use the same private directory on a **local filesystem with working SQLite locking and sync**.
NFS/SMB, object storage, multiple hosts and untrusted directory writers are unsupported. This store
requires Node.js **22.16+** with `node:sqlite` (still experimental in Node 22); no third-party or native
addon dependency was introduced. SQLite is loaded only when this store is constructed. The default
in-memory authority and Electron's default process-local flow do not load SQLite. Using a shared
store inside an older Electron Node runtime requires upgrading that runtime or using a Node 22.16+
service; it must not fall back to empty in-memory state.

The published `authority-v2/` directory contains `review-secret.key`, `review-state.json` (identity,
schema and secret fingerprint), and `review-state.sqlite`. A private staging directory is fully
written and synced before publication. Concurrent initializers publish one complete, nonempty
directory; losers load the winner's identity/key. An interrupted unpublished staging directory has
never issued authority and is ignored. A sibling `review-initialized/` witness is synced before a
constructor returns; if the published directory subsequently disappears, initialization is refused.
Never delete the published directory or its witness to troubleshoot it.

Each operation validates metadata, key fingerprint, database identity/schema, SQLite `quick_check`,
entry types and resource limits. Missing, truncated, unreadable, malformed, unknown-version or
mismatched state rejects operations, including signing through Runtime. Errors distinguish
`REVIEW_STORE_CORRUPT`, `REVIEW_STORE_IO` (including filesystem error/cause), `REVIEW_STORE_BUSY`
(5-second bounded lock wait), and `REVIEW_STORE_CAPACITY`. `REVIEW_STORE_EXPIRED` rejects receipts
that expire while waiting for admission. There is no automatic reset or key repair.

Admission uses `BEGIN IMMEDIATE` to consume the verified receipt nonce and insert a **pending source
claim in the same transaction**. SQLite unique keys and OS-managed locks prevent lost updates;
`synchronous=FULL` and the rollback journal persist the transaction before writeback starts. Writer
transactions briefly serialize all documents during validation/admission/completion; none spans
the async backend or verification. A different document can proceed while a backend is stalled.
Do not delete journals or lock-related files; SQLite recovers interrupted writers on the next open.

Only after writeback and structured read-back verification does another durable transaction mark
the source `committed`. A failure to persist completion throws, and Runtime does not return success
or output bytes. A thrown/unsuccessful backend, process crash, or uncertain completion **retains the
pending claim and consumed nonce**. No lease expires and no automatic retry releases that claim.
The `isCommittedSource` compatibility method returns true for pending as well as committed sources.
These semantics favor at-most-once admission over automatic recovery of abandoned work. Custom
`ReviewAuthorityStore` implementations must implement the new atomic `beginCommit` operation;
the former separate check/remember calls cannot express that guarantee. A supplied Runtime
`reviewSecret` must match a supplied store's key.

Consumed nonces may be pruned only after receipt expiry; HMAC and expiry verification still reject
the original receipt. Pending/committed sources are never pruned. Each table is capped at 10,000
entries; capacity exhaustion refuses new work, never evicts replay protection. Format aliases
(`xlsx`/`excel`, `docx`/`word`) share the same source guard.

Runtime returns bytes, not a host filesystem transaction. A crash after completion persistence but
before response delivery can leave a committed source with no delivered output; host replacement,
backup and audit are outside this transaction. This prevents duplicate admission but does not promise
exactly-once delivery or atomicity with arbitrary backend side effects.

### Offline migration and recovery

1. Stop **all** instances using this authority, including old-version services. Back up the entire
   directory (including any SQLite journal) before inspection. For example, on a POSIX shell:

   ```bash
   state_dir=/absolute/private/review-state
   cp -a -- "$state_dir" "${state_dir}.backup-$(date -u +%Y%m%dT%H%M%SZ)"
   ```

2. For a healthy v1 pair, build the repository and perform explicit offline migration from its root:

   ```bash
   node --input-type=module - "$state_dir" <<'JS'
   import { FileReviewAuthorityStore } from './packages/runtime/dist/index.js';
   new FileReviewAuthorityStore(process.argv[2], undefined, { migrateLegacy: true });
   console.log('Review authority validated/migrated; no key material printed.');
   JS
   ```

   Both v1 files must be present and strictly valid. Migration copies every nonce/source and the
   existing key, adds canonical alias guards, and leaves original files untouched as evidence.
   It cannot diagnose key/state mismatch that the old format never recorded: use a trusted matched
   pair. Do not run old writers after migration or roll back to their stale JSON files.

3. For corruption, restore a **complete matched authority** from a trusted, sufficiently current
   backup into a separate private directory, then validate it with the constructor before switching
   configuration. A stale snapshot loses later replay records; reconcile all subsequent consumed
   receipts and pending/committed sources from trusted records before resuming. A valid SQLite
   `quick_check` alone does not prove backup freshness. Never restore only the key or one state file.

4. Reconcile pending claims against host output, source hashes and audit evidence. Keep them blocked
   if the outcome is uncertain; do not delete them to retry. Use a verified latest output/new source
   and fresh human review for subsequent work. A process crash does not require manual lock removal.

5. If trustworthy history cannot be restored, keep old-document commits disabled. A separately
   created directory generates a new authority/key and invalidates old receipts/proposals, but
   **does not reconstruct source replay history**. Before resuming protected sources, recover their
   full denylist or explicitly retire those sources; re-review alone is insufficient to recover the
   lost at-most-once guarantee. Preserve damaged files and backups for investigation.

POSIX initialization syncs files and directories. Node cannot fsync directories on Windows; SQLite
still uses its native FULL-sync journal, but initial directory publication has a power-loss durability
limitation. Process-crash recovery is tested; hardware failure, dishonest filesystem sync, hostile
local modification, deletion of the entire authority, and rollback to an old consistent snapshot
are outside the guarantee. Windows/macOS-specific execution must be validated on those platforms.

## Current limitations

- Review authority state (HMAC secret, consumed nonces, committed sources) defaults to
  process-local. Multi-process deployments pass a shared `ReviewAuthorityStore`
  (`FileReviewAuthorityStore`, or an implementation against Redis/DB): the service exposes it
  via `OtterPatch_REVIEW_STATE_DIR`. Audit retention of *what was reviewed and merged* has a
  built-in option — the append-only `AuditLedger` (`OtterPatch_AUDIT_DIR`); it is evidence
  only, never a control-flow gate, and hosts with stricter retention requirements can
  implement the same interface against their own store.
- Runtime returns bytes. The host owns atomic file replacement, backups, access control, and durable
  audit retention — `writeFileSafely` (exported from `@otterpatch/runtime`) is the reference
  implementation (backup first, temp + fsync + rename) and the CLI uses it by default.
- OtterPatch rejects stale proposals and never rebases automatically. `runtime.rebaseProposal`
  is an explicit host action for the changed-source case; it records the hash the model actually
  saw (`provenance.rebasedFromSourceSha256`) and the new receipt binds the new source, so the
  edit set must still be re-reviewed against the new file.
- Excel and Word now perform deterministic edit-level semantic read-back after write-back (see
  architecture.md); remaining honest gaps are formula cached results (recalculated by the host
  application on open) and rendering-level equivalence. The frozen opt-in PPTX adapter still reports
  applied edits as semantically unverifiable but is absent from stock product surfaces. PDF support
  has been removed entirely.
- The stock MCP stdio server has no review-receipt minting tool. The default reviewed commit needs
  an in-process embedding that shares the runtime's review authority; the built-in end-to-end
  reviewed path is HTTP/Electron. `OTTERPATCH_ALLOW_UNREVIEWED_COMMIT=1` weakens that boundary.
- OOXML validation is bounded structural/package validation, not a complete Microsoft Office or
  ISO conformance proof.
- The browser development path stores local-service tokens in localStorage. Use the Electron path
  when renderer isolation is required.
- Provider API keys are sent to the selected provider through the local service. Protect the local
  machine and use least-privilege, revocable keys.

## Reporting

Do not include real documents, provider keys, local-service tokens, or review tokens in issues,
logs, fixtures, or screenshots. Revoke any credential that has been pasted into a chat or terminal
transcript.
