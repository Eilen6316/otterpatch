import { commitWriteback } from './commit-client.js';
import { sameFileSnapshot, type FileSnapshot } from './file-snapshot.js';
import type { WorkspaceFormat } from './workspace-format.js';

export type WritebackFormat = WorkspaceFormat;

export interface CommitTurn {
  format: WritebackFormat;
  fileSnapshot?: FileSnapshot;
  changeSet?: unknown;
  proposal?: unknown;
}

export interface UseCommitWritebackOptions {
  server: string;
  realChangeSet: unknown;
  fileBase64: string;
  fileName: string;
  fileSnapshot: FileSnapshot | null;
  notify: (message: string) => void;
  t: (key: string) => string;
  setBusy: (busy: boolean) => void;
  normalizeLocalEndpoint: (raw: string) => string | null;
}

export interface UseCommitWritebackResult {
  ensureCommitFile: (turn: CommitTurn) => boolean;
  doCommit: (acceptedEditIds: string[], turn: CommitTurn) => Promise<boolean>;
}

const downloadBase64 = (b64: string, name: string): void => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const outputName = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) + '.otterpatch' + name.slice(dot) : (name || 'out') + '.otterpatch';
};

export function useCommitWriteback({
  server,
  realChangeSet,
  fileBase64,
  fileName,
  fileSnapshot,
  notify,
  t,
  setBusy,
  normalizeLocalEndpoint,
}: UseCommitWritebackOptions): UseCommitWritebackResult {
  const ensureCommitFile = (turn: CommitTurn): boolean => {
    if (!turn.fileSnapshot) {
      notify('Upload the target file, then regenerate this proposal before committing.');
      return false;
    }
    if (!fileSnapshot || !sameFileSnapshot(fileSnapshot, turn.fileSnapshot)) {
      notify('The target file changed. Regenerate the proposal for the current file before committing.');
      return false;
    }
    return true;
  };

  const doCommit = async (acceptedEditIds: string[], turn: CommitTurn): Promise<boolean> => {
    const endpoint = normalizeLocalEndpoint(server);
    if (server.trim() && !endpoint) {
      notify('Agent 服务地址必须是本机地址');
      return false;
    }
    const changeSet = turn.changeSet ?? realChangeSet;
    if (!endpoint || !changeSet) {
      notify(t('请先用 otterpatch-serve 生成提案'));
      return false;
    }
    if (!fileBase64) {
      notify(t('请先上传要写回的文件'));
      return false;
    }
    if (!turn.proposal) {
      notify('This proposal has no signed review envelope. Regenerate it before committing.');
      return false;
    }
    if (!ensureCommitFile(turn)) return false;
    if (!acceptedEditIds.length) {
      notify(t('没有要接受的改动'));
      return false;
    }

    setBusy(true);
    try {
      const data = await commitWriteback({
        endpoint,
        format: turn.format,
        fileBase64,
        changeSet,
        proposal: turn.proposal,
        acceptedEditIds,
      });
      const droppedCount = data.droppedEdits?.length ?? 0;
      if (data.ok === false || droppedCount > 0) {
        notify('Commit partial writeback: applied ' + (data.appliedEditIds?.length ?? 0) + ', dropped ' + droppedCount + ': ' + (data.droppedEdits?.[0]?.reason ?? data.error ?? 'writeback failed'));
        return false;
      }
      if (!data.fileBase64) throw new Error(data.error ?? 'commit failed');
      downloadBase64(data.fileBase64, outputName(fileName));
      notify('Committed ' + (data.touchedParts?.join(', ') ?? '') + ' ' + Math.round((data.fidelity?.score ?? 1) * 100) + '%');
      return true;
    } catch (err) {
      notify('Commit: ' + (err instanceof Error ? err.message : String(err)));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { ensureCommitFile, doCommit };
}
