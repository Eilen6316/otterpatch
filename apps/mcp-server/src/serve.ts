#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { ChangeSet, DocRev } from '@otterpatch/core';
import { RESOURCE_LIMITS, ResourceLimitError, assertChangeSet, isResourceLimitError } from '@otterpatch/core';
import { createModelClient, type ProposeRequest, type Provider } from '@otterpatch/agent';
import { BUILTIN_SKILLS } from '@otterpatch/skills';
import { OtterPatchRuntime, type ProposalEnvelope, type ReviewReceipt } from '@otterpatch/runtime';
import { decodeDocumentBase64 } from './document-input.js';

const rt = new OtterPatchRuntime();
type SheetInput = NonNullable<ProposeRequest['sheet']>;
const PORT = Number(process.env.OtterPatch_PORT ?? 4319);
const HOST = '127.0.0.1';
const DEFAULT_MAX_BODY_BYTES = RESOURCE_LIMITS.httpBodyBytes;
const parsedMaxBodyBytes = Number(process.env.OtterPatch_MAX_BODY_BYTES ?? DEFAULT_MAX_BODY_BYTES);
const MAX_BODY_BYTES = Number.isSafeInteger(parsedMaxBodyBytes) && parsedMaxBodyBytes > 0
  ? Math.min(parsedMaxBodyBytes, DEFAULT_MAX_BODY_BYTES)
  : DEFAULT_MAX_BODY_BYTES;
const AUTH_TOKEN = String(process.env.OtterPatch_TOKEN || '');
const generatedToken = AUTH_TOKEN ? '' : randomBytes(24).toString('base64url');
const configuredReviewToken = String(process.env.OtterPatch_REVIEW_TOKEN || '');
const REVIEW_TOKEN = configuredReviewToken || randomBytes(24).toString('base64url');

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === 'null') return Boolean(AUTH_TOKEN); // packaged Electron file:// renderer must use the local token
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  } catch {
    return false;
  }
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
  const n = Number(value ?? fallback);
  return (Number.isSafeInteger(n) && n >= 0 ? n : fallback) as DocRev;
}

function hasValidToken(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers['x-otterpatch-token'];
  return !Array.isArray(header) && header === AUTH_TOKEN;
}

