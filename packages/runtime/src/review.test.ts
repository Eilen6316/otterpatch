import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docRevFromSha256, uuidv7, type AnchorId, type ChangeSet, type DocRev, type HostId } from '@otterpatch/core';
import { ReviewAuthority, sha256Bytes } from './review.js';

const bytes = new TextEncoder().encode('source document');
const digest = sha256Bytes(bytes);

function changeSet(baseRev: DocRev = docRevFromSha256(digest)): ChangeSet {
  const hostId = 'host' as HostId;
  const anchorId = 'a1' as AnchorId;
  return {
    id: 'bound-proposal',
    hostId,
    baseRev,
    anchors: {
      [anchorId]: {
        id: anchorId, hostId, kind: 'flow', ref: null, baseRev,
        portable: { kind: 'flow', path: [0], quote: { prefix: '', text: 'source', suffix: '' }, bias: 'left' },
      },
    },
    origin: { by: 'human' },
    meta: { intent: 'replace source' },
    edits: [{ id: 'e1', target: anchorId, op: { family: 'text', kind: 'replaceText', text: 'target' } }],
  };
}

function agentChangeSet(documentId: string, sourceFileSha256: string | null): ChangeSet {
  return {
    ...changeSet(),
    id: uuidv7(),
    origin: {
      by: 'agent',
      sessionId: uuidv7(),
      provenance: {
        provider: 'openai', model: 'provider-model', modelRequestId: 'response-1', skillVersions: [],
        promptPolicyVersion: 'prompt-policy-v1', sourceFileSha256, parentProposalId: null, repairAttempt: 0,
        actor: { userId: 'user-1', hostId: documentId },
      },
    },
  };
}

test('proposal signing binds the source SHA-256 and its numeric revision projection', () => {
  const authority = new ReviewAuthority('x'.repeat(32));
  const cs = changeSet();
  const proposal = authority.createProposal(cs, 'word', 'doc', digest);
  assert.equal(proposal.sourceFileSha256, digest);
  assert.equal(proposal.baseRev, docRevFromSha256(digest));
  assert.throws(
    () => authority.createProposal(changeSet(0 as DocRev), 'word', 'doc', digest),
    /base revision does not match/,
  );
});

test('a source-bound proposal cannot be reviewed against different bytes', () => {
  const authority = new ReviewAuthority('x'.repeat(32));
  const cs = changeSet();
  const proposal = authority.createProposal(cs, 'word', 'doc', digest);
  assert.throws(
    () => authority.review(proposal, cs, ['e1'], new TextEncoder().encode('different'), 'reviewer'),
    /different source file/,
  );
  const reviewed = authority.review(proposal, cs, ['e1'], bytes, 'reviewer');
  assert.deepEqual(authority.verifyForCommit(reviewed.proposal, reviewed.reviewReceipt, cs, 'word', bytes), ['e1']);
});

test('proposal signing cross-checks agent provenance host and source bindings', () => {
  const authority = new ReviewAuthority('x'.repeat(32));
  const cs = agentChangeSet('doc', digest);
  const proposal = authority.createProposal(cs, 'word', 'doc');
  assert.equal(proposal.sourceFileSha256, digest, 'a known provenance hash cannot be dropped');
  assert.throws(() => authority.createProposal(cs, 'word', 'other-doc'), /host identity/);
  assert.throws(() => authority.createProposal(cs, 'word', 'doc', '0'.repeat(64)), /does not match agent provenance/);
  assert.throws(
    () => authority.createProposal(agentChangeSet('doc', null), 'word', 'doc', digest),
    /was not bound to the supplied source/,
  );
});
