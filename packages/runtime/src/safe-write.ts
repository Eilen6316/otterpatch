/**
 * Atomic file replacement with optional backup — the host-side counterpart of "runtime
 * returns bytes".
 *
 * The runtime deliberately never touches the user's filesystem; the embedding host owns
 * replacement. A partial write (crash, disk full, killed process) must never destroy the
 * user's document, so this helper:
 *  1. copies the previous file aside FIRST (when a backup is requested), so the original is
 *     recoverable even if the write itself fails;
 *  2. writes to a unique temp file in the same directory, fsyncs it, then renames it over
 *     the target — readers see either the old file or the complete new one, never a
 *     half-written mix;
 *  3. cleans up the temp file on any failure.
 *
 * The rename is atomic on POSIX; on Windows Node's rename replaces the target, and the
 * same temp+rename discipline keeps the window as small as the platform allows.
 */
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface SafeWriteOptions {
  /**
   * Back up the previous file before replacing it.
   * `true` → `<path>.bak`; a string → that suffix appended to the path.
   * No backup is created when the target does not exist.
   */
  backup?: boolean | string;
  /** Permission bits for newly created files (default 0o644). */
  mode?: number;
}

export interface SafeWriteResult {
  /** Backup path when one was created. */
  backupPath?: string;
  /** Bytes written. */
  bytes: number;
}

export function writeFileSafely(path: string, bytes: Uint8Array, options: SafeWriteOptions = {}): SafeWriteResult {
  const backupSuffix = typeof options.backup === 'string' ? options.backup : '.bak';
  const wantBackup = options.backup !== undefined && options.backup !== false;

  // 1. Preserve the previous content before anything can go wrong.
  let backupPath: string | undefined;
  if (wantBackup && existsSync(path)) {
    backupPath = `${path}${backupSuffix}`;
    copyFileSync(path, backupPath);
  }

  // 2. Write to a same-directory temp file (rename must not cross filesystems).
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(tmpPath, 'wx', options.mode ?? 0o644);
    let written = 0;
    while (written < bytes.byteLength) {
      written += writeSync(fd, bytes, written, bytes.byteLength - written);
    }
    fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* best effort */
      }
    }
    try {
      unlinkSync(tmpPath);
    } catch {
      /* best effort */
    }
    throw error;
  }
  closeSync(fd);

  // 3. Atomic replace.
  try {
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* best effort */
    }
    throw error;
  }

  return { ...(backupPath ? { backupPath } : {}), bytes: bytes.byteLength };
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const slash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}
