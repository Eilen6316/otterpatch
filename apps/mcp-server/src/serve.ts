#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { ChangeSet, DocRev } from '@otterpatch/core';
import { createModelClient, EXCEL_OPS, type Provider } from '@otterpatch/agent';
import { BUILTIN_SKILLS } from '@otterpatch/skills';
import { OtterPatchRuntime } from '@otterpatch/runtime';

const rt = new OtterPatchRuntime();
const PORT = Number(process.env.OtterPatch_PORT ?? 4319);
const HOST = '127.0.0.1';
const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;
const parsedMaxBodyBytes = Number(process.env.OtterPatch_MAX_BODY_BYTES ?? DEFAULT_MAX_BODY_BYTES);
const MAX_BODY_BYTES = Number.isSafeInteger(parsedMaxBodyBytes) && parsedMaxBodyBytes > 0 ? parsedMaxBodyBytes : DEFAULT_MAX_BODY_BYTES;
const AUTH_TOKEN = String(process.env.OtterPatch_TOKEN || '');
const generatedToken = AUTH_TOKEN ? '' : randomBytes(24).toString('base64url');

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OtterPatch-Token');
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
      reject(new HttpError(413, `request body too large (max ${MAX_BODY_BYTES} bytes)`));
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
        reject(new HttpError(413, `request body too large (max ${MAX_BODY_BYTES} bytes)`));
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
        send(req, res, 200, { ok: true, formats: rt.formats(), skills: BUILTIN_SKILLS.map((s) => s.name), excelOps: EXCEL_OPS });
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
            ...(a.sheet ? { sheet: a.sheet as { a1: string; values: unknown[][] } } : {}),
            ...(a.doc ? { doc: a.doc as { blocks: Array<{ style: string; text: string; font?: string; size?: number; align?: string; lineSpacing?: number }> } } : {}),
            ...(Array.isArray(a.history) ? { history: a.history as Array<{ role: 'user' | 'assistant'; content: string }> } : {}),
          },
          model,
        );
        if (r.kind === 'answer') send(req, res, 200, { answer: r.text });
        else if (r.kind === 'clarify') send(req, res, 200, { questions: r.questions });
        else send(req, res, 200, { changeSet: r.changeSet, diff: rt.diff(r.changeSet) });
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
          await rt.respondStream(
            {
              hostId: 'serve',
              format: String(a.format),
              intent: String(a.intent ?? ''),
              baseRev: readDocRev(a.baseRev, 0),
              anchors: [],
              context: String(a.context ?? ''),
              ...(a.sheet ? { sheet: a.sheet as { a1: string; values: unknown[][] } } : {}),
              ...(a.doc ? { doc: a.doc as { blocks: Array<{ style: string; text: string; font?: string; size?: number; align?: string; lineSpacing?: number }> } } : {}),
              ...(Array.isArray(a.history) ? { history: a.history as Array<{ role: 'user' | 'assistant'; content: string }> } : {}),
            },
            model,
            (e) => {
              if (e.type === 'done') {
                if (e.result.kind === 'changeset') sse({ type: 'done', kind: 'changeset', changeSet: e.result.changeSet, diff: rt.diff(e.result.changeSet) });
                else if (e.result.kind === 'clarify') sse({ type: 'done', kind: 'clarify', questions: e.result.questions });
                else sse({ type: 'done', kind: 'answer', text: e.result.text });
              } else {
                sse(e);
              }
            },
          );
        } catch (err) {
          sse({ type: 'error', message: emsg(err) });
        }
        res.end();
        return;
      }
      if (req.method === 'POST' && url === '/commit') {
        const a = await readBody(req);
        const bytes = new Uint8Array(Buffer.from(String(a.fileBase64 ?? ''), 'base64'));
        const r = await rt.commit({
          format: String(a.format),
          bytes,
          changeSet: a.changeSet as ChangeSet,
          ...(Array.isArray(a.acceptedEditIds) ? { acceptedEditIds: a.acceptedEditIds as string[] } : {}),
          currentRev: readDocRev(a.currentRev, Number((a.changeSet as ChangeSet | undefined)?.baseRev ?? 0)),
        });
        send(req, res, 200, { ok: r.ok, ...(r.ok ? { fileBase64: Buffer.from(r.bytes).toString('base64') } : { partialFileBase64: Buffer.from(r.bytes).toString('base64') }), touchedParts: r.touchedParts, fidelity: r.fidelity, ...(r.appliedEditIds ? { appliedEditIds: r.appliedEditIds } : {}), ...(r.droppedEdits ? { droppedEdits: r.droppedEdits } : {}) });
        return;
      }
      send(req, res, 404, { error: 'not found' });
    } catch (e) {
      send(req, res, e instanceof HttpError ? e.status : 500, { error: emsg(e) });
    }
  })();
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;

server.listen(PORT, HOST, () => {
  process.stderr.write(`\n[otterpatch] serve on http://${HOST}:${PORT}\n`);
  process.stderr.write(AUTH_TOKEN ? '[otterpatch] POST auth enabled via X-OtterPatch-Token.\n' : '[otterpatch] POST auth disabled; set OtterPatch_TOKEN to require X-OtterPatch-Token. Suggested token: ' + generatedToken + '\n');
  process.stderr.write(`[otterpatch] Excel ops (${EXCEL_OPS.length}): ${EXCEL_OPS.join(', ')}\n`);
  process.stderr.write('[otterpatch] If expected Excel ops are missing, restart npm run serve.\n\n');
});
