import type { StreamStatus } from './model.js';

const READING_OPERATIONS = ['read_range', 'aggregate', 'read_blocks', 'find_text', 'get_outline', 'get_style_usage', 'load_skill', 'other'] as const;

/** Map internal tool identifiers to a bounded public category without exposing names or arguments. */
export function readingStatus(toolName: string): Extract<StreamStatus, { phase: 'reading' }> {
  if (toolName === 'read_range' || toolName === 'aggregate') {
    return { phase: 'reading', source: 'spreadsheet', operation: toolName };
  }
  if (toolName === 'read_blocks' || toolName === 'find_text' || toolName === 'get_outline' || toolName === 'get_style_usage') {
    return { phase: 'reading', source: 'document', operation: toolName };
  }
  if (toolName === 'load_skill') return { phase: 'reading', source: 'guidance', operation: 'load_skill' };
  return { phase: 'reading', source: 'context', operation: 'other' };
}

/** Rebuild a status at the public boundary so extra runtime fields cannot cross SSE. */
export function sanitizeStreamStatus(value: unknown): StreamStatus | null {
  if (!value || typeof value !== 'object') return null;
  const status = value as Record<string, unknown>;
  if (status.phase === 'generating' || status.phase === 'checking') return { phase: status.phase };
  if (status.phase === 'reading' && READING_OPERATIONS.includes(status.operation as typeof READING_OPERATIONS[number])) {
    const canonical = readingStatus(String(status.operation));
    return status.source === canonical.source ? canonical : null;
  }
  if (status.phase === 'repairing'
    && Number.isSafeInteger(status.attempt) && Number(status.attempt) > 0 && Number(status.attempt) <= 100
    && (status.reason === 'truncated_output' || status.reason === 'check_failed')) {
    return { phase: 'repairing', attempt: Number(status.attempt), reason: status.reason };
  }
  if (status.phase === 'ready' && Number.isSafeInteger(status.editCount) && Number(status.editCount) >= 0 && Number(status.editCount) <= 100_000) {
    return { phase: 'ready', editCount: Number(status.editCount) };
  }
  return null;
}
