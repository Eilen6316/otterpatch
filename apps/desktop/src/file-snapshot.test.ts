import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fileSnapshotDocumentId,
  makeFileSnapshot,
  proposalMatchesFileSnapshot,
  sameFileSnapshot,
} from './file-snapshot.js';

test('makeFileSnapshot records stable SHA-256 file identity and revision', async () => {
  const a = await makeFileSnapshot('word', 'doc.docx', 'aGVsbG8=');
  const b = await makeFileSnapshot('word', 'doc.docx', 'aGVsbG8=');
  assert.deepEqual(a, b);
  assert.equal(a.byteLength, 5);
  assert.equal(a.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(Number.isSafeInteger(a.revision), true);
  assert.equal(sameFileSnapshot(a, b), true);
});

test('sameFileSnapshot rejects renamed, reformatted, or changed files', async () => {
  const base = await makeFileSnapshot('drawio', 'graph.drawio', 'PG14ZmlsZT4=', 'compressed');
  assert.equal(sameFileSnapshot(base, await makeFileSnapshot('word', 'graph.drawio', 'PG14ZmlsZT4=')), false);
  assert.equal(sameFileSnapshot(base, await makeFileSnapshot('drawio', 'other.drawio', 'PG14ZmlsZT4=')), false);
  assert.equal(sameFileSnapshot(base, await makeFileSnapshot('drawio', 'graph.drawio', 'PG14ZmlsZTI+')), false);
  assert.equal(sameFileSnapshot(base, await makeFileSnapshot('drawio', 'graph.drawio', 'PG14ZmlsZT4=', 'uncompressed')), false);
  assert.equal(sameFileSnapshot(base, null), false);
});

test('proposal binding requires the exact SHA-256, revision, document id, and format', async () => {
  const snapshot = await makeFileSnapshot('word', 'doc.docx', 'aGVsbG8=');
  const proposal = {
    format: 'word',
    sourceFileSha256: snapshot.sha256,
    baseRev: snapshot.revision,
    documentId: fileSnapshotDocumentId(snapshot),
  };
  assert.equal(proposalMatchesFileSnapshot(proposal, snapshot), true);
  assert.equal(proposalMatchesFileSnapshot({ ...proposal, sourceFileSha256: '0'.repeat(64) }, snapshot), false);
  assert.equal(proposalMatchesFileSnapshot({ ...proposal, baseRev: 0 }, snapshot), false);
  assert.equal(proposalMatchesFileSnapshot(null, snapshot), false);
});
