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
- Runtime rejects receipt replay, source replay after successful commit, stale policy/capability
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
- Commits for one `[documentId, format]` are serialized.
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

## Current limitations

- Review secrets, nonce replay state, and committed-source state are process-local. A production
  multi-process deployment needs a shared authority and durable replay/audit store.
- Runtime returns bytes. The host owns atomic file replacement, backups, access control, and durable
  audit retention.
- OtterPatch rejects stale proposals; it does not automatically rebase edits onto a changed file.
- Excel and Word currently provide package/locality verification but conservatively report applied
  edits as semantically unverifiable after write-back. The frozen opt-in PPTX adapter has the same
  limitation but is absent from stock product surfaces. PDF support has been removed entirely.
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
