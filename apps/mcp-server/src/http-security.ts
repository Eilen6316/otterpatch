import { randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_ALLOWED_ORIGINS = [
  'null', // Packaged Electron renderer (file://).
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
] as const;

const DEFAULT_POSTS_PER_MINUTE = 120;
const DEFAULT_MAX_CONCURRENT_POSTS = 8;
const MAX_TRACKED_CLIENTS = 256;
const TOKEN_MAX_LENGTH = 512;

export interface LocalHttpSecurityConfig {
  authToken: string;
  reviewToken: string;
  authTokenGenerated: boolean;
  reviewTokenGenerated: boolean;
  allowedOrigins: ReadonlySet<string>;
  postsPerMinute: number;
  maxConcurrentPosts: number;
}

export interface LocalHttpSecurityOptions {
  env?: Readonly<Record<string, string | undefined>>;
  generateToken?: () => string;
}

export function createLocalHttpSecurity(options: LocalHttpSecurityOptions = {}): LocalHttpSecurityConfig {
  const env = options.env ?? process.env;
  const generateToken = options.generateToken ?? (() => randomBytes(24).toString('base64url'));
  const auth = readToken(env.OtterPatch_TOKEN, generateToken, 'OtterPatch_TOKEN');
  const review = readToken(env.OtterPatch_REVIEW_TOKEN, generateToken, 'OtterPatch_REVIEW_TOKEN');
  return {
    authToken: auth.value,
    reviewToken: review.value,
    authTokenGenerated: auth.generated,
    reviewTokenGenerated: review.generated,
    allowedOrigins: parseAllowedOrigins(env.OtterPatch_ALLOWED_ORIGINS),
    postsPerMinute: boundedPositiveInteger(env.OtterPatch_POSTS_PER_MINUTE, DEFAULT_POSTS_PER_MINUTE, 10_000),
    maxConcurrentPosts: boundedPositiveInteger(env.OtterPatch_MAX_CONCURRENT_POSTS, DEFAULT_MAX_CONCURRENT_POSTS, 64),
  };
}

export function isAllowedLocalOrigin(origin: string | undefined, allowedOrigins: ReadonlySet<string>): boolean {
  return origin === undefined || allowedOrigins.has(origin);
}

/** Compare local bearer tokens without leaking a useful length-matched timing signal. */
export function matchesLocalToken(candidate: string | string[] | undefined, expected: string): boolean {
  if (typeof candidate !== 'string') return false;
  const actualBytes = Buffer.from(candidate, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function redactSecrets(message: string, secrets: readonly string[]): string {
  let redacted = message;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

export type LocalPostAdmission =
  | { ok: true; release(): void }
  | { ok: false; reason: 'rate_limit' | 'concurrency'; retryAfterSeconds: number };

interface ClientWindow {
  startedAt: number;
  lastSeenAt: number;
  count: number;
}

export class LocalPostGate {
  private readonly clients = new Map<string, ClientWindow>();
  private active = 0;
  private lastSweepAt = 0;

  constructor(
    private readonly options: {
      maxRequests: number;
      windowMs: number;
      maxConcurrent: number;
    },
  ) {
    if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests <= 0) throw new Error('LocalPostGate maxRequests must be a positive integer');
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) throw new Error('LocalPostGate windowMs must be a positive integer');
    if (!Number.isSafeInteger(options.maxConcurrent) || options.maxConcurrent <= 0) throw new Error('LocalPostGate maxConcurrent must be a positive integer');
  }

  enter(clientId: string, now = Date.now()): LocalPostAdmission {
    this.sweep(now);
    const key = clientId.slice(0, 128) || 'local-unknown';
    let window = this.clients.get(key);
    if (!window || now < window.startedAt || now - window.startedAt >= this.options.windowMs) {
      if (!window && this.clients.size >= MAX_TRACKED_CLIENTS) this.dropOldestClient();
      window = { startedAt: now, lastSeenAt: now, count: 0 };
      this.clients.set(key, window);
    }
    window.lastSeenAt = now;
    if (window.count >= this.options.maxRequests) {
      return {
        ok: false,
        reason: 'rate_limit',
        retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + this.options.windowMs - now) / 1_000)),
      };
    }
    window.count += 1;
    if (this.active >= this.options.maxConcurrent) {
      return { ok: false, reason: 'concurrency', retryAfterSeconds: 1 };
    }

    this.active += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
      },
    };
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < this.options.windowMs) return;
    this.lastSweepAt = now;
    for (const [key, window] of this.clients) {
      if (now - window.lastSeenAt >= this.options.windowMs) this.clients.delete(key);
    }
  }

  private dropOldestClient(): void {
    let oldestKey: string | undefined;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [key, window] of this.clients) {
      if (window.lastSeenAt < oldestSeen) {
        oldestKey = key;
        oldestSeen = window.lastSeenAt;
      }
    }
    if (oldestKey !== undefined) this.clients.delete(oldestKey);
  }
}

function readToken(
  configured: string | undefined,
  generateToken: () => string,
  name: string,
): { value: string; generated: boolean } {
  const generated = configured === undefined || configured === '';
  const value = generated ? generateToken() : configured;
  if (!value || value.length > TOKEN_MAX_LENGTH || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error(`${name} must be a non-empty token without whitespace or control characters`);
  }
  return { value, generated };
}

function parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
  const values = raw?.trim()
    ? raw.split(',').map((value) => value.trim()).filter(Boolean)
    : [...DEFAULT_ALLOWED_ORIGINS];
  const origins = new Set<string>();
  for (const value of values) {
    if (value === 'null') {
      origins.add(value);
      continue;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('OtterPatch_ALLOWED_ORIGINS contains an invalid origin');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const isOriginOnly = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
    if (!isLoopback || !isOriginOnly || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      throw new Error('OtterPatch_ALLOWED_ORIGINS must contain exact loopback HTTP(S) origins or null');
    }
    origins.add(url.origin);
  }
  if (!origins.size) throw new Error('OtterPatch_ALLOWED_ORIGINS must not be empty');
  return origins;
}

function boundedPositiveInteger(raw: string | undefined, fallback: number, maximum: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}
