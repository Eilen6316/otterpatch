import { isResourceLimitError } from '@otterpatch/core';

export type ProviderErrorKind =
  | 'aborted'
  | 'timeout'
  | 'authentication'
  | 'permission'
  | 'rate_limit'
  | 'invalid_request'
  | 'unavailable'
  | 'network'
  | 'circuit_open'
  | 'unknown';

export type ProviderErrorCode =
  | 'PROVIDER_ABORTED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_AUTHENTICATION'
  | 'PROVIDER_PERMISSION'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_INVALID_REQUEST'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_CIRCUIT_OPEN'
  | 'PROVIDER_UNKNOWN';

export interface ProviderRetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
}

const DEFAULT_RETRY_POLICY: ProviderRetryPolicy = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  jitterRatio: 0.2,
  circuitFailureThreshold: 3,
  circuitCooldownMs: 30_000,
});

const ERROR_CODES: Record<ProviderErrorKind, ProviderErrorCode> = {
  aborted: 'PROVIDER_ABORTED',
  timeout: 'PROVIDER_TIMEOUT',
  authentication: 'PROVIDER_AUTHENTICATION',
  permission: 'PROVIDER_PERMISSION',
  rate_limit: 'PROVIDER_RATE_LIMIT',
  invalid_request: 'PROVIDER_INVALID_REQUEST',
  unavailable: 'PROVIDER_UNAVAILABLE',
  network: 'PROVIDER_NETWORK',
  circuit_open: 'PROVIDER_CIRCUIT_OPEN',
  unknown: 'PROVIDER_UNKNOWN',
};

const ERROR_MESSAGES: Record<ProviderErrorKind, string> = {
  aborted: 'Model request cancelled.',
  timeout: 'Model provider request timed out.',
  authentication: 'Model provider rejected the API key.',
  permission: 'Model provider denied access to this model.',
  rate_limit: 'Model provider rate limit reached.',
  invalid_request: 'Model provider rejected the request.',
  unavailable: 'Model provider is temporarily unavailable.',
  network: 'Could not reach the model provider.',
  circuit_open: 'Model provider circuit is open; retry later.',
  unknown: 'Model provider request failed.',
};

interface CircuitState {
  failures: number;
  openUntil: number;
  probeActive: boolean;
  touchedAt: number;
}

const CIRCUITS = new Map<string, CircuitState>();
const MAX_CIRCUITS = 256;

export class ProviderCallError extends Error {
  readonly code: ProviderErrorCode;

  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
    readonly retryable: boolean,
    readonly status?: number,
    readonly requestId?: string,
    readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(ERROR_MESSAGES[kind], cause === undefined ? undefined : { cause });
    this.name = 'ProviderCallError';
    this.code = ERROR_CODES[kind];
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      provider: this.provider,
      kind: this.kind,
      retryable: this.retryable,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
    };
  }
}

export function isProviderCallError(error: unknown): error is ProviderCallError {
  return error instanceof ProviderCallError
    || (!!error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      && String((error as { code: string }).code).startsWith('PROVIDER_'));
}

export function normalizeProviderError(providerInput: string, error: unknown, signal?: AbortSignal): ProviderCallError {
  if (error instanceof ProviderCallError) return error;
  const provider = safeProvider(providerInput);
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const name = error instanceof Error ? error.name : String(record.name ?? '');
  const message = error instanceof Error ? error.message : String(record.message ?? '');
  const systemCode = String(record.code ?? '').toUpperCase();
  const status = safeStatus(record.status);
  const requestId = safeRequestId(record.requestID ?? record.requestId);
  const retryAfterMs = readRetryAfterMs(record.headers);
  const type = String(record.type ?? '').toLowerCase();

  if (signal?.aborted || name === 'AbortError' || name === 'APIUserAbortError' || systemCode === 'ABORT_ERR') {
    return new ProviderCallError(provider, 'aborted', false, status, requestId, undefined, error);
  }
  if (
    name === 'APIConnectionTimeoutError'
    || status === 408
    || status === 504
    || /timeout|timed out/i.test(`${name} ${message}`)
    || /^(ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(systemCode)
  ) {
    return new ProviderCallError(provider, 'timeout', true, status, requestId, retryAfterMs, error);
  }
  if (status === 401) return new ProviderCallError(provider, 'authentication', false, status, requestId, undefined, error);
  if (status === 403) return new ProviderCallError(provider, 'permission', false, status, requestId, undefined, error);
  if (status === 429 || type.includes('rate_limit')) return new ProviderCallError(provider, 'rate_limit', true, status, requestId, retryAfterMs, error);
  if (status === 400 || status === 404 || status === 422) return new ProviderCallError(provider, 'invalid_request', false, status, requestId, undefined, error);
  if (status === 409 || (status !== undefined && status >= 500) || type.includes('overloaded')) {
    return new ProviderCallError(provider, 'unavailable', true, status, requestId, retryAfterMs, error);
  }
  if (
    name === 'APIConnectionError'
    || error instanceof TypeError
    || /network|connection|fetch|socket/i.test(`${name} ${message}`)
    || /^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT|UND_ERR_SOCKET)$/.test(systemCode)
  ) {
    return new ProviderCallError(provider, 'network', true, status, requestId, retryAfterMs, error);
  }
  return new ProviderCallError(provider, 'unknown', false, status, requestId, undefined, error);
}

