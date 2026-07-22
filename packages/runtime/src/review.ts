import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ChangeSet } from '@otterpatch/core';
import { CAPABILITY_MANIFEST_VERSION, assertChangeSet, docRevFromSha256, isSha256 } from '@otterpatch/core';

export const REVIEW_POLICY_VERSION = 'review-v1';
const SHA256_RX = /^[a-f0-9]{64}$/;

export interface ProposalEnvelope {
  version: 1;
  proposalId: string;
  documentId: string;
  format: string;
  changeSetSha256: string;
  sourceFileSha256?: string;
  baseRev: number;
  capabilityManifestVersion: typeof CAPABILITY_MANIFEST_VERSION;
  policyVersion: typeof REVIEW_POLICY_VERSION;
  createdAt: string;
  expiresAt: string;
  signature: string;
}

export interface ReviewReceipt {
  version: 1;
  proposalId: string;
  changeSetSha256: string;
  sourceFileSha256: string;
  acceptedEditIds: string[];
  reviewedAt: string;
  expiresAt: string;
  reviewerSessionId: string;
  nonce: string;
  policyVersion: typeof REVIEW_POLICY_VERSION;
  signature: string;
}

export interface ReviewedProposal {
  proposal: ProposalEnvelope;
  reviewReceipt: ReviewReceipt;
}

type ProposalPayload = Omit<ProposalEnvelope, 'signature'>;
type ReceiptPayload = Omit<ReviewReceipt, 'signature'>;

export class ReviewAuthority {
  private readonly secret: Uint8Array;

  constructor(
    secret: string | Uint8Array = randomBytes(32),
    private readonly ttlMs = 30 * 60 * 1000,
  ) {
    this.secret = typeof secret === 'string' ? new TextEncoder().encode(secret) : new Uint8Array(secret);
    if (this.secret.byteLength < 32) throw new Error('review secret must contain at least 32 bytes');
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('review receipt TTL must be a positive integer');
  }

  createProposal(changeSet: ChangeSet, format: string, documentId?: string, now?: number): ProposalEnvelope;
  createProposal(changeSet: ChangeSet, format: string, documentId: string | undefined, sourceFileSha256: string, now?: number): ProposalEnvelope;
  createProposal(
    changeSet: ChangeSet,
    format: string,
    documentId = changeSet.hostId,
    sourceFileSha256OrNow?: string | number,
    now = Date.now(),
  ): ProposalEnvelope {
    const sourceFileSha256 = typeof sourceFileSha256OrNow === 'string' ? sourceFileSha256OrNow : undefined;
    const createdAt = typeof sourceFileSha256OrNow === 'number' ? sourceFileSha256OrNow : now;
    assertChangeSet(changeSet);
    if (!format.trim()) throw new Error('proposal format is required');
    if (!documentId.trim()) throw new Error('proposal documentId is required');
    if (sourceFileSha256 !== undefined) {
      if (!isSha256(sourceFileSha256)) throw new Error('proposal source file SHA-256 is invalid');
      if (changeSet.baseRev !== docRevFromSha256(sourceFileSha256)) {
        throw new Error('proposal base revision does not match source file SHA-256');
      }
    }
    const payload: ProposalPayload = {
      version: 1,
      proposalId: randomUUID(),
      documentId,
      format,
      changeSetSha256: sha256Canonical(changeSet),
      ...(sourceFileSha256 ? { sourceFileSha256 } : {}),
      baseRev: changeSet.baseRev,
      capabilityManifestVersion: CAPABILITY_MANIFEST_VERSION,
      policyVersion: REVIEW_POLICY_VERSION,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + this.ttlMs).toISOString(),
    };
    return { ...payload, signature: this.sign('proposal', payload) };
  }

  review(
    proposal: ProposalEnvelope,
    changeSet: ChangeSet,
    acceptedEditIds: string[],
    sourceBytes: Uint8Array,
    reviewerSessionId: string,
    now = Date.now(),
  ): ReviewedProposal {
    this.verifyProposal(proposal, changeSet, proposal.format, now, false);
    if (!reviewerSessionId.trim()) throw new Error('reviewerSessionId is required');
    const accepted = normalizeAcceptedEditIds(changeSet, acceptedEditIds);
    const sourceFileSha256 = sha256Bytes(sourceBytes);
    if (proposal.sourceFileSha256 && proposal.sourceFileSha256 !== sourceFileSha256) {
      throw new Error('proposal is already bound to a different source file');
    }
    const { signature: _oldSignature, ...unbound } = proposal;
    const proposalPayload: ProposalPayload = { ...unbound, sourceFileSha256 };
    const boundProposal: ProposalEnvelope = {
      ...proposalPayload,
      signature: this.sign('proposal', proposalPayload),
    };
    const receiptPayload: ReceiptPayload = {
      version: 1,
      proposalId: boundProposal.proposalId,
      changeSetSha256: boundProposal.changeSetSha256,
      sourceFileSha256,
      acceptedEditIds: accepted,
      reviewedAt: new Date(now).toISOString(),
      expiresAt: boundProposal.expiresAt,
      reviewerSessionId,
      nonce: randomUUID(),
      policyVersion: REVIEW_POLICY_VERSION,
    };
    return {
      proposal: boundProposal,
      reviewReceipt: { ...receiptPayload, signature: this.sign('receipt', receiptPayload) },
    };
  }

  verifyForCommit(
    proposal: ProposalEnvelope,
    receipt: ReviewReceipt,
    changeSet: ChangeSet,
    format: string,
    sourceBytes: Uint8Array,
    requestedEditIds?: string[],
    now = Date.now(),
  ): string[] {
    this.verifyProposal(proposal, changeSet, format, now, true);
    const receiptPayload = assertReceipt(receipt);
    if (!this.hasValidSignature('receipt', receiptPayload, receipt.signature)) throw new Error('invalid review receipt signature');
    if (Date.parse(receipt.expiresAt) < now) throw new Error('review receipt expired');
    if (receipt.policyVersion !== REVIEW_POLICY_VERSION) throw new Error('review receipt policy version is stale');
    if (receipt.proposalId !== proposal.proposalId || receipt.changeSetSha256 !== proposal.changeSetSha256) {
      throw new Error('review receipt does not match proposal');
    }
    if (receipt.sourceFileSha256 !== proposal.sourceFileSha256 || receipt.sourceFileSha256 !== sha256Bytes(sourceBytes)) {
      throw new Error('review receipt source file hash mismatch');
    }
    const accepted = normalizeAcceptedEditIds(changeSet, receipt.acceptedEditIds);
    if (requestedEditIds) {
      const requested = normalizeAcceptedEditIds(changeSet, requestedEditIds);
      if (!sameStrings(accepted, requested)) throw new Error('acceptedEditIds do not match review receipt');
    }
    return accepted;
  }

  private verifyProposal(
    proposal: ProposalEnvelope,
    changeSet: ChangeSet,
    format: string,
    now: number,
    requireSourceHash: boolean,
  ): void {
    assertChangeSet(changeSet);
    const payload = assertProposal(proposal);
    if (!this.hasValidSignature('proposal', payload, proposal.signature)) throw new Error('invalid proposal signature');
    if (Date.parse(proposal.expiresAt) < now) throw new Error('proposal expired');
    if (proposal.policyVersion !== REVIEW_POLICY_VERSION) throw new Error('proposal policy version is stale');
    if (proposal.capabilityManifestVersion !== CAPABILITY_MANIFEST_VERSION) throw new Error('proposal capability manifest version is stale');
    if (proposal.format !== format || proposal.baseRev !== changeSet.baseRev) throw new Error('proposal format or revision mismatch');
    if (proposal.changeSetSha256 !== sha256Canonical(changeSet)) throw new Error('proposal ChangeSet hash mismatch');
    if (requireSourceHash && !proposal.sourceFileSha256) throw new Error('proposal is not bound to a source file');
  }

  private sign(domain: 'proposal' | 'receipt', value: ProposalPayload | ReceiptPayload): string {
    return createHmac('sha256', this.secret).update(domain).update('\0').update(stableStringify(value)).digest('hex');
  }

  private hasValidSignature(domain: 'proposal' | 'receipt', value: ProposalPayload | ReceiptPayload, signature: string): boolean {
    if (!SHA256_RX.test(signature)) return false;
    const expected = Buffer.from(this.sign(domain, value), 'hex');
    const actual = Buffer.from(signature, 'hex');
    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  }
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeAcceptedEditIds(changeSet: ChangeSet, ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('acceptedEditIds must not be empty');
  const valid = new Set(changeSet.edits.map((edit) => edit.id));
  const requested = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !valid.has(id)) throw new Error('acceptedEditIds contains unknown edit id: ' + id);
    if (requested.has(id)) throw new Error('acceptedEditIds contains duplicate edit id: ' + id);
    requested.add(id);
  }
  return changeSet.edits.filter((edit) => requested.has(edit.id)).map((edit) => edit.id);
}

