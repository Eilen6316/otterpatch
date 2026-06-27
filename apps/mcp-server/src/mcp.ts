#!/usr/bin/env node
/**
 * opal-mcp —— 把 OPAL 暴露成 MCP server(stdio),让别的 Agent / IDE 调用其
 * "提议 → diff → 外科写回"能力。BYOK:每次调用传 apiKey,或启动时设 OPAL_API_KEY。
 *
 * 工具:
 *  - opal_skills  列出内置(通用)文档技能
 *  - opal_propose 意图 → 受约束 ChangeSet(+ 可审阅 diff)
 *  - opal_diff    ChangeSet → 可审阅 diff
 *  - opal_commit  ChangeSet + 原文件(base64)→ 外科写回 → 新文件(base64)+ 保真报告
 *
 * 注意:stdio 的 stdout 走 JSON-RPC 协议,事件流只能打到 stderr,绝不污染 stdout。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { ChangeSet, DocRev } from '@opal/core';
import { createModelClient, type Provider } from '@opal/agent';
import { BUILTIN_SKILLS } from '@opal/skills';
import { OpalRuntime } from '@opal/runtime';

const rt = new OpalRuntime();
rt.on((e) => process.stderr.write('[opal] ' + JSON.stringify(e) + '\n'));

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
const emsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const server = new McpServer({ name: 'opal', version: '0.0.1' });

server.registerTool(
  'opal_skills',
  { description: 'List OPAL built-in (universal) document skills (xlsx/docx/pptx/pdf/drawio).', inputSchema: {} },
  async () => ok(BUILTIN_SKILLS.map((s) => ({ name: s.name, formats: s.formats, description: s.description }))),
);

server.registerTool(
  'opal_propose',
  {
    description:
      'Propose a constrained ChangeSet for a document edit (the agent never emits raw OOXML — only a structured ChangeSet). Returns { changeSet, diff }. BYOK: pass apiKey or set OPAL_API_KEY.',
    inputSchema: {
      format: z.string().describe('excel | drawio | word | ...'),
      intent: z.string().describe('natural-language edit intent'),
      context: z.string().default('').describe('read-only snapshot of the selected region, fed to the model'),
      provider: z.string().default('claude').describe('claude | openai | deepseek | glm | kimi | doubao | minimax | gemini'),
      model: z.string().optional(),
      apiKey: z.string().optional(),
    },
  },
  async (a) => {
    try {
      const model = createModelClient((a.provider as Provider) || 'claude', {
        apiKey: a.apiKey ?? process.env.OPAL_API_KEY,
        ...(a.model ? { model: a.model } : {}),
      });
      const cs = await rt.propose(
        { hostId: 'mcp', format: a.format, intent: a.intent, baseRev: 0 as DocRev, anchors: [], context: a.context ?? '' },
        model,
      );
      return ok({ changeSet: cs, diff: rt.diff(cs) });
    } catch (e) {
      return fail('propose failed: ' + emsg(e));
    }
  },
);

server.registerTool(
  'opal_diff',
  { description: 'Render a reviewable diff for a ChangeSet (passed as JSON string).', inputSchema: { changeSet: z.string().describe('ChangeSet JSON') } },
  async (a) => {
    try {
      return ok(rt.diff(JSON.parse(a.changeSet) as ChangeSet));
    } catch (e) {
      return fail('diff failed: ' + emsg(e));
    }
  },
);

server.registerTool(
  'opal_commit',
  {
    description: 'Surgically write a ChangeSet back into a document — only touched parts change, the rest stays byte-identical. Returns { ok, fileBase64, touchedParts, fidelity }.',
    inputSchema: {
      format: z.string(),
      fileBase64: z.string().describe('original document bytes, base64'),
      changeSet: z.string().describe('ChangeSet JSON (from opal_propose)'),
      acceptedEditIds: z.array(z.string()).optional().describe('subset of edit ids to commit; omit = accept all'),
    },
  },
  async (a) => {
    try {
      const bytes = new Uint8Array(Buffer.from(a.fileBase64, 'base64'));
      const res = await rt.commit({
        format: a.format,
        bytes,
        changeSet: JSON.parse(a.changeSet) as ChangeSet,
        ...(a.acceptedEditIds ? { acceptedEditIds: a.acceptedEditIds } : {}),
      });
      return ok({ ok: res.ok, fileBase64: Buffer.from(res.bytes).toString('base64'), touchedParts: res.touchedParts, fidelity: res.fidelity });
    } catch (e) {
      return fail('commit failed: ' + emsg(e));
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('[opal] MCP server ready on stdio — tools: opal_skills, opal_propose, opal_diff, opal_commit\n');
