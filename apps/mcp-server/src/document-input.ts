import { readFileSync, statSync } from 'node:fs';
import { RESOURCE_LIMITS, ResourceLimitError } from '@otterpatch/core';

export function decodeDocumentBase64(value: unknown, maxBytes = RESOURCE_LIMITS.documentBytes): Uint8Array {
  if (typeof value !== 'string' || !value.length) throw new Error('document base64 is required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('invalid document byte limit');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const estimated = Math.max(0, Math.floor((value.length * 3) / 4) - padding);
  if (estimated > maxBytes) throw new ResourceLimitError('document_bytes', maxBytes, estimated);
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('invalid document base64');
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (bytes.byteLength > maxBytes) throw new ResourceLimitError('document_bytes', maxBytes, bytes.byteLength);
  return bytes;
}

export function readDocumentFile(path: string, maxBytes = RESOURCE_LIMITS.documentBytes): Uint8Array {
  const size = statSync(path).size;
  if (size > maxBytes) throw new ResourceLimitError('document_bytes', maxBytes, size);
  return new Uint8Array(readFileSync(path));
}