function hasValidReviewToken(req: IncomingMessage): boolean {
  const header = req.headers['x-otterpatch-review-token'];
  return !Array.isArray(header) && header === REVIEW_TOKEN;
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

const emsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
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
      if (req.method === 'POST' && !hasValidToken(req)) {
        send(req, res, 401, { error: 'missing or invalid local token' });
        return;
      }
      if (req.method === 'POST' && url === '/propose') {
        const a = await readBody(req);
        const model = createModelClient((a.provider as Provider) || 'claude', {
          apiKey: a.apiKey as string | undefined,
          ...(a.model ? { model: a.model as string } : {}),
        });
        const r = await rt.respond(
          {
            hostId: 'serve',
            format: String(a.format),
            intent: String(a.intent ?? ''),
            baseRev: readDocRev(a.baseRev, 0),
            anchors: [],
            context: String(a.context ?? ''),
            ...(a.sheet ? { sheet: a.sheet as SheetInput } : {}),
            ...(a.doc ? { doc: a.doc as { blocks: Array<{ style: string; text: string; font?: string; size?: number; align?: string; lineSpacing?: number }> } } : {}),
            ...(Array.isArray(a.history) ? { history: a.history as Array<{ role: 'user' | 'assistant'; content: string }> } : {}),
          },
          model,
        );
        if (r.kind === 'answer') send(req, res, 200, { answer: r.text });
        else if (r.kind === 'clarify') send(req, res, 200, { questions: r.questions });
        else send(req, res, 200, {
          changeSet: r.changeSet,
          diff: await rt.diff(r.changeSet, { format: String(a.format), ...(a.sheet ? { sheet: a.sheet as SheetInput } : {}) }),
          proposal: rt.createProposal(r.changeSet, String(a.format), String(a.documentId ?? r.changeSet.hostId)),
        });
        return;
      }
      if (req.method === 'POST' && url === '/propose-stream') {
        const a = await readBody(req);
        const model = createModelClient((a.provider as Provider) || 'claude', {
          apiKey: a.apiKey as string | undefined,
          ...(a.model ? { model: a.model as string } : {}),
        });
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const sse = (e: unknown): void => { res.write(`data: ${JSON.stringify(e)}\n\n`); };
        try {
          const result = await rt.respondStream(
            {
              hostId: 'serve',
              format: String(a.format),
              intent: String(a.intent ?? ''),
              baseRev: readDocRev(a.baseRev, 0),
              anchors: [],
              context: String(a.context ?? ''),
              ...(a.sheet ? { sheet: a.sheet as SheetInput } : {}),
              ...(a.doc ? { doc: a.doc as { blocks: Array<{ style: string; text: string; font?: string; size?: number; align?: string; lineSpacing?: number }> } } : {}),
              ...(Array.isArray(a.history) ? { history: a.history as Array<{ role: 'user' | 'assistant'; content: string }> } : {}),
            },
            model,
            (e) => { if (e.type !== 'done') sse(e); },
          );
          if (result.kind === 'changeset') {
            sse({
              type: 'done',
              kind: 'changeset',
              changeSet: result.changeSet,
              diff: await rt.diff(result.changeSet, { format: String(a.format), ...(a.sheet ? { sheet: a.sheet as SheetInput } : {}) }),
              proposal: rt.createProposal(result.changeSet, String(a.format), String(a.documentId ?? result.changeSet.hostId)),
            });
          } else if (result.kind === 'clarify') {
            sse({ type: 'done', kind: 'clarify', questions: result.questions });
          } else {
            sse({ type: 'done', kind: 'answer', text: result.text });
          }
        } catch (err) {
          sse({ type: 'error', message: emsg(err) });
        }
        res.end();
        return;
      }
      if (req.method === 'POST' && url === '/review') {
        if (!hasValidReviewToken(req)) throw new HttpError(403, 'missing or invalid review token');
        const a = await readBody(req);
        assertChangeSet(a.changeSet);
        if (!Array.isArray(a.acceptedEditIds)) throw new HttpError(400, 'acceptedEditIds array required');
        const reviewed = rt.reviewProposal(
          a.proposal as ProposalEnvelope,
          a.changeSet as ChangeSet,
          a.acceptedEditIds as string[],
          decodeDocumentBase64(a.fileBase64),
          String(a.reviewerSessionId ?? 'desktop'),
        );
        send(req, res, 200, reviewed);
        return;
      }
      if (req.method === 'POST' && url === '/commit') {
        const a = await readBody(req);
        if (!a.proposal || !a.reviewReceipt) throw new HttpError(403, 'signed proposal and review receipt required');
        const bytes = decodeDocumentBase64(a.fileBase64);
        assertChangeSet(a.changeSet);
        const r = await rt.commit({
          format: String(a.format),
          bytes,
          changeSet: a.changeSet as ChangeSet,
          currentRev: readDocRev(a.currentRev, Number((a.changeSet as ChangeSet | undefined)?.baseRev ?? 0)),
          proposal: a.proposal as ProposalEnvelope,
          reviewReceipt: a.reviewReceipt as ReviewReceipt,
        });
        send(req, res, 200, { ok: r.ok, ...(r.ok ? { fileBase64: Buffer.from(r.bytes).toString('base64') } : { partialFileBase64: Buffer.from(r.bytes).toString('base64') }), touchedParts: r.touchedParts, fidelity: r.fidelity, ...(r.appliedEditIds ? { appliedEditIds: r.appliedEditIds } : {}), ...(r.droppedEdits ? { droppedEdits: r.droppedEdits } : {}) });
        return;
      }
      send(req, res, 404, { error: 'not found' });
    } catch (e) {
      if (isResourceLimitError(e)) {
        send(req, res, e.resource === 'concurrent_model_requests' ? 429 : 413, { error: emsg(e), ...e.toJSON() });
      } else {
        send(req, res, e instanceof HttpError ? e.status : 500, { error: emsg(e) });
      }
    }
  })();
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;

server.listen(PORT, HOST, () => {
  process.stderr.write(`\n[otterpatch] serve on http://${HOST}:${PORT}\n`);
  process.stderr.write(AUTH_TOKEN ? '[otterpatch] POST auth enabled via X-OtterPatch-Token.\n' : '[otterpatch] POST auth disabled; set OtterPatch_TOKEN to require X-OtterPatch-Token. Suggested token: ' + generatedToken + '\n');
  process.stderr.write(configuredReviewToken ? '[otterpatch] Review authority enabled via X-OtterPatch-Review-Token.\n' : '[otterpatch] Generated review token: ' + REVIEW_TOKEN + '\n');
  process.stderr.write(`[otterpatch] Capability manifest: ${rt.capabilities().version}\n`);
  process.stderr.write('[otterpatch] If expected Excel ops are missing, restart npm run serve.\n\n');
});