interface ProviderCallControllerOptions {
  provider: string;
  circuitKey?: string;
  retryPolicy?: Partial<ProviderRetryPolicy>;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface RunOptions {
  signal?: AbortSignal;
  deferSuccess?: boolean;
}

/** Shared retry/backoff/circuit policy for one provider client. SDK retries must stay disabled. */
export class ProviderCallController {
  readonly provider: string;
  readonly retryPolicy: ProviderRetryPolicy;
  private readonly circuitKey: string;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: ProviderCallControllerOptions) {
    this.provider = safeProvider(options.provider);
    this.circuitKey = safeCircuitKey(options.circuitKey ?? this.provider);
    this.retryPolicy = validateRetryPolicy(options.retryPolicy);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? abortableSleep;
  }

  async run<T>(operation: (attempt: number) => Promise<T>, options: RunOptions = {}): Promise<T> {
    if (options.signal?.aborted) throw normalizeProviderError(this.provider, options.signal.reason, options.signal);
    this.enterCircuit();
    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) {
        const aborted = normalizeProviderError(this.provider, options.signal.reason, options.signal);
        this.releaseProbe();
        throw aborted;
      }
      try {
        const result = await operation(attempt);
        if (options.signal?.aborted) {
          const aborted = normalizeProviderError(this.provider, options.signal.reason, options.signal);
          this.releaseProbe();
          throw aborted;
        }
        if (!options.deferSuccess) this.succeed();
        return result;
      } catch (error) {
        if (isResourceLimitError(error)) {
          this.releaseProbe();
          throw error;
        }
        const normalized = normalizeProviderError(this.provider, error, options.signal);
        if (normalized.kind === 'aborted') {
          this.releaseProbe();
          throw normalized;
        }
        if (normalized.retryable && attempt < this.retryPolicy.maxRetries) {
          try {
            await this.sleep(this.retryDelay(attempt, normalized.retryAfterMs), options.signal);
          } catch (sleepError) {
            const aborted = normalizeProviderError(this.provider, sleepError, options.signal);
            this.releaseProbe();
            throw aborted;
          }
          continue;
        }
        this.fail(normalized);
        throw normalized;
      }
    }
  }

  async *monitorStream<T>(source: AsyncIterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
    const iterator = source[Symbol.asyncIterator]();
    let terminal = false;
    try {
      for (;;) {
        if (signal?.aborted) {
          terminal = true;
          const aborted = normalizeProviderError(this.provider, signal.reason, signal);
          this.releaseProbe();
          if (iterator.return) await iterator.return().catch(() => undefined);
          throw aborted;
        }
        let item: IteratorResult<T>;
        try {
          item = await iterator.next();
        } catch (error) {
          terminal = true;
          const normalized = normalizeProviderError(this.provider, error, signal);
          this.fail(normalized);
          throw normalized;
        }
        if (signal?.aborted) {
          terminal = true;
          const aborted = normalizeProviderError(this.provider, signal.reason, signal);
          this.releaseProbe();
          if (iterator.return) await iterator.return().catch(() => undefined);
          throw aborted;
        }
        if (item.done) {
          terminal = true;
          this.succeed();
          return;
        }
        yield item.value;
      }
    } finally {
      if (!terminal) this.releaseProbe();
      if (!terminal && iterator.return) await iterator.return().catch(() => undefined);
    }
  }

  succeed(): void {
    CIRCUITS.delete(this.circuitKey);
  }

  private fail(error: ProviderCallError): void {
    const state = CIRCUITS.get(this.circuitKey);
    if (!error.retryable) {
      CIRCUITS.delete(this.circuitKey);
      return;
    }
    const failures = (state?.failures ?? 0) + 1;
    if (state?.probeActive || failures >= this.retryPolicy.circuitFailureThreshold) {
      CIRCUITS.set(this.circuitKey, { failures, openUntil: this.now() + this.retryPolicy.circuitCooldownMs, probeActive: false, touchedAt: this.now() });
    } else {
      CIRCUITS.set(this.circuitKey, { failures, openUntil: 0, probeActive: false, touchedAt: this.now() });
    }
  }

  private enterCircuit(): void {
    const state = CIRCUITS.get(this.circuitKey);
    if (!state) {
      ensureCircuitCapacity();
      CIRCUITS.set(this.circuitKey, { failures: 0, openUntil: 0, probeActive: false, touchedAt: this.now() });
      return;
    }
    const now = this.now();
    state.touchedAt = now;
    if (state.openUntil > now || state.probeActive) {
      throw new ProviderCallError(this.provider, 'circuit_open', true, undefined, undefined, Math.max(0, state.openUntil - now));
    }
    if (state.openUntil > 0) state.probeActive = true;
  }

  private releaseProbe(): void {
    const state = CIRCUITS.get(this.circuitKey);
    if (!state) return;
    if (state.probeActive) state.probeActive = false;
    if (state.failures === 0 && state.openUntil === 0) CIRCUITS.delete(this.circuitKey);
  }

  private retryDelay(attempt: number, retryAfterMs?: number): number {
    const exponential = Math.min(this.retryPolicy.maxDelayMs, this.retryPolicy.baseDelayMs * (2 ** attempt));
    const requested = Math.min(60_000, retryAfterMs ?? 0);
    const jitter = exponential * this.retryPolicy.jitterRatio * ((this.random() * 2) - 1);
    const policyDelay = Math.max(0, Math.min(this.retryPolicy.maxDelayMs, Math.round(exponential + jitter)));
    return Math.max(requested, policyDelay);
  }
}

