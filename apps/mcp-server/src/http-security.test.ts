import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LocalPostGate,
  createLocalHttpSecurity,
  isAllowedLocalOrigin,
  matchesLocalToken,
  redactSecrets,
} from './http-security.js';

test('local HTTP security generates effective tokens when none are configured', () => {
  let sequence = 0;
  const config = createLocalHttpSecurity({
    env: {},
    generateToken: () => `generated-token-${++sequence}`,
  });

  assert.equal(config.authToken, 'generated-token-1');
  assert.equal(config.reviewToken, 'generated-token-2');
  assert.equal(config.authTokenGenerated, true);
  assert.equal(config.reviewTokenGenerated, true);
  assert.equal(matchesLocalToken(config.authToken, config.authToken), true);
  assert.equal(matchesLocalToken(undefined, config.authToken), false);
  assert.equal(matchesLocalToken(['generated-token-1'], config.authToken), false);
});

test('configured tokens are retained and exact loopback origins replace broad localhost matching', () => {
  const config = createLocalHttpSecurity({
    env: {
      OtterPatch_TOKEN: 'configured-local-token',
      OtterPatch_REVIEW_TOKEN: 'configured-review-token',
      OtterPatch_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:4173,null',
    },
  });

  assert.equal(config.authTokenGenerated, false);
  assert.equal(config.reviewTokenGenerated, false);
  assert.equal(isAllowedLocalOrigin(undefined, config.allowedOrigins), true);
  assert.equal(isAllowedLocalOrigin('null', config.allowedOrigins), true);
  assert.equal(isAllowedLocalOrigin('http://localhost:5173', config.allowedOrigins), true);
  assert.equal(isAllowedLocalOrigin('http://127.0.0.1:4173', config.allowedOrigins), true);
  assert.equal(isAllowedLocalOrigin('http://localhost:9999', config.allowedOrigins), false);
  assert.equal(isAllowedLocalOrigin('https://evil.test', config.allowedOrigins), false);
});

test('local HTTP security rejects wildcard, remote, and malformed origin configuration', () => {
  const base = { OtterPatch_TOKEN: 'local-token', OtterPatch_REVIEW_TOKEN: 'review-token' };
  for (const origin of ['*', 'https://example.com', 'http://localhost:5173/path']) {
    assert.throws(
      () => createLocalHttpSecurity({ env: { ...base, OtterPatch_ALLOWED_ORIGINS: origin } }),
      /ALLOWED_ORIGINS/,
    );
  }
});

test('local token comparison is exact and secret redaction covers every occurrence', () => {
  assert.equal(matchesLocalToken('same-token', 'same-token'), true);
  assert.equal(matchesLocalToken('same-token-x', 'same-token'), false);
  assert.equal(matchesLocalToken('other-token', 'same-token'), false);
  assert.equal(
    redactSecrets('local-token then review-token then local-token', ['local-token', 'review-token']),
    '[REDACTED] then [REDACTED] then [REDACTED]',
  );
});

test('POST gate enforces per-client rate and global concurrency limits', () => {
  const rateGate = new LocalPostGate({ maxRequests: 2, windowMs: 1_000, maxConcurrent: 2 });
  const first = rateGate.enter('client', 0);
  assert.equal(first.ok, true);
  if (first.ok) first.release();
  const second = rateGate.enter('client', 1);
  assert.equal(second.ok, true);
  if (second.ok) second.release();
  const limited = rateGate.enter('client', 2);
  assert.deepEqual(limited, { ok: false, reason: 'rate_limit', retryAfterSeconds: 1 });
  const reset = rateGate.enter('client', 1_000);
  assert.equal(reset.ok, true);
  if (reset.ok) reset.release();

  const concurrencyGate = new LocalPostGate({ maxRequests: 10, windowMs: 1_000, maxConcurrent: 1 });
  const active = concurrencyGate.enter('client-a', 0);
  assert.equal(active.ok, true);
  assert.deepEqual(concurrencyGate.enter('client-b', 0), { ok: false, reason: 'concurrency', retryAfterSeconds: 1 });
  if (active.ok) {
    active.release();
    active.release();
  }
  const admitted = concurrencyGate.enter('client-b', 1);
  assert.equal(admitted.ok, true);
  if (admitted.ok) admitted.release();
});
