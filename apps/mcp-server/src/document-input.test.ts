import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResourceLimitError } from '@otterpatch/core';
import { decodeDocumentBase64 } from './document-input.js';

test('document input validates base64 and rejects declared bytes before decoding', () => {
  assert.deepEqual([...decodeDocumentBase64('AQID', 3)], [1, 2, 3]);
  assert.throws(() => decodeDocumentBase64('not base64!'), /invalid document base64/);
  assert.throws(
    () => decodeDocumentBase64('AQIDBA==', 3),
    (error) => error instanceof ResourceLimitError && error.resource === 'document_bytes' && error.actual === 4,
  );
});
