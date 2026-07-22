/**
 * Core OOXML surgical-patch utilities (validated against real .docx files).
 * Treats .docx/.xlsx as a zip: only rewrite the targeted parts, pass all other
 * parts through byte-for-byte unchanged, then repack.
 * Measured: 30/31 parts byte-identical (see experiments/exp1_surgical_test.py).
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { RESOURCE_LIMITS, ResourceLimitError } from '@otterpatch/core';

export type OoxmlParts = Record<string, Uint8Array>;

export interface OoxmlBudget {
  maxArchiveBytes: number;
  maxEntries: number;
  maxCompressedEntryBytes: number;
  maxDecompressedEntryBytes: number;
  maxTotalDecompressedBytes: number;
  maxCompressionRatio: number;
  maxXmlNestingDepth: number;
}

export const DEFAULT_OOXML_BUDGET: Readonly<OoxmlBudget> = Object.freeze({
  maxArchiveBytes: RESOURCE_LIMITS.documentBytes,
  maxEntries: RESOURCE_LIMITS.zipEntries,
  maxCompressedEntryBytes: RESOURCE_LIMITS.zipCompressedEntryBytes,
  maxDecompressedEntryBytes: RESOURCE_LIMITS.zipDecompressedEntryBytes,
  maxTotalDecompressedBytes: RESOURCE_LIMITS.zipTotalDecompressedBytes,
  maxCompressionRatio: RESOURCE_LIMITS.zipCompressionRatio,
  maxXmlNestingDepth: RESOURCE_LIMITS.xmlNestingDepth,
});

function assertSafePartPath(path: string): void {
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) throw new Error('unsafe OOXML part path: ' + path);
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) throw new Error('unsafe OOXML part path: ' + path);
}
/** Read all parts of a .docx/.xlsx (zip) as path → bytes. */
export function readOoxmlParts(bytes: Uint8Array, overrides: Partial<OoxmlBudget> = {}): OoxmlParts {
  const budget = budgetWith(overrides);
  if (bytes.byteLength > budget.maxArchiveBytes) {
    throw new ResourceLimitError('document_bytes', budget.maxArchiveBytes, bytes.byteLength);
  }
  let entries = 0;
  let totalDecompressed = 0;
  const names = new Set<string>();
  const parts = unzipSync(bytes, {
    filter: (entry) => {
      entries++;
      if (entries > budget.maxEntries) throw new ResourceLimitError('zip_entries', budget.maxEntries, entries);
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0) {
        throw new Error(`invalid ZIP entry sizes: ${entry.name}`);
      }
      if (entry.size > budget.maxCompressedEntryBytes) {
        throw new ResourceLimitError('zip_compressed_entry_bytes', budget.maxCompressedEntryBytes, entry.size);
      }
      if (entry.originalSize > budget.maxDecompressedEntryBytes) {
        throw new ResourceLimitError('zip_decompressed_entry_bytes', budget.maxDecompressedEntryBytes, entry.originalSize);
      }
      totalDecompressed += entry.originalSize;
      if (totalDecompressed > budget.maxTotalDecompressedBytes) {
        throw new ResourceLimitError('zip_total_decompressed_bytes', budget.maxTotalDecompressedBytes, totalDecompressed);
      }
      const ratio = entry.originalSize === 0 ? 0 : entry.originalSize / Math.max(1, entry.size);
      if (ratio > budget.maxCompressionRatio) {
        throw new ResourceLimitError('zip_compression_ratio', budget.maxCompressionRatio, Math.ceil(ratio));
      }
      if (entry.name.endsWith('/')) return false;
      assertSafePartPath(entry.name);
      if (names.has(entry.name)) throw new Error('duplicate OOXML part path: ' + entry.name);
      names.add(entry.name);
      return true;
    },
  });
  assertPartsBudget(parts, budget);
  return parts;
}

/**
 * Surgical patch: rewrite only the parts listed in `patches`; all other parts
 * pass through byte-for-byte unchanged, then repack.
 * This is the preferred mechanism for high-fidelity writeback — never
 * re-serialize the whole file.
 */
