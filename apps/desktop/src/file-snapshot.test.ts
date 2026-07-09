import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFileSnapshot, sameFileSnapshot } from './file-snapshot.js';

test('makeFileSnapshot records stable file identity', () => {
  const a = makeFileSnapshot('word', 'doc.docx', 'aGVsbG8=');
  const b = makeFileSnapshot('word', 'doc.docx', 'aGVsbG8=');
  assert.deepEqual(a, b);
  assert.equal(a.byteLength, 5);
  assert.equal(sameFileSnapshot(a, b), true);
});

test('sameFileSnapshot rejects renamed, reformatted, or changed files', () => {
  const base = makeFileSnapshot('drawio', 'graph.drawio', 'PG14ZmlsZT4=');
  assert.equal(sameFileSnapshot(base, makeFileSnapshot('word', 'graph.drawio', 'PG14ZmlsZT4=')), false);
  assert.equal(sameFileSnapshot(base, makeFileSnapshot('drawio', 'other.drawio', 'PG14ZmlsZT4=')), false);
  assert.equal(sameFileSnapshot(base, makeFileSnapshot('drawio', 'graph.drawio', 'PG14ZmlsZTI+')), false);
  assert.equal(sameFileSnapshot(base, null), false);
});
