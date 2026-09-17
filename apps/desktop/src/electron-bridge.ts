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

/** One durable commit record from the audit ledger (mirrors packages/runtime audit.ts). */
export interface DesktopAuditRecord {
  ts: string;
  documentId: string;
  format: string;
  proposalId?: string;
  reviewerSessionId?: string;
  reviewKind: 'receipt' | 'unreviewed';
  changeSetId: string;
  changeSetSha256?: string;
  intent: string;
  editCount: number;
  acceptedEditIds: string[];
  sourceSha256: string;
  outputSha256?: string;
  backendId: string;
  ok: boolean;
  touchedParts: string[];
  fidelity: number;
  verification: {
    packageValid: boolean;
    verifiedEdits: string[];
    unverifiableEdits: string[];
    failedEdits: Array<{ editId: string; reason: string }>;
  };
  droppedEdits?: Array<{ editId: string; reason: string }>;
}

export interface DesktopLocalServiceBridge {
  version: string;
  platform: string;
  streamPropose(input: { requestId: string; payload: unknown }): Promise<{ ok: true; eventCount: number }>;
  cancelPropose(requestId: string): void;
  onProposeEvent(listener: (event: DesktopProposeEnvelope) => void): void;
  offProposeEvent(listener: (event: DesktopProposeEnvelope) => void): void;
  commitWriteback(input: DesktopCommitInput): Promise<Record<string, unknown>>;
  /** Read-only commit history; empty when no audit ledger directory is configured. */
  readAuditHistory(input?: { documentId?: string }): Promise<DesktopAuditRecord[]>;
  /** 示范即技能:把一次已提交的演示蒸馏成外部技能(经本机服务落盘)。 */
  saveSkill(input: DesktopSaveSkillInput): Promise<{ ok: true; skillId: string; name: string; path: string } | { ok: false }>;
}

export interface DesktopSaveSkillInput {
  intent: string;
  format: string;
  changeSet: unknown;
  name?: string;
}

export type BrowserLocalCredentialKey = 'oa.serveToken' | 'oa.reviewToken';

export function desktopLocalServiceBridge(): DesktopLocalServiceBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = (window as unknown as { otterpatch?: Partial<DesktopLocalServiceBridge> }).otterpatch;
  if (!candidate
    || typeof candidate.streamPropose !== 'function'
    || typeof candidate.cancelPropose !== 'function'
    || typeof candidate.onProposeEvent !== 'function'
    || typeof candidate.offProposeEvent !== 'function'
    || typeof candidate.commitWriteback !== 'function'
    || typeof candidate.readAuditHistory !== 'function'
    || typeof candidate.saveSkill !== 'function') return undefined;
  return candidate as DesktopLocalServiceBridge;
}

/** Local credentials are a Vite-development fallback; packaged renderers use narrow IPC instead. */
export function browserLocalCredentialsAvailable(): boolean {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD || desktopLocalServiceBridge()) return false;
  return typeof localStorage !== 'undefined';
}

export function browserLocalCredential(key: BrowserLocalCredentialKey): string {
  if (!browserLocalCredentialsAvailable()) return '';
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function setBrowserLocalCredential(key: BrowserLocalCredentialKey, value: string): void {
  if (!browserLocalCredentialsAvailable()) return;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Browser storage can be disabled; requests will surface the missing credential.
  }
}
