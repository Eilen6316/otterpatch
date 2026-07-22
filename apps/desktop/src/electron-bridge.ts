import type { WorkspaceFormat } from './workspace-format.js';

export interface DesktopProposeEnvelope {
  requestId: string;
  kind: 'open' | 'event';
  event?: unknown;
}

export interface DesktopCommitInput {
  format: WorkspaceFormat;
  fileBase64: string;
  changeSet: unknown;
  proposal: unknown;
  acceptedEditIds: string[];
}

export interface DesktopLocalServiceBridge {
  version: string;
  platform: string;
  streamPropose(input: { requestId: string; payload: unknown }): Promise<{ ok: true; eventCount: number }>;
  cancelPropose(requestId: string): void;
  onProposeEvent(listener: (event: DesktopProposeEnvelope) => void): void;
  offProposeEvent(listener: (event: DesktopProposeEnvelope) => void): void;
  commitWriteback(input: DesktopCommitInput): Promise<Record<string, unknown>>;
}

export function desktopLocalServiceBridge(): DesktopLocalServiceBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = (window as unknown as { otterpatch?: Partial<DesktopLocalServiceBridge> }).otterpatch;
  if (!candidate
    || typeof candidate.streamPropose !== 'function'
    || typeof candidate.cancelPropose !== 'function'
    || typeof candidate.onProposeEvent !== 'function'
    || typeof candidate.offProposeEvent !== 'function'
    || typeof candidate.commitWriteback !== 'function') return undefined;
  return candidate as DesktopLocalServiceBridge;
}

/** Browser-only development fallback. Electron returns through the IPC bridge before calling this. */
export function browserLocalCredential(key: 'oa.serveToken' | 'oa.reviewToken'): string {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD) return '';
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
