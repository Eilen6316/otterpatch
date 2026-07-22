import type { DocRev } from './anchor.js';

const SHA256_RX = /^[a-f0-9]{64}$/;

/**
 * Derive a JSON-safe revision token from a SHA-256 digest. The full digest remains
 * the security identity; this 52-bit prefix is only the numeric DocRev projection.
 */
export function docRevFromSha256(sha256: string): DocRev {
  if (!SHA256_RX.test(sha256)) throw new Error('source file SHA-256 must be 64 lowercase hex characters');
  return Number.parseInt(sha256.slice(0, 13), 16) as DocRev;
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_RX.test(value);
}
