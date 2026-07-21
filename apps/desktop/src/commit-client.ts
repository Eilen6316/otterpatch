import type { WorkspaceFormat } from './workspace-format.js';

export interface CommitWritebackResult {
  ok?: boolean;
  fileBase64?: string;
  touchedParts?: string[];
  fidelity?: { score: number };
  appliedEditIds?: string[];
  droppedEdits?: Array<{ editId: string; reason: string }>;
  error?: string;
}

export async function commitWriteback(input: {
  endpoint: string;
  token?: string;
  format: WorkspaceFormat;
  fileBase64: string;
  changeSet: unknown;
  acceptedEditIds: string[];
}): Promise<CommitWritebackResult> {
  const response = await fetch(input.endpoint + '/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(input.token ? { 'X-OtterPatch-Token': input.token } : {}) },
    body: JSON.stringify({
      format: input.format,
      fileBase64: input.fileBase64,
      changeSet: input.changeSet,
      acceptedEditIds: input.acceptedEditIds,
      currentRev: (input.changeSet as { baseRev?: number } | null)?.baseRev ?? 0,
    }),
  });
  const data = (await response.json()) as CommitWritebackResult;
  if (!response.ok) throw new Error(data.error ?? 'commit failed');
  return data;
}
