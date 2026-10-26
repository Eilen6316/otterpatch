/** IPC-barrier worker: each fork has independent JS memory and SQLite connections. */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { FileReviewAuthorityStore } from './review-store.js';
import { OtterPatchRuntime } from './runtime.js';
import type { CommitInput } from './runtime.js';

const [directory, action, key] = process.argv.slice(2) as [string, string, string];
let store: FileReviewAuthorityStore | undefined;
try {
  if (!action.startsWith('init')) store = new FileReviewAuthorityStore(directory);
  process.send!({ kind: 'ready' });
  process.once('message', async (input: { commit?: CommitInput; phase?: string }) => {
    try {
      process.send!({ kind: 'attempting' });
      if (action === 'init-crash') {
        const rename = fs.renameSync;
        fs.renameSync = ((from, to) => {
          if (String(to).endsWith('authority-v2')) {
            if (input.phase === 'published') rename(from, to);
            process.send!({ kind: 'phase', phase: input.phase });
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
          }
          return rename(from, to);
        }) as typeof fs.renameSync;
        syncBuiltinESMExports();
      }
      store ??= new FileReviewAuthorityStore(directory);
      let result: unknown;
      if (action === 'init') result = createHash('sha256').update(store.secret).digest('hex');
      else if (action === 'nonce') result = store.consumeNonce(key, Date.now() + 600_000);
      else if (action === 'source') result = store.isCommittedSource(key);
      else if (action === 'commit') {
        const runtime = new OtterPatchRuntime({ reviewStore: store });
        const commit = input.commit!;
        commit.bytes = new Uint8Array(Object.values(commit.bytes));
        result = (await runtime.commit(commit)).ok;
      } else if (action === 'reserve') {
        result = store.beginCommit(key, `nonce-${key}`, Date.now() + 600_000);
        if (result !== undefined) throw new Error('reservation unexpectedly rejected');
        process.send!({ kind: 'phase', phase: 'reserved' });
        return; // IPC keeps the worker alive until parent kills it.
      } else if (action === 'transaction') {
        const db = new DatabaseSync(join(directory, 'authority-v2', 'review-state.sqlite'));
        db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
        if (input.phase !== 'locked') db.prepare('INSERT INTO nonces VALUES (?, ?)').run(key, Date.now() + 600_000);
        if (input.phase === 'committed') db.exec('COMMIT');
        process.send!({ kind: 'phase', phase: input.phase });
        return;
      }
      process.send!({ kind: 'result', result }, () => process.disconnect());
    } catch (error) {
      process.send!({ kind: 'result', error: error instanceof Error ? error.message : String(error) }, () => process.disconnect());
    }
  });
} catch (error) {
  process.send!({ kind: 'result', error: error instanceof Error ? error.message : String(error) }, () => process.disconnect());
}
