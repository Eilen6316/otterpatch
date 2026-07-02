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
import { createModelClient, EXCEL_OPS, type Provider } from '@otterpatch/agent';
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
        send(res, 200, { ok: true, formats: rt.formats(), skills: BUILTIN_SKILLS.map((s) => s.name), excelOps: EXCEL_OPS });
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
            baseRev: 0 as DocRev,
            anchors: [],
            context: String(a.context ?? ''),
            ...(a.sheet ? { sheet: a.sheet as { a1: string; values: unknown[][] } } : {}),
            ...(a.doc ? { doc: a.doc as { blocks: Array<{ style: string; text: string; font?: string; size?: number; align?: string; lineSpacing?: number }> } } : {}),
            ...(Array.isArray(a.history) ? { history: a.history as Array<{ role: 'user' | 'assistant'; content: string }> } : {}),
          },
          model,
        );
        if (r.kind === 'answer') send(res, 200, { answer: r.text });
        else if (r.kind === 'clarify') send(res, 200, { questions: r.questions });
        else send(res, 200, { changeSet: r.changeSet, diff: rt.diff(r.changeSet) });
        return;
      }
      if (req.method === 'POST' && url === '/propose-stream') {
        const a = await readBody(req);
        const model = createModelClient((a.provider as Provider) || 'claude', {
          apiKey: a.apiKey as string | undefined,
          ...(a.model ? { model: a.model as string } : {}),
        });
        cors(res);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const sse = (e: unknown): void => { res.write(`data: ${JSON.stringify(e)}\n\n`); };
        try {
          await rt.respondStream(
            {
              hostId: 'serve',
              format: String(a.format),
              intent: String(a.intent ?? ''),
              baseRev: 0 as DocRev,
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
        });
        send(res, 200, { ok: r.ok, fileBase64: Buffer.from(r.bytes).toString('base64'), touchedParts: r.touchedParts, fidelity: r.fidelity, ...(r.appliedEditIds ? { appliedEditIds: r.appliedEditIds } : {}), ...(r.droppedEdits ? { droppedEdits: r.droppedEdits } : {}) });
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: emsg(e) });
    }
  })();
});

server.listen(PORT, () => {
  // 启动横幅:打印已加载的 Excel 能力,便于核对 serve 是不是最新代码(避免"改了但 serve 还是旧的")
  process.stderr.write(`\n[otterpatch] serve on http://localhost:${PORT}\n`);
  process.stderr.write(`[otterpatch] Excel 能力(${EXCEL_OPS.length}): ${EXCEL_OPS.join(', ')}\n`);
  process.stderr.write(`[otterpatch] 看到上面这行=已是最新;若缺 insertRows/merge/freeze/sort 等,说明 serve 仍是旧进程,请重启 npm run serve\n\n`);
});
