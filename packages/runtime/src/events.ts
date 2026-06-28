/**
 * OtterPatchEvent —— headless JSON 事件流。propose → diff → commit 每个阶段发一条结构化事件,
 * 供 MCP server / CLI / 远端宿主流式消费(可直接 JSON.stringify 逐行输出)。
 */
import type { OtterPatchDiff } from './diff.js';

export type OtterPatchEvent =
  | { type: 'propose:start'; format: string; intent: string }
  | { type: 'propose:done'; changeSetId: string; editCount: number; planSummary?: string }
  | { type: 'diff:done'; diff: OtterPatchDiff }
  | { type: 'commit:start'; format: string; strategy: string; editCount: number }
  | { type: 'commit:done'; ok: boolean; touchedParts: string[]; fidelity: number; bytes: number }
  | { type: 'error'; stage: 'propose' | 'diff' | 'commit'; message: string };

export type OtterPatchEventListener = (e: OtterPatchEvent) => void;
