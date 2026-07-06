/**
 * Core OOXML surgical-patch utilities (validated against real .docx files).
 * Treats .docx/.xlsx as a zip: only rewrite the targeted parts, pass all other
 * parts through byte-for-byte unchanged, then repack.
 * Measured: 30/31 parts byte-identical (see experiments/exp1_surgical_test.py).
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';

export type OoxmlParts = Record<string, Uint8Array>;

function assertSafePartPath(path: string): void {
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) throw new Error('unsafe OOXML part path: ' + path);
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) throw new Error('unsafe OOXML part path: ' + path);
}
/** Read all parts of a .docx/.xlsx (zip) as path → bytes. */
export function readOoxmlParts(bytes: Uint8Array): OoxmlParts {
  return unzipSync(bytes);
}

/**
 * Surgical patch: rewrite only the parts listed in `patches`; all other parts
 * pass through byte-for-byte unchanged, then repack.
 * This is the preferred mechanism for high-fidelity writeback — never
 * re-serialize the whole file.
 */
export function repackOoxml(originalBytes: Uint8Array, patches: OoxmlParts): Uint8Array {
  const parts = unzipSync(originalBytes);
  const out: Zippable = {};
  for (const [path, data] of Object.entries(parts)) {
    const patched = patches[path];
    out[path] = patched ?? data; // patched → new content; otherwise → original bytes
  }
  for (const [path, data] of Object.entries(patches)) {
    assertSafePartPath(path);
    if (!(path in parts)) out[path] = data; // newly added parts
  }
  return zipSync(out);
}

export interface PartsIntegrity {
  total: number;
  identical: number;
  /** "~path" = modified / "+path" = added / "-path" = missing */
  changed: string[];
}

/** Compare byte-level part integrity of two OOXML files (post-writeback corruption self-check). */
export function comparePartsIntegrity(before: Uint8Array, after: Uint8Array): PartsIntegrity {
  const a = unzipSync(before);
  const b = unzipSync(after);
  const names = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  let identical = 0;
  const changed: string[] = [];
  for (const n of [...names].sort()) {
    const x = a[n];
    const y = b[n];
    if (!x) changed.push('+' + n);
    else if (!y) changed.push('-' + n);
    else if (bytesEqual(x, y)) identical++;
    else changed.push('~' + n);
  }
  return { total: names.size, identical, changed };
}

function bytesEqual(x: Uint8Array, y: Uint8Array): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}
