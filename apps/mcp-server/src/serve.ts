#!/usr/bin/env node
/**
 * otterpatch-serve —— OtterPatch runtime 的本地 HTTP 桥。让驾驶舱 UI(浏览器 / Electron)直接 fetch 跑
 * 真实 propose → diff → commit(BYOK),绕开浏览器对各模型厂商的 CORS 限制。
 *
 *   GET  /health            → { ok, formats, skills }
 *   POST /propose           { format, intent, context, provider, model?, apiKey } → { changeSet, diff }
 *   POST /commit            { format, fileBase64, changeSet, acceptedEditIds? } → { ok, fileBase64, touchedParts, fidelity }
 *
 * 仅监听 localhost;CORS 放开供本机 UI(:5173)调用。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChangeSet, DocRev } from '@otterpatch/core';
import { createModelClient, type Provider } from '@otterpatch/agent';
import { BUILTIN_SKILLS } from '@otterpatch/skills';
import { OtterPatchRuntime } from '@otterpatch/runtime';

const rt = new OtterPatchRuntime();
const PORT = Number(process.env.OtterPatch_PORT ?? 4319);

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function send(res: ServerResponse, code: number, data: unknown): void {
  cors(res);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = code;
  res.end(JSON.stringify(data));
}
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? (JSON.parse(b) as Record<string, unknown>) : {});
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
      if (req.method === 'OPTIONS') {
        cors(res);
        res.statusCode = 204;
        res.end();
        return;
      }
      const url = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && url === '/health') {
        send(res, 200, { ok: true, formats: rt.formats(), skills: BUILTIN_SKILLS.map((s) => s.name) });
        return;
      }
      if (req.method === 'POST' && url === '/propose') {
        const a = await readBody(req);
        const model = createModelClient((a.provider as Provider) || 'claude', {
          apiKey: a.apiKey as string | undefined,
          ...(a.model ? { model: a.model as string } : {}),
        });
        const cs = await rt.propose(
          { hostId: 'serve', format: String(a.format), intent: String(a.intent ?? ''), baseRev: 0 as DocRev, anchors: [], context: String(a.context ?? '') },
          model,
        );
        send(res, 200, { changeSet: cs, diff: rt.diff(cs) });
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
        });
        send(res, 200, { ok: r.ok, fileBase64: Buffer.from(r.bytes).toString('base64'), touchedParts: r.touchedParts, fidelity: r.fidelity });
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: emsg(e) });
    }
  })();
});

server.listen(PORT, () => process.stderr.write(`[otterpatch] HTTP bridge on http://localhost:${PORT}  (GET /health, POST /propose, POST /commit)\n`));
