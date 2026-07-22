#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChangeSet, DocRev } from '@otterpatch/core';
import { RESOURCE_LIMITS, ResourceLimitError, assertChangeSet, docRevFromSha256, isResourceLimitError, isSha256 } from '@otterpatch/core';
import { ProviderCallError, createModelClient, sanitizeStreamStatus, type AgentResponse, type ProposeRequest, type Provider } from '@otterpatch/agent';
import { BUILTIN_SKILLS } from '@otterpatch/skills';
import { OtterPatchRuntime, sha256Bytes, type DiffInput, type ProposalEnvelope, type ReviewReceipt } from '@otterpatch/runtime';
import { decodeDocumentBase64 } from './document-input.js';
import { observeClientAbort } from './client-abort.js';
import {
  LocalPostGate,
  createLocalHttpSecurity,
  isAllowedLocalOrigin,
  matchesLocalToken,
  redactSecrets,
} from './http-security.js';

const rt = new OtterPatchRuntime();
type SheetInput = NonNullable<ProposeRequest['sheet']>;
type BoardInput = NonNullable<ProposeRequest['board']>;
type DocInput = NonNullable<ProposeRequest['doc']>;
type PptInput = NonNullable<ProposeRequest['ppt']>;
const PORT = Number(process.env.OtterPatch_PORT ?? 4319);
const HOST = '127.0.0.1';
const DEFAULT_MAX_BODY_BYTES = RESOURCE_LIMITS.httpBodyBytes;
const parsedMaxBodyBytes = Number(process.env.OtterPatch_MAX_BODY_BYTES ?? DEFAULT_MAX_BODY_BYTES);
const MAX_BODY_BYTES = Number.isSafeInteger(parsedMaxBodyBytes) && parsedMaxBodyBytes > 0
  ? Math.min(parsedMaxBodyBytes, DEFAULT_MAX_BODY_BYTES)
  : DEFAULT_MAX_BODY_BYTES;
const security = createLocalHttpSecurity();
const AUTH_TOKEN = security.authToken;
const REVIEW_TOKEN = security.reviewToken;
const postGate = new LocalPostGate({
  maxRequests: security.postsPerMinute,
  windowMs: 60_000,
  maxConcurrent: security.maxConcurrentPosts,
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isAllowedOrigin(origin: string | undefined): boolean {
  return isAllowedLocalOrigin(origin, security.allowedOrigins);
}

function cors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (Array.isArray(origin) || !isAllowedOrigin(origin)) return false;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OtterPatch-Token, X-OtterPatch-Review-Token');
  return true;
}



function readDocRev(value: unknown, fallback: number): DocRev {
  const candidate = value ?? fallback;
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0) {
    throw new HttpError(400, 'baseRev/currentRev must be a non-negative safe integer');
  }
  return candidate as DocRev;
}

function proposalBinding(body: Record<string, unknown>): { baseRev: DocRev; sourceFileSha256?: string } {
  const sourceFileSha256 = body.sourceFileSha256;
  if (sourceFileSha256 !== undefined && !isSha256(sourceFileSha256)) {
    throw new HttpError(400, 'sourceFileSha256 must be 64 lowercase hex characters');
  }
  const derived = sourceFileSha256 ? docRevFromSha256(sourceFileSha256) : 0 as DocRev;
  const baseRev = readDocRev(body.baseRev, derived);
  if (sourceFileSha256 && baseRev !== derived) {
    throw new HttpError(409, 'baseRev does not match sourceFileSha256');
  }
  return { baseRev, ...(sourceFileSha256 ? { sourceFileSha256 } : {}) };
}

function proposalDocumentId(body: Record<string, unknown>, binding: ReturnType<typeof proposalBinding>, fallback: string): string {
  return binding.sourceFileSha256
    ? `${String(body.format).toLowerCase()}:sha256:${binding.sourceFileSha256}`
    : String(body.documentId ?? fallback);
}

function hasValidToken(req: IncomingMessage): boolean {
  return matchesLocalToken(req.headers['x-otterpatch-token'], AUTH_TOKEN);
}

function hasValidReviewToken(req: IncomingMessage): boolean {
  return matchesLocalToken(req.headers['x-otterpatch-review-token'], REVIEW_TOKEN);
}

function send(req: IncomingMessage, res: ServerResponse, code: number, data: unknown): void {
  cors(req, res);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = code;
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      reject(new ResourceLimitError('http_body_bytes', MAX_BODY_BYTES, len));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (c: Buffer | string) => {
      if (failed) return;
      const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        req.pause();
        reject(new ResourceLimitError('http_body_bytes', MAX_BODY_BYTES, size));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    req.on('error', reject);
  });
}

const emsg = (e: unknown): string => redactSecrets(
  e instanceof Error ? e.message : String(e),
  [AUTH_TOKEN, REVIEW_TOKEN],
);

function diffInput(body: Record<string, unknown>): DiffInput {
  return {
    format: String(body.format),
    ...(body.sheet ? { sheet: body.sheet as SheetInput } : {}),
    ...(body.board ? { board: body.board as BoardInput } : {}),
    ...(body.doc ? { doc: body.doc as DocInput } : {}),
    ...(body.ppt ? { ppt: body.ppt as PptInput } : {}),
  };
}

