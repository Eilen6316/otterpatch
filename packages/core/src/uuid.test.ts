import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUuidV7, uuidv7 } from './uuid.js';

test('uuidv7 emits RFC 9562 version/variant bits and preserves chronological order', () => {
  const now = Date.now();
  const earlier = uuidv7(now);
  const later = uuidv7(now + 1);
  assert.equal(isUuidV7(earlier), true);
  assert.equal(isUuidV7(later), true);
  assert.ok(earlier < later);
});

test('uuidv7 is unique and monotonic within the same millisecond', () => {
  const now = Date.now() + 2;
  const values = Array.from({ length: 1_000 }, () => uuidv7(now));
  assert.equal(new Set(values).size, values.length);
  assert.deepEqual(values, values.slice().sort());
});

test('isUuidV7 rejects other UUID versions and malformed values', () => {
  assert.equal(isUuidV7('550e8400-e29b-41d4-a716-446655440000'), false);
  assert.equal(isUuidV7('not-a-uuid'), false);
});