function validateRetryPolicy(input: Partial<ProviderRetryPolicy> | undefined): ProviderRetryPolicy {
  const policy = { ...DEFAULT_RETRY_POLICY, ...(input ?? {}) };
  if (!Number.isSafeInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 5) throw new Error('provider maxRetries must be an integer from 0 to 5');
  if (!Number.isSafeInteger(policy.baseDelayMs) || policy.baseDelayMs < 0 || policy.baseDelayMs > 60_000) throw new Error('provider baseDelayMs is invalid');
  if (!Number.isSafeInteger(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs || policy.maxDelayMs > 60_000) throw new Error('provider maxDelayMs is invalid');
  if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) throw new Error('provider jitterRatio is invalid');
  if (!Number.isSafeInteger(policy.circuitFailureThreshold) || policy.circuitFailureThreshold < 1 || policy.circuitFailureThreshold > 20) throw new Error('provider circuitFailureThreshold is invalid');
  if (!Number.isSafeInteger(policy.circuitCooldownMs) || policy.circuitCooldownMs < 1 || policy.circuitCooldownMs > 300_000) throw new Error('provider circuitCooldownMs is invalid');
  return policy;
}

function safeProvider(value: string): string {
  return /^[a-z0-9._-]{1,48}$/i.test(value) ? value : 'unknown';
}

function safeCircuitKey(value: string): string {
  if (value.length <= 256) return value;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.slice(0, 96)}:${(hash >>> 0).toString(16)}`;
}

function ensureCircuitCapacity(): void {
  if (CIRCUITS.size < MAX_CIRCUITS) return;
  let oldestKey: string | undefined;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [key, state] of CIRCUITS) {
    if (state.touchedAt < oldestAt) {
      oldestAt = state.touchedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) CIRCUITS.delete(oldestKey);
}

function safeStatus(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : undefined;
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\w.-]{1,128}$/.test(value) ? value : undefined;
}

function readRetryAfterMs(value: unknown): number | undefined {
  if (!value || typeof (value as { get?: unknown }).get !== 'function') return undefined;
  const headers = value as { get(name: string): string | null };
  const rawMilliseconds = headers.get('retry-after-ms');
  const milliseconds = rawMilliseconds === null ? Number.NaN : Number(rawMilliseconds);
  if (Number.isFinite(milliseconds) && milliseconds >= 0) return Math.min(60_000, Math.ceil(milliseconds));
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.ceil(seconds * 1_000));
  const at = Date.parse(retryAfter);
  return Number.isFinite(at) ? Math.min(60_000, Math.max(0, at - Date.now())) : undefined;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    function done(): void {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