export function repackOoxml(originalBytes: Uint8Array, patches: OoxmlParts, overrides: Partial<OoxmlBudget> = {}): Uint8Array {
  const budget = budgetWith(overrides);
  const parts = readOoxmlParts(originalBytes, budget);
  const out: Zippable = {};
  for (const [path, data] of Object.entries(parts)) {
    const patched = patches[path];
    out[path] = patched ?? data; // patched → new content; otherwise → original bytes
  }
  for (const [path, data] of Object.entries(patches)) {
    assertSafePartPath(path);
    if (!(path in parts)) out[path] = data; // newly added parts
  }
  assertPartsBudget(out as OoxmlParts, budget);
  const zipped = zipSync(out);
  if (zipped.byteLength > budget.maxArchiveBytes) {
    throw new ResourceLimitError('document_bytes', budget.maxArchiveBytes, zipped.byteLength);
  }
  return zipped;
}

export interface PartsIntegrity {
  total: number;
  identical: number;
  /** "~path" = modified / "+path" = added / "-path" = missing */
  changed: string[];
}

/** Compare byte-level part integrity of two OOXML files (post-writeback corruption self-check). */
export function comparePartsIntegrity(before: Uint8Array, after: Uint8Array): PartsIntegrity {
  const a = readOoxmlParts(before);
  const b = readOoxmlParts(after);
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

function budgetWith(overrides: Partial<OoxmlBudget>): OoxmlBudget {
  const budget = { ...DEFAULT_OOXML_BUDGET, ...overrides };
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid OOXML budget ${name}`);
  }
  return budget;
}

function assertPartsBudget(parts: OoxmlParts, budget: OoxmlBudget): void {
  const entries = Object.entries(parts);
  if (entries.length > budget.maxEntries) throw new ResourceLimitError('zip_entries', budget.maxEntries, entries.length);
  let total = 0;
  for (const [path, data] of entries) {
    assertSafePartPath(path);
    if (!(data instanceof Uint8Array)) throw new Error('invalid OOXML part bytes: ' + path);
    if (data.byteLength > budget.maxDecompressedEntryBytes) {
      throw new ResourceLimitError('zip_decompressed_entry_bytes', budget.maxDecompressedEntryBytes, data.byteLength);
    }
    total += data.byteLength;
    if (total > budget.maxTotalDecompressedBytes) {
      throw new ResourceLimitError('zip_total_decompressed_bytes', budget.maxTotalDecompressedBytes, total);
    }
    if (isXmlPart(path)) assertXmlNestingDepth(data, budget.maxXmlNestingDepth, path);
  }
}

function isXmlPart(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.xml') || lower.endsWith('.rels') || lower === '[content_types].xml';
}

function assertXmlNestingDepth(bytes: Uint8Array, maxDepth: number, path: string): void {
  let depth = 0;
  let index = 0;
  while (index < bytes.length) {
    if (bytes[index] !== 0x3c) { index++; continue; }
    if (matches(bytes, index, '<!--')) {
      index = findSequence(bytes, index + 4, '-->', path);
      continue;
    }
    if (matches(bytes, index, '<![CDATA[')) {
      index = findSequence(bytes, index + 9, ']]>', path);
      continue;
    }
    if (matches(bytes, index, '<?')) {
      index = findSequence(bytes, index + 2, '?>', path);
      continue;
    }
    if (matches(bytes, index, '<!')) throw new Error(`unsupported XML declaration in ${path}`);

    const closing = bytes[index + 1] === 0x2f;
    let cursor = index + (closing ? 2 : 1);
    let quote = 0;
    for (; cursor < bytes.length; cursor++) {
      const byte = bytes[cursor]!;
      if (quote) {
        if (byte === quote) quote = 0;
      } else if (byte === 0x22 || byte === 0x27) quote = byte;
      else if (byte === 0x3e) break;
    }
    if (cursor >= bytes.length) throw new Error(`unterminated XML tag in ${path}`);
    if (closing) {
      depth--;
      if (depth < 0) throw new Error(`unbalanced XML closing tag in ${path}`);
    } else {
      let tail = cursor - 1;
      while (tail > index && (bytes[tail] === 0x20 || bytes[tail] === 0x09 || bytes[tail] === 0x0a || bytes[tail] === 0x0d)) tail--;
      if (bytes[tail] !== 0x2f) {
        depth++;
        if (depth > maxDepth) throw new ResourceLimitError('xml_nesting_depth', maxDepth, depth);
      }
    }
    index = cursor + 1;
  }
  if (depth !== 0) throw new Error(`unbalanced XML nesting in ${path}`);
}

function matches(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function findSequence(bytes: Uint8Array, from: number, text: string, path: string): number {
  for (let index = from; index <= bytes.length - text.length; index++) {
    if (matches(bytes, index, text)) return index + text.length;
  }
  throw new Error(`unterminated XML section in ${path}`);
}

function bytesEqual(x: Uint8Array, y: Uint8Array): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}