function providerHttpStatus(error: ProviderCallError): number {
  if (error.kind === 'authentication') return 401;
  if (error.kind === 'permission') return 403;
  if (error.kind === 'invalid_request') return 400;
  if (error.kind === 'rate_limit') return 429;
  if (error.kind === 'timeout') return 504;
  if (error.kind === 'aborted') return 408;
  return 503;
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    let releasePost: (() => void) | undefined;
    try {
      if (!cors(req, res)) {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'origin not allowed' }));
        return;
      }
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      const url = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && url === '/health') {
        send(req, res, 200, { ok: true, formats: rt.formats(), capabilities: rt.capabilities(), skills: BUILTIN_SKILLS.map((s) => s.name) });
        return;
      }
      if (req.method === 'POST') {
        const admission = postGate.enter(req.socket.remoteAddress ?? 'local-unknown');
        if (!admission.ok) {
          res.setHeader('Retry-After', String(admission.retryAfterSeconds));
          send(req, res, 429, {
            code: admission.reason === 'rate_limit' ? 'HTTP_RATE_LIMIT' : 'HTTP_CONCURRENCY_LIMIT',
            error: admission.reason === 'rate_limit' ? 'too many local requests' : 'local request concurrency limit reached',
          });
          return;
        }
        releasePost = admission.release;
        if (!hasValidToken(req)) {
          send(req, res, 401, { error: 'missing or invalid local token' });
          return;
        }
      }
      if (req.method === 'POST' && url === '/propose') {
        const a = await readBody(req);
        const binding = proposalBinding(a);
        const model = createModelClient((a.provider as Provider) || 'claude', {
          apiKey: a.apiKey as string | undefined,
          ...(a.model ? { model: a.model as string } : {}),
        });
        const client = observeClientAbort(req, res);
        let r: AgentResponse;
        try {
          r = await rt.respond(
            {
              hostId: 'serve',
              format: String(a.format),
              intent: String(a.intent ?? ''),
              baseRev: binding.baseRev,
              anchors: [],
              context: String(a.context ?? ''),
              ...(a.sheet ? { sheet: a.sheet as SheetInput } : {}),
              ...(a.board ? { board: a.board as BoardInput } : {}),
              ...(a.doc ? { doc: a.doc as { blocks: Array<{ style: string; text: string; font?: string; size?: number; align?: string; lineSpacing?: number }> } } : {}),
              ...(a.ppt ? { ppt: a.ppt as PptInput } : {}),
              ...(Array.isArray(a.history) ? { history: a.history as Array<{ role: 'user' | 'assistant'; content: string }> } : {}),
            },
            model,
            { signal: client.signal },
          );
        } finally {
          client.dispose();
        }
        if (r.kind === 'answer') send(req, res, 200, { answer: r.text });
        else if (r.kind === 'clarify') send(req, res, 200, { questions: r.questions });
        else send(req, res, 200, {
          changeSet: r.changeSet,
          diff: await rt.diff(r.changeSet, diffInput(a)),
          proposal: rt.createProposal(r.changeSet, String(a.format), proposalDocumentId(a, binding, r.changeSet.hostId), binding.sourceFileSha256),
        });
        return;
      }
      if (req.method === 'POST' && url === '/propose-stream') {
        const a = await readBody(req);
        const binding = proposalBinding(a);
        const model = createModelClient((a.provider as Provider) || 'claude', {
          apiKey: a.apiKey as string | undefined,
          ...(a.model ? { model: a.model as string } : {}),
        });
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const client = observeClientAbort(req, res);
        const sse = (e: unknown): void => {
          if (!client.signal.aborted && !res.destroyed && !res.writableEnded) {
            res.write(`data: ${JSON.stringify(e)}\n\n`);
          }
        };
        try {
          const result = await rt.respondStream(
            {
              hostId: 'serve',
              format: String(a.format),
              intent: String(a.intent ?? ''),
              baseRev: binding.baseRev,
              anchors: [],
              context: String(a.context ?? ''),
              ...(a.sheet ? { sheet: a.sheet as SheetInput } : {}),
              ...(a.board ? { board: a.board as BoardInput } : {}),
              ...(a.doc ? { doc: a.doc as { blocks: Array<{ style: string; text: string; font?: string; size?: number; align?: string; lineSpacing?: number }> } } : {}),
              ...(a.ppt ? { ppt: a.ppt as PptInput } : {}),
              ...(Array.isArray(a.history) ? { history: a.history as Array<{ role: 'user' | 'assistant'; content: string }> } : {}),
            },
            model,
            (e) => {
              if (e.type === 'status') {
                const status = sanitizeStreamStatus(e.status);
                if (status) sse({ type: 'status', status });
              } else if (e.type === 'answer' || e.type === 'draft') {
                sse(e);
              }
            },
            { signal: client.signal },
          );
          if (result.kind === 'changeset') {
            sse({
              type: 'done',
              kind: 'changeset',
              changeSet: result.changeSet,
              diff: await rt.diff(result.changeSet, diffInput(a)),
              proposal: rt.createProposal(result.changeSet, String(a.format), proposalDocumentId(a, binding, result.changeSet.hostId), binding.sourceFileSha256),
            });
          } else if (result.kind === 'clarify') {
            sse({ type: 'done', kind: 'clarify', questions: result.questions });
          } else {
            sse({ type: 'done', kind: 'answer', text: result.text });
          }
        } catch (err) {
          if (!client.signal.aborted && !res.destroyed) {
            sse({ type: 'error', message: emsg(err), ...(err instanceof ProviderCallError ? { error: err.toJSON() } : {}) });
          }
        } finally {
          client.dispose();
        }
        if (!res.destroyed) res.end();
        return;
      }
      if (req.method === 'POST' && url === '/review') {
        if (!hasValidReviewToken(req)) throw new HttpError(403, 'missing or invalid review token');
        const a = await readBody(req);
        assertChangeSet(a.changeSet);
        if (!Array.isArray(a.acceptedEditIds)) throw new HttpError(400, 'acceptedEditIds array required');
        const proposal = a.proposal as ProposalEnvelope;
        if (!proposal?.sourceFileSha256) throw new HttpError(409, 'proposal is not bound to a source file; regenerate it');
        const sourceBytes = decodeDocumentBase64(a.fileBase64);
        const sourceFileSha256 = sha256Bytes(sourceBytes);
        if (proposal.sourceFileSha256 !== sourceFileSha256) throw new HttpError(409, 'proposal source file SHA-256 mismatch');
        if ((a.changeSet as ChangeSet).baseRev !== docRevFromSha256(sourceFileSha256)) {
          throw new HttpError(409, 'proposal revision does not match source file SHA-256');
        }
        const reviewed = rt.reviewProposal(
          proposal,
          a.changeSet as ChangeSet,
          a.acceptedEditIds as string[],
          sourceBytes,
          String(a.reviewerSessionId ?? 'desktop'),
        );
        send(req, res, 200, reviewed);
        return;
      }
      if (req.method === 'POST' && url === '/commit') {
        const a = await readBody(req);
        if (!a.proposal || !a.reviewReceipt) throw new HttpError(403, 'signed proposal and review receipt required');
        const bytes = decodeDocumentBase64(a.fileBase64);
        const sourceRevision = docRevFromSha256(sha256Bytes(bytes));
        if (a.currentRev !== undefined && readDocRev(a.currentRev, sourceRevision) !== sourceRevision) {
          throw new HttpError(409, 'currentRev does not match the uploaded source file');
        }
        assertChangeSet(a.changeSet);
        const r = await rt.commit({
          format: String(a.format),
          bytes,
          changeSet: a.changeSet as ChangeSet,
          currentRev: sourceRevision,
          proposal: a.proposal as ProposalEnvelope,
          reviewReceipt: a.reviewReceipt as ReviewReceipt,
        });
        send(req, res, 200, { ok: r.ok, ...(r.ok ? { fileBase64: Buffer.from(r.bytes).toString('base64') } : { partialFileBase64: Buffer.from(r.bytes).toString('base64') }), touchedParts: r.touchedParts, fidelity: r.fidelity, ...(r.appliedEditIds ? { appliedEditIds: r.appliedEditIds } : {}), ...(r.droppedEdits ? { droppedEdits: r.droppedEdits } : {}) });
        return;
      }
      send(req, res, 404, { error: 'not found' });
    } catch (e) {
      if (res.destroyed) return;
      if (isResourceLimitError(e)) {
        send(req, res, e.resource === 'concurrent_model_requests' ? 429 : 413, { error: emsg(e), ...e.toJSON() });
      } else if (e instanceof ProviderCallError) {
        send(req, res, providerHttpStatus(e), { error: emsg(e), details: e.toJSON() });
      } else {
        send(req, res, e instanceof HttpError ? e.status : 500, { error: emsg(e) });
      }
    } finally {
      releasePost?.();
    }
  })();
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;

server.listen(PORT, HOST, () => {
  process.stderr.write(`\n[otterpatch] serve on http://${HOST}:${PORT}\n`);
  process.stderr.write(security.authTokenGenerated
    ? `[otterpatch] Generated local POST token (shown once): ${AUTH_TOKEN}\n`
    : '[otterpatch] POST auth enabled via X-OtterPatch-Token.\n');
  process.stderr.write(security.reviewTokenGenerated
    ? `[otterpatch] Generated review token (shown once): ${REVIEW_TOKEN}\n`
    : '[otterpatch] Review authority enabled via X-OtterPatch-Review-Token.\n');
  process.stderr.write(`[otterpatch] POST limits: ${security.postsPerMinute}/minute, ${security.maxConcurrentPosts} concurrent.\n`);
  process.stderr.write(`[otterpatch] Capability manifest: ${rt.capabilities().version}\n`);
  process.stderr.write('[otterpatch] If expected Excel ops are missing, restart npm run serve.\n\n');
});
