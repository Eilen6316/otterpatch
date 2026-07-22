import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docRevFromSha256, isSha256 } from './revision.js';

test('SHA-256 revisions are stable safe integers while retaining the full digest separately', () => {
  const digest = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const rev = docRevFromSha256(digest);
  assert.equal(rev, Number.parseInt(digest.slice(0, 13), 16));
  assert.equal(Number.isSafeInteger(rev), true);
  assert.equal(isSha256(digest), true);
});

test('SHA-256 revision parsing rejects abbreviated, uppercase, and non-hex values', () => {
  for (const value of ['abc', 'A'.repeat(64), 'z'.repeat(64)]) {
    assert.equal(isSha256(value), false);
    assert.throws(() => docRevFromSha256(value), /SHA-256/);
  }
});
