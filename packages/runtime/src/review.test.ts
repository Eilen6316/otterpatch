import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docRevFromSha256, type AnchorId, type ChangeSet, type DocRev, type HostId } from '@otterpatch/core';
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
