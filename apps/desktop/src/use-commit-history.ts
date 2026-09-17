/**
 * useCommitHistory — reads the durable commit audit ledger through the Electron bridge.
 *
 * The ledger is written by the local service (OtterPatch_AUDIT_DIR); the renderer only
 * ever reads it through a narrow, schema-validated IPC channel. Browser development has
 * no bridge and no ledger, so the hook degrades to an empty history — the UI shows the
 * panel only when records exist or the bridge is present.
 */
import { useCallback, useEffect, useState } from 'react';
import { desktopLocalServiceBridge, type DesktopAuditRecord } from './electron-bridge.js';

export interface UseCommitHistoryResult {
  records: DesktopAuditRecord[];
  /** Newest first, for display. */
  ordered: DesktopAuditRecord[];
  refresh: () => Promise<void>;
  available: boolean;
}

export function useCommitHistory(documentId?: string): UseCommitHistoryResult {
  const [records, setRecords] = useState<DesktopAuditRecord[]>([]);
  const [available, setAvailable] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const bridge = desktopLocalServiceBridge();
    if (!bridge || typeof bridge.readAuditHistory !== 'function') {
      setAvailable(false);
      setRecords([]);
      return;
    }
    setAvailable(true);
    try {
      const next = await bridge.readAuditHistory(documentId ? { documentId } : {});
      setRecords(Array.isArray(next) ? next : []);
    } catch {
      // A ledger read failure is never user-facing fatal: keep the last known history.
    }
  }, [documentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ordered = [...records].sort((left, right) => right.ts.localeCompare(left.ts));
  return { records, ordered, refresh, available };
}
