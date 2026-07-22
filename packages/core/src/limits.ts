const KiB = 1024;
const MiB = 1024 * KiB;

export const RESOURCE_LIMITS = Object.freeze({
  httpBodyBytes: 16 * MiB,
  documentBytes: 32 * MiB,
  zipEntries: 2_000,
  zipCompressedEntryBytes: 16 * MiB,
  zipDecompressedEntryBytes: 64 * MiB,
  zipTotalDecompressedBytes: 256 * MiB,
  zipCompressionRatio: 200,
  xmlNestingDepth: 128,
  changeSetEdits: 500,
  changeSetAnchors: 500,
  rangeCells: 100_000,
  totalTouchedCells: 250_000,
  singleStringBytes: 100 * KiB,
  changeSetJsonBytes: 4 * MiB,
  jsonNestingDepth: 32,
  jsonNodes: 100_000,
  readRangeCells: 10_000,
  toolResultChars: 200_000,
  historyChars: 100_000,
  documentContextChars: 300_000,
  modelOutputChars: 300_000,
  providerTimeoutMs: 90_000,
  providerTimeoutMaxMs: 120_000,
  concurrentModelRequests: 2,
  maxOutputTokens: 16_384,
});

export type ResourceLimitName = keyof typeof RESOURCE_LIMITS | (string & {});

export class ResourceLimitError extends Error {
  readonly code = 'RESOURCE_LIMIT_EXCEEDED';

  constructor(
    readonly resource: ResourceLimitName,
    readonly limit: number,
    readonly actual: number,
    readonly action = 'Split the request into smaller batches.',
  ) {
    super(`resource limit exceeded: ${resource} is ${actual}, maximum is ${limit}`);
    this.name = 'ResourceLimitError';
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, resource: this.resource, limit: this.limit, actual: this.actual, action: this.action };
  }
}

export function isResourceLimitError(error: unknown): error is ResourceLimitError {
  return error instanceof ResourceLimitError
    || (!!error && typeof error === 'object' && (error as { code?: unknown }).code === 'RESOURCE_LIMIT_EXCEEDED');
}

export interface JsonBudget {
  maxBytes: number;
  maxStringBytes: number;
  maxDepth: number;
  maxNodes: number;
}

export function assertJsonBudget(
  value: unknown,
  resource = 'json',
  budget: JsonBudget = {
    maxBytes: RESOURCE_LIMITS.changeSetJsonBytes,
    maxStringBytes: RESOURCE_LIMITS.singleStringBytes,
    maxDepth: RESOURCE_LIMITS.jsonNestingDepth,
    maxNodes: RESOURCE_LIMITS.jsonNodes,
  },
): void {
  const seen = new Set<object>();
  let bytes = 0;
  let nodes = 0;

  const add = (amount: number): void => {
    bytes += amount;
    if (bytes > budget.maxBytes) throw new ResourceLimitError(`${resource}_bytes`, budget.maxBytes, bytes);
  };
  const visitString = (text: string): void => {
    const stringBytes = utf8ByteLength(text);
    if (stringBytes > budget.maxStringBytes) {
      throw new ResourceLimitError('single_string_bytes', budget.maxStringBytes, stringBytes);
    }
    add(jsonStringByteLength(text));
  };
  const visit = (current: unknown, depth: number): void => {
    nodes++;
    if (nodes > budget.maxNodes) throw new ResourceLimitError(`${resource}_nodes`, budget.maxNodes, nodes);
    if (depth > budget.maxDepth) throw new ResourceLimitError(`${resource}_depth`, budget.maxDepth, depth);
    if (typeof current === 'string') {
      visitString(current);
      return;
    }
    if (current === null) { add(4); return; }
    if (typeof current === 'number') { add(Number.isFinite(current) ? String(current).length : 4); return; }
    if (typeof current === 'boolean') { add(current ? 4 : 5); return; }
    if (current === undefined) { add(4); return; }
    if (typeof current !== 'object') { add(8); return; }
    if (seen.has(current)) throw new Error(`invalid ${resource}: cyclic value`);
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        add(2 + Math.max(0, current.length - 1));
        for (const item of current) visit(item, depth + 1);
        return;
      }
      const entries = Object.entries(current as Record<string, unknown>);
      add(2 + Math.max(0, entries.length - 1));
      for (const [key, item] of entries) {
        visitString(key);
        add(1);
        visit(item, depth + 1);
      }
    } finally {
      seen.delete(current);
    }
  };
  visit(value, 0);
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

export function a1RangeCellCount(value: string): number | null {
  const unqualified = (value.slice(value.lastIndexOf('!') + 1)).replace(/\$/g, '').trim();
  const [from, to, extra] = unqualified.split(':');
  if (extra !== undefined) return null;
  const start = parseCell(from ?? '');
  const end = parseCell(to ?? from ?? '');
  if (!start || !end) return null;
  const rows = Math.abs(end.row - start.row) + 1;
  const columns = Math.abs(end.column - start.column) + 1;
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows > Number.MAX_SAFE_INTEGER / columns) return Number.MAX_SAFE_INTEGER;
  return rows * columns;
}

export function assertA1RangeBudget(
  value: string,
  limit: number = RESOURCE_LIMITS.rangeCells,
  resource: ResourceLimitName = 'range_cells',
): number {
  const cells = a1RangeCellCount(value);
  if (cells === null) throw new Error('invalid A1 range: ' + value);
  if (cells > limit) throw new ResourceLimitError(resource, limit, cells);
  return cells;
}

export function assertTextResultBudget(value: string, limit = RESOURCE_LIMITS.toolResultChars): string {
  if (value.length > limit) throw new ResourceLimitError('tool_result_chars', limit, value.length);
  return value;
}

function parseCell(value: string): { column: number; row: number } | null {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(value.trim());
  if (!match) return null;
  let column = 0;
  for (const char of match[1]!.toUpperCase()) {
    column = column * 26 + char.charCodeAt(0) - 64;
    if (!Number.isSafeInteger(column)) return null;
  }
  const row = Number(match[2]);
  return Number.isSafeInteger(row) ? { column, row } : null;
}

function jsonStringByteLength(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (code <= 0x1f) bytes += 6;
    else if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}
