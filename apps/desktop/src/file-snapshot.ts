import type { WorkspaceFormat } from './workspace-format.js';

export interface FileSnapshot {
  format: WorkspaceFormat;
  name: string;
  byteLength: number;
  hash: string;
  drawioSourceEncoding?: 'uncompressed' | 'compressed';
}

export function makeFileSnapshot(format: WorkspaceFormat, name: string, fileBase64: string, drawioSourceEncoding?: FileSnapshot['drawioSourceEncoding']): FileSnapshot {
  return {
    format,
    name,
    byteLength: decodedBase64Length(fileBase64),
    hash: hashString(fileBase64),
    ...(format === 'drawio' && drawioSourceEncoding ? { drawioSourceEncoding } : {}),
  };
}

export function sameFileSnapshot(a: FileSnapshot | null | undefined, b: FileSnapshot | null | undefined): boolean {
  return !!a && !!b && a.format === b.format && a.name === b.name && a.byteLength === b.byteLength && a.hash === b.hash
    && a.drawioSourceEncoding === b.drawioSourceEncoding;
}

function decodedBase64Length(value: string): number {
  const clean = value.replace(/\s/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function hashString(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${toHex(h1)}${toHex(h2)}`;
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
