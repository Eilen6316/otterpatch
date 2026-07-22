import { docRevFromSha256, type DocRev } from '@otterpatch/core';
import type { WorkspaceFormat } from './workspace-format.js';

export interface FileSnapshot {
  format: WorkspaceFormat;
  name: string;
  byteLength: number;
  sha256: string;
  revision: DocRev;
  drawioSourceEncoding?: 'uncompressed' | 'compressed';
}

export async function makeFileSnapshot(format: WorkspaceFormat, name: string, fileBase64: string, drawioSourceEncoding?: FileSnapshot['drawioSourceEncoding']): Promise<FileSnapshot> {
  const bytes = decodeBase64(fileBase64);
  const sha256 = await sha256Hex(bytes);
  return {
    format,
    name,
    byteLength: bytes.byteLength,
    sha256,
    revision: docRevFromSha256(sha256),
    ...(format === 'drawio' && drawioSourceEncoding ? { drawioSourceEncoding } : {}),
  };
}

export function sameFileSnapshot(a: FileSnapshot | null | undefined, b: FileSnapshot | null | undefined): boolean {
  return !!a && !!b && a.format === b.format && a.name === b.name && a.byteLength === b.byteLength && a.sha256 === b.sha256
    && a.revision === b.revision
    && a.drawioSourceEncoding === b.drawioSourceEncoding;
}

export function fileSnapshotDocumentId(snapshot: FileSnapshot): string {
  return `${snapshot.format}:sha256:${snapshot.sha256}`;
}

export function proposalMatchesFileSnapshot(proposal: unknown, snapshot: FileSnapshot): boolean {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return false;
  const value = proposal as Record<string, unknown>;
  return value.sourceFileSha256 === snapshot.sha256
    && value.baseRev === snapshot.revision
    && value.documentId === fileSnapshotDocumentId(snapshot)
    && value.format === snapshot.format;
}

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input.buffer));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}
