#!/usr/bin/env node
/**
 * otterpatch-mcp —— 把 OtterPatch 暴露成 MCP server(stdio),让别的 Agent / IDE 调用其
 * "提议 → diff → 外科写回"能力。BYOK:每次调用传 apiKey,或启动时设 OtterPatch_API_KEY。
 *
 * 工具:
 *  - otterpatch_skills  列出内置(通用)文档技能
 *  - otterpatch_propose 意图 → 受约束 ChangeSet(+ 可审阅 diff)
 *  - otterpatch_diff    ChangeSet → 可审阅 diff
 *  - otterpatch_commit  ChangeSet + 原文件(base64)→ 外科写回 → 新文件(base64)+ 保真报告
 *
 * 注意:stdio 的 stdout 走 JSON-RPC 协议,事件流只能打到 stderr,绝不污染 stdout。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { ChangeSet, DocRev } from '@otterpatch/core';
import { assertChangeSet } from '@otterpatch/core';
import { createModelClient, type Provider } from '@otterpatch/agent';
import { BUILTIN_SKILLS } from '@otterpatch/skills';
import { OtterPatchRuntime, type ProposalEnvelope, type ReviewReceipt } from '@otterpatch/runtime';

const allowUnreviewedCommit = process.env.OTTERPATCH_ALLOW_UNREVIEWED_COMMIT === '1';
const rt = new OtterPatchRuntime({ allowUnreviewedCommit });
rt.on((e) => process.stderr.write('[otterpatch] ' + JSON.stringify(e) + '\n'));

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
const emsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const server = new McpServer({ name: 'otterpatch', version: '0.0.1' });

server.registerTool(
  'otterpatch_skills',
  { description: 'List OtterPatch built-in (universal) document skills (xlsx/docx/pptx/pdf/drawio).', inputSchema: {} },
  async () => ok(BUILTIN_SKILLS.map((s) => ({ name: s.name, formats: s.formats, description: s.description }))),
);

server.registerTool(
  'otterpatch_propose',
  {
    description:
      'Propose a constrained ChangeSet for a document edit (the agent never emits raw OOXML — only a structured ChangeSet). Returns { changeSet, diff }. BYOK: pass apiKey or set OtterPatch_API_KEY.',
    inputSchema: {
      format: z.string().describe('excel | drawio | word | ...'),
      intent: z.string().describe('natural-language edit intent'),
      context: z.string().default('').describe('read-only snapshot of the selected region, fed to the model'),
      baseRev: z.number().int().nonnegative().default(0).describe('document revision used as the ChangeSet base revision'),
      provider: z.string().default('claude').describe('claude | openai | deepseek | glm | kimi | doubao | minimax | gemini'),
      model: z.string().optional(),
      apiKey: z.string().optional(),
      sheet: z.object({ a1: z.string(), values: z.array(z.array(z.unknown())) }).optional(),
      doc: z.object({ blocks: z.array(z.object({ style: z.string(), text: z.string(), font: z.string().optional(), size: z.number().optional(), align: z.string().optional(), lineSpacing: z.number().optional() })) }).optional(),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
    },
  },
  async (a) => {
    try {
      const model = createModelClient((a.provider as Provider) || 'claude', {
        apiKey: a.apiKey ?? process.env.OtterPatch_API_KEY,
        ...(a.model ? { model: a.model } : {}),
      });
      const r = await rt.respond(
        {
          hostId: 'mcp',
          format: a.format,
          intent: a.intent,
          baseRev: a.baseRev as DocRev,
          anchors: [],
          context: a.context ?? '',
          ...(a.sheet ? { sheet: a.sheet } : {}),
          ...(a.doc ? { doc: a.doc } : {}),
          ...(a.history ? { history: a.history } : {}),
        },
        model,
      );
      if (r.kind === 'answer') return ok({ answer: r.text });
      if (r.kind === 'clarify') return ok({ questions: r.questions });
      return ok({ changeSet: r.changeSet, diff: rt.diff(r.changeSet), proposal: rt.createProposal(r.changeSet, a.format) });
    } catch (e) {
      return fail('propose failed: ' + emsg(e));
    }
  },
);

server.registerTool(
  'otterpatch_diff',
  { description: 'Render a reviewable diff for a ChangeSet (passed as JSON string).', inputSchema: { changeSet: z.string().describe('ChangeSet JSON') } },
  async (a) => {
    try {
      const changeSet = JSON.parse(a.changeSet) as ChangeSet;
      assertChangeSet(changeSet);
      return ok(rt.diff(changeSet));
    } catch (e) {
      return fail('diff failed: ' + emsg(e));
    }
  },
);

server.registerTool(
  'otterpatch_commit',
  {
    description: 'Commit a previously reviewed proposal. A trusted host must supply the signed proposal and review receipt. Unreviewed commit is disabled unless OTTERPATCH_ALLOW_UNREVIEWED_COMMIT=1.',
    inputSchema: {
      format: z.string(),
      fileBase64: z.string().describe('original document bytes, base64'),
      changeSet: z.string().describe('ChangeSet JSON (from otterpatch_propose)'),
      proposal: z.string().optional().describe('signed ProposalEnvelope JSON returned by otterpatch_propose'),
      reviewReceipt: z.string().optional().describe('signed ReviewReceipt JSON issued by a trusted review UI'),
      acceptedEditIds: z.array(z.string()).optional().describe('required only in explicitly enabled unreviewed mode; never defaults to accept all'),
      currentRev: z.number().int().nonnegative().optional().describe('live document revision observed immediately before commit'),
    },
  },
  async (a) => {
    try {
      const bytes = new Uint8Array(Buffer.from(a.fileBase64, 'base64'));
      const changeSet = JSON.parse(a.changeSet) as ChangeSet;
      const proposal = a.proposal ? JSON.parse(a.proposal) as ProposalEnvelope : undefined;
      const reviewReceipt = a.reviewReceipt ? JSON.parse(a.reviewReceipt) as ReviewReceipt : undefined;
      const res = await rt.commit({
        format: a.format,
        bytes,
        changeSet,
        ...(a.acceptedEditIds ? { acceptedEditIds: a.acceptedEditIds } : {}),
        currentRev: (a.currentRev ?? changeSet.baseRev) as DocRev,
        ...(proposal ? { proposal } : {}),
        ...(reviewReceipt ? { reviewReceipt } : {}),
      });
      return ok({ ok: res.ok, ...(res.ok ? { fileBase64: Buffer.from(res.bytes).toString('base64') } : { partialFileBase64: Buffer.from(res.bytes).toString('base64') }), touchedParts: res.touchedParts, fidelity: res.fidelity, ...(res.appliedEditIds ? { appliedEditIds: res.appliedEditIds } : {}), ...(res.droppedEdits ? { droppedEdits: res.droppedEdits } : {}) });
    } catch (e) {
      return fail('commit failed: ' + emsg(e));
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('[otterpatch] MCP server ready on stdio — tools: otterpatch_skills, otterpatch_propose, otterpatch_diff, otterpatch_commit\n');
