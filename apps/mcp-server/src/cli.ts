#!/usr/bin/env node
/**
 * otterpatch-run —— headless 跑一遍 propose → diff → commit,把每个阶段的结构化事件
 * 逐行 JSON 打到 stdout(供非 MCP 宿主 / 管道 / CI 消费)。
 *
 * 用法:
 *   otterpatch-run --format excel --intent "把 B1 改成 99" --in in.xlsx --out out.xlsx
 *   otterpatch-run --mock --in in.xlsx --out out.xlsx        # 无需 API key,固定演示 edit
 * BYOK:export OtterPatch_API_KEY=...(非 --mock 时必需);--provider/--model 可选。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { DocRev } from '@otterpatch/core';
import { createModelClient, MockModelClient, type ModelClient, type Provider, type ProposeRequest } from '@otterpatch/agent';
import { OtterPatchRuntime } from '@otterpatch/runtime';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes('--' + name);
const emit = (o: unknown): void => void process.stdout.write(JSON.stringify(o) + '\n');

const format = arg('format') ?? 'excel';
const intent = arg('intent') ?? '';
const context = arg('context') ?? '';
const inPath = arg('in');
const outPath = arg('out');
const provider = (arg('provider') ?? 'claude') as Provider;
const model = arg('model');
const mock = has('mock');

const rt = new OtterPatchRuntime();
rt.on(emit);

const isWord = format === 'word' || format === 'docx';
const isPdf = format === 'pdf';
const isPpt = format === 'ppt' || format === 'pptx';
const mockProposal = isWord
  ? { plan: intent || 'demo edit', edits: [{ quote: 'hello world', replacement: 'hello brave world' }] }
  : isPdf
    ? { plan: intent || 'demo edit', edits: [{ field: 'name', value: 'Alice' }] }
    : isPpt
      ? { plan: intent || 'demo edit', edits: [{ slide: 0, find: 'Hello', replace: 'World' }] }
      : { plan: intent || 'demo edit', edits: [{ cell: 'Sheet1!B1', op: 'setValue', value: 99 }] };
const client: ModelClient = mock
  ? new MockModelClient(() => mockProposal)
  : createModelClient(provider, { apiKey: process.env.OtterPatch_API_KEY, ...(model ? { model } : {}) });

const req: ProposeRequest = { hostId: 'cli', format, intent, baseRev: 0 as DocRev, anchors: [], context };

try {
  const cs = await rt.propose(req, client);
  rt.diff(cs);
  if (inPath) {
    const bytes = new Uint8Array(readFileSync(inPath));
    const res = await rt.commit({ format, bytes, changeSet: cs });
    if (outPath && res.ok) {
      writeFileSync(outPath, res.bytes);
      emit({ type: 'wrote', path: outPath, bytes: res.bytes.length });
    }
  }
} catch (e) {
  emit({ type: 'fatal', message: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
}
