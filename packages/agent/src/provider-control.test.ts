import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderCallController, ProviderCallError, normalizeProviderError } from './provider-control.js';

test('provider control retries transient failures with bounded exponential backoff', async () => {
  const delays: number[] = [];
  let calls = 0;
  const control = new ProviderCallController({
    provider: 'test-retry',
    circuitKey: 'test-retry-success',
    retryPolicy: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    sleep: async (ms) => { delays.push(ms); },
  });

  const result = await control.run(async () => {
    calls++;
    if (calls < 3) throw Object.assign(new Error('unavailable'), { status: 503 });
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test('provider control aborts retry backoff immediately', async () => {
  const controller = new AbortController();
  const control = new ProviderCallController({
    provider: 'test-abort',
    circuitKey: 'test-abort-backoff',
    retryPolicy: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    sleep: async (_ms, signal) => {
      controller.abort();
      signal?.throwIfAborted();
    },
  });

  await assert.rejects(
    () => control.run(async () => { throw Object.assign(new Error('rate limited'), { status: 429 }); }, { signal: controller.signal }),
    (error) => error instanceof ProviderCallError && error.kind === 'aborted' && !error.retryable,
  );
});

test('provider backoff honors Retry-After beyond the exponential cap', async () => {
  const delays: number[] = [];
  let calls = 0;
  const control = new ProviderCallController({
    provider: 'test-retry-after',
    circuitKey: 'test-retry-after-delay',
    retryPolicy: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    sleep: async (ms) => { delays.push(ms); },
  });
  await control.run(async () => {
    if (calls++ === 0) {
      throw Object.assign(new Error('rate limited'), { status: 429, headers: new Headers({ 'retry-after': '2' }) });
    }
  });
  assert.deepEqual(delays, [2_000]);
});

test('provider jitter never exceeds the configured backoff cap', async () => {
  const delays: number[] = [];
  let calls = 0;
  const control = new ProviderCallController({
    provider: 'test-delay-cap',
    circuitKey: 'test-delay-cap-jitter',
    retryPolicy: { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 4_000, jitterRatio: 1 },
    random: () => 1,
    sleep: async (ms) => { delays.push(ms); },
  });
  await control.run(async () => {
    if (calls++ < 3) throw Object.assign(new Error('unavailable'), { status: 503 });
  });
  assert.deepEqual(delays, [2_000, 4_000, 4_000]);
});

test('provider circuit opens after repeated transient failures and permits a half-open probe', async () => {
  let now = 1_000;
  let calls = 0;
  const options = {
    provider: 'test-circuit',
    circuitKey: 'test-circuit-shared',
    retryPolicy: { maxRetries: 0, circuitFailureThreshold: 2, circuitCooldownMs: 50 },
    now: () => now,
  };
  const fail = async (): Promise<void> => { calls++; throw Object.assign(new Error('down'), { status: 503 }); };

  await assert.rejects(() => new ProviderCallController(options).run(fail));
  await assert.rejects(() => new ProviderCallController(options).run(fail));
  await assert.rejects(
    () => new ProviderCallController(options).run(async () => { calls++; }),
    (error) => error instanceof ProviderCallError && error.kind === 'circuit_open',
  );
  assert.equal(calls, 2, 'open circuit must reject without contacting the provider');

  now += 51;
  await new ProviderCallController(options).run(async () => { calls++; });
  assert.equal(calls, 3);
});

test('cancellation does not erase earlier provider failures', async () => {
  let now = 1_000;
  const options = {
    provider: 'test-circuit-abort',
    circuitKey: 'test-circuit-abort-preserves-failures',
    retryPolicy: { maxRetries: 0, circuitFailureThreshold: 2, circuitCooldownMs: 50 },
    now: () => now,
  };
  const transientFailure = async (): Promise<void> => { throw Object.assign(new Error('down'), { status: 503 }); };
  await assert.rejects(() => new ProviderCallController(options).run(transientFailure));

  const controller = new AbortController();
  await assert.rejects(
    () => new ProviderCallController(options).run(async () => {
      controller.abort();
    }, { signal: controller.signal }),
    (error) => error instanceof ProviderCallError && error.kind === 'aborted',
  );

  await assert.rejects(() => new ProviderCallController(options).run(transientFailure));
  await assert.rejects(
    () => new ProviderCallController(options).run(async () => undefined),
    (error) => error instanceof ProviderCallError && error.kind === 'circuit_open',
  );
  now += 51;
});

test('provider errors use a stable taxonomy and safe JSON payload', () => {
  const raw = Object.assign(new Error('secret provider body'), {
    status: 429,
    requestID: 'req_123',
    headers: new Headers({ 'retry-after': '2' }),
  });
  const normalized = normalizeProviderError('openai', raw);

  assert.equal(normalized.kind, 'rate_limit');
  assert.equal(normalized.code, 'PROVIDER_RATE_LIMIT');
  assert.equal(normalized.retryable, true);
  assert.equal(normalized.retryAfterMs, 2_000);
  assert.deepEqual(normalized.toJSON(), {
    code: 'PROVIDER_RATE_LIMIT',
    provider: 'openai',
    kind: 'rate_limit',
    retryable: true,
    status: 429,
    requestId: 'req_123',
    retryAfterMs: 2_000,
  });
  assert.doesNotMatch(JSON.stringify(normalized.toJSON()), /secret provider body/);

  const cases = [
    ['claude', { status: 401 }, 'authentication'],
    ['deepseek', { status: 403 }, 'permission'],
    ['gemini', { status: 422 }, 'invalid_request'],
    ['glm', { status: 503 }, 'unavailable'],
  ] as const;
  for (const [provider, error, kind] of cases) {
    const item = normalizeProviderError(provider, error);
    assert.equal(item.provider, provider);
    assert.equal(item.kind, kind);
  }

  assert.equal(normalizeProviderError('node-fetch', Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })).kind, 'network');
  assert.equal(normalizeProviderError('node-fetch', Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' })).kind, 'timeout');
});