function assertProposal(value: ProposalEnvelope): ProposalPayload {
  if (!value || typeof value !== 'object' || value.version !== 1) throw new Error('invalid proposal envelope');
  if (!value.proposalId || !value.documentId || !value.format || !SHA256_RX.test(value.changeSetSha256)) throw new Error('invalid proposal envelope fields');
  if (value.sourceFileSha256 !== undefined && !isSha256(value.sourceFileSha256)) throw new Error('invalid proposal source file hash');
  if (!Number.isSafeInteger(value.baseRev) || value.baseRev < 0) throw new Error('invalid proposal revision');
  if (value.capabilityManifestVersion !== CAPABILITY_MANIFEST_VERSION) throw new Error('invalid proposal capability manifest version');
  if (!isIsoDate(value.createdAt) || !isIsoDate(value.expiresAt)) throw new Error('invalid proposal timestamps');
  const { signature: _signature, ...payload } = value;
  return payload;
}

function assertReceipt(value: ReviewReceipt): ReceiptPayload {
  if (!value || typeof value !== 'object' || value.version !== 1) throw new Error('invalid review receipt');
  if (!value.proposalId || !SHA256_RX.test(value.changeSetSha256) || !SHA256_RX.test(value.sourceFileSha256)) throw new Error('invalid review receipt fields');
  if (!Array.isArray(value.acceptedEditIds) || !value.reviewerSessionId || !value.nonce) throw new Error('invalid review receipt review fields');
  if (!isIsoDate(value.reviewedAt) || !isIsoDate(value.expiresAt)) throw new Error('invalid review receipt timestamps');
  const { signature: _signature, ...payload } = value;
  return payload;
}

function stableStringify(value: unknown, seen = new Set<object>()): string {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('cannot sign non-finite numbers');
  if (value === undefined) throw new Error('cannot sign undefined values');
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('value is not JSON serializable');
    return encoded;
  }
  if (seen.has(value)) throw new Error('cannot sign cyclic values');
  seen.add(value);
  try {
    if (Array.isArray(value)) return '[' + value.map((item) => stableStringify(item, seen)).join(',') + ']';
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return '{' + entries.map((key) => JSON.stringify(key) + ':' + stableStringify(record[key], seen)).join(',') + '}';
  } finally {
    seen.delete(value);
  }
}

function isIsoDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
