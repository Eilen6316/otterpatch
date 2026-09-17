/**
 * writeFileSafely — atomic replacement (temp + fsync + rename) with a pre-write backup,
 * so a crash mid-write never destroys the previous document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSafely } from './safe-write.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'otterpatch-safe-write-'));
  return join(dir, 'book.xlsx');
}

test('writeFileSafely: writes a new file exactly (binary-safe)', () => {
  const path = tempFile();
  try {
    const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe]);
    const result = writeFileSafely(path, payload);
    assert.equal(result.bytes, 7);
    assert.equal(result.backupPath, undefined, 'no backup for a new file');
    assert.deepEqual(new Uint8Array(readFileSync(path)), payload);
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('writeFileSafely: backs up the previous content before replacing it', () => {
  const path = tempFile();
  try {
    writeFileSync(path, 'original');
    const result = writeFileSafely(path, enc('updated'), { backup: true });
    assert.equal(readFileSync(path, 'utf8'), 'updated');
    assert.equal(result.backupPath, `${path}.bak`);
    assert.equal(readFileSync(`${path}.bak`, 'utf8'), 'original');
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('writeFileSafely: custom backup suffix', () => {
  const path = tempFile();
  try {
    writeFileSync(path, 'v1');
    const result = writeFileSafely(path, enc('v2'), { backup: '.orig' });
    assert.equal(result.backupPath, `${path}.orig`);
    assert.equal(readFileSync(`${path}.orig`, 'utf8'), 'v1');
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('writeFileSafely: no backup when disabled or not requested', () => {
  const path = tempFile();
  try {
    writeFileSync(path, 'v1');
    writeFileSafely(path, enc('v2'));
    writeFileSafely(path, enc('v3'), { backup: false });
    assert.equal(readFileSync(path, 'utf8'), 'v3');
    assert.equal(existsSync(`${path}.bak`), false);
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('writeFileSafely: overwriting replaces content and refreshes the backup', () => {
  const path = tempFile();
  try {
    writeFileSync(path, 'v1');
    writeFileSafely(path, enc('v2'), { backup: true });
    writeFileSafely(path, enc('v3'), { backup: true });
    assert.equal(readFileSync(path, 'utf8'), 'v3');
    assert.equal(readFileSync(`${path}.bak`, 'utf8'), 'v2', 'backup holds the immediately previous version');
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('writeFileSafely: leaves no temp files behind', () => {
  const path = tempFile();
  try {
    writeFileSafely(path, new Uint8Array(1024 * 512), { backup: true });
    writeFileSafely(path, new Uint8Array(1024 * 512), { backup: true });
    const leftovers = readdirSync(join(path, '..')).filter((name) => name.includes('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});

test('writeFileSafely: a large buffer is written in full (partial-write loop)', () => {
  const path = tempFile();
  try {
    const payload = new Uint8Array(3 * 1024 * 1024);
    for (let i = 0; i < payload.byteLength; i++) payload[i] = i % 251;
    const result = writeFileSafely(path, payload);
    assert.equal(result.bytes, payload.byteLength);
    assert.deepEqual(new Uint8Array(readFileSync(path)), payload);
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true });
  }
});
