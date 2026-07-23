import type { WorkspaceFormat } from './workspace-format.js';
import { browserLocalCredential, desktopLocalServiceBridge } from './electron-bridge.js';

export interface CommitWritebackResult {
  ok?: boolean;
  fileBase64?: string;
  touchedParts?: string[];
  fidelity?: { score: number };
  appliedEditIds?: string[];
  droppedEdits?: Array<{ editId: string; reason: string }>;
  error?: string;
}

interface ReviewResult {
  proposal?: unknown;
  reviewReceipt?: unknown;
  error?: string;
}

export async function commitWriteback(input: {
  endpoint: string;
  format: WorkspaceFormat;
  fileBase64: string;
  changeSet: unknown;
  proposal: unknown;
  acceptedEditIds: string[];
}): Promise<CommitWritebackResult> {
  const bridge = desktopLocalServiceBridge();
  if (bridge) {
    return await bridge.commitWriteback({
      format: input.format,
      fileBase64: input.fileBase64,
      changeSet: input.changeSet,
      proposal: input.proposal,
      acceptedEditIds: input.acceptedEditIds,
    }) as CommitWritebackResult;
  }

  const token = browserLocalCredential('oa.serveToken');
  const reviewToken = browserLocalCredential('oa.reviewToken');
  if (!token || !reviewToken) throw new Error('local service credentials are not configured');
  const headers = { 'Content-Type': 'application/json', 'X-OtterPatch-Token': token };
  const reviewHeaders = { ...headers, 'X-OtterPatch-Review-Token': reviewToken };
  const reviewResponse = await fetch(input.endpoint + '/review', {
    method: 'POST',
    headers: reviewHeaders,
    body: JSON.stringify({
      fileBase64: input.fileBase64,
      changeSet: input.changeSet,
      proposal: input.proposal,
      acceptedEditIds: input.acceptedEditIds,
      reviewerSessionId: 'desktop:' + crypto.randomUUID(),
    }),
  });
  const reviewed = (await reviewResponse.json()) as ReviewResult;
  if (!reviewResponse.ok || !reviewed.proposal || !reviewed.reviewReceipt) {
    throw new Error(reviewed.error ?? 'review receipt issuance failed');
  }
  const response = await fetch(input.endpoint + '/commit', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      format: input.format,
      fileBase64: input.fileBase64,
      changeSet: input.changeSet,
      proposal: reviewed.proposal,
      reviewReceipt: reviewed.reviewReceipt,
    }),
  });
  const data = (await response.json()) as CommitWritebackResult;
  if (!response.ok) throw new Error(data.error ?? 'commit failed');
  return data;
}
