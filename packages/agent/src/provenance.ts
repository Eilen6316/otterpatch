import { isSha256, uuidv7, type AgentProvenance, type AgentSkillVersion } from '@otterpatch/core';
import type { ModelIdentity, ProposeRequest } from './model.js';

export const PROMPT_POLICY_VERSION = 'prompt-policy-v1';
export const AGENT_TRACE: unique symbol = Symbol('otterpatch.agentTrace');

export interface AgentRequestTrace {
  readonly sessionId: string;
  readonly provenance: AgentProvenance;
}

function boundedIdentity(value: string | undefined, fallback: string, label: string): string {
  const result = value?.trim() || fallback;
  if (!result || result.length > 2_048) throw new Error(`${label} must be a non-blank string of at most 2048 characters`);
  return result;
}

function validatedSessionId(req: ProposeRequest): string {
  const sessionId = boundedIdentity(req[AGENT_TRACE]?.sessionId ?? req.sessionId, uuidv7(), 'sessionId');
  if (sessionId.toLowerCase() === 'mock') throw new Error('sessionId "mock" is reserved and cannot be used for agent provenance');
  return sessionId;
}

function validatedSkills(skills: readonly AgentSkillVersion[]): AgentSkillVersion[] {
  const ids = new Set<string>();
  return skills.map((skill) => {
    const id = boundedIdentity(skill.id, '', 'skill id');
    const version = boundedIdentity(skill.version, '', 'skill version');
    if (!/^sha256:[a-f0-9]{64}$/.test(skill.checksum)) throw new Error(`invalid checksum for skill ${id}`);
    if (ids.has(id)) throw new Error(`duplicate skill provenance: ${id}`);
    ids.add(id);
    return { id, version, checksum: skill.checksum };
  });
}

/** Prepare trusted request-side audit fields before a model call. */
export function prepareAgentRequest(
  req: ProposeRequest,
  identity: ModelIdentity,
  skillVersions: readonly AgentSkillVersion[] = req[AGENT_TRACE]?.provenance.skillVersions ?? [],
  repairAttempt = req[AGENT_TRACE]?.provenance.repairAttempt ?? 0,
): ProposeRequest {
  const sessionId = validatedSessionId(req);
  const sourceFileSha256 = req.sourceFileSha256 ?? req[AGENT_TRACE]?.provenance.sourceFileSha256 ?? null;
  if (sourceFileSha256 !== null && !isSha256(sourceFileSha256)) {
    throw new Error('sourceFileSha256 must be 64 lowercase hex characters');
  }
  const parentProposalId = req.parentProposalId ?? req[AGENT_TRACE]?.provenance.parentProposalId ?? null;
  if (parentProposalId !== null) boundedIdentity(parentProposalId, '', 'parentProposalId');
  if (!Number.isSafeInteger(repairAttempt) || repairAttempt < 0) throw new Error('repairAttempt must be a non-negative integer');

  const userId = boundedIdentity(req.userId, req[AGENT_TRACE]?.provenance.actor.userId ?? `local-user:${sessionId}`, 'userId');
  const documentId = boundedIdentity(req.documentId, req[AGENT_TRACE]?.provenance.actor.hostId ?? req.hostId, 'documentId');
  const provider = boundedIdentity(identity.provider, '', 'provider');
  const model = boundedIdentity(identity.model, '', 'model');
  const provenance: AgentProvenance = {
    provider,
    model,
    modelRequestId: uuidv7(),
    skillVersions: validatedSkills(skillVersions),
    promptPolicyVersion: PROMPT_POLICY_VERSION,
    sourceFileSha256,
    parentProposalId,
    repairAttempt,
    actor: { userId, hostId: documentId },
  };
  return { ...req, sessionId, userId, documentId, [AGENT_TRACE]: { sessionId, provenance } };
}

/** Replace local call metadata with the provider's actual response identity. */
export function traceModelResponse(
  req: ProposeRequest,
  identity: ModelIdentity,
  modelRequestId: string,
  repairAttempt = req[AGENT_TRACE]?.provenance.repairAttempt ?? 0,
): ProposeRequest {
  const prepared = req[AGENT_TRACE] ? req : prepareAgentRequest(req, identity, [], repairAttempt);
  const current = prepared[AGENT_TRACE]!;
  const provider = boundedIdentity(identity.provider, '', 'provider');
  const model = boundedIdentity(identity.model, '', 'model');
  const requestId = boundedIdentity(modelRequestId, '', 'modelRequestId');
  if (!Number.isSafeInteger(repairAttempt) || repairAttempt < 0) throw new Error('repairAttempt must be a non-negative integer');
  return {
    ...prepared,
    [AGENT_TRACE]: {
      sessionId: current.sessionId,
      provenance: {
        ...current.provenance,
        provider,
        model,
        modelRequestId: requestId,
        repairAttempt,
      },
    },
  };
}

export function requestRepairAttempt(req: ProposeRequest): number {
  return req[AGENT_TRACE]?.provenance.repairAttempt ?? 0;
}

export function recordAgentSkill(req: ProposeRequest, skill: AgentSkillVersion): void {
  const current = requireAgentTrace(req);
  const existing = current.provenance.skillVersions.find((item) => item.id === skill.id);
  if (existing) {
    if (existing.version !== skill.version || existing.checksum !== skill.checksum) {
      throw new Error(`conflicting skill provenance: ${skill.id}`);
    }
    return;
  }
  req[AGENT_TRACE] = {
    sessionId: current.sessionId,
    provenance: { ...current.provenance, skillVersions: validatedSkills([...current.provenance.skillVersions, skill]) },
  };
}

export function requireAgentTrace(req: ProposeRequest): AgentRequestTrace {
  if (!req[AGENT_TRACE]) throw new Error('agent provenance trace is required before building a ChangeSet');
  return req[AGENT_TRACE];
}
