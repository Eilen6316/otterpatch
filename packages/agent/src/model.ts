/**
 * Agent 模型层(格式无关):意图 + 选区上下文 → 受约束 ChangeSet。
 * 不同 host 格式(Excel/drawio/…)有各自的 HostDialect:系统提示 + 工具 schema + ChangeSet 构造,
 * 由 ProposeRequest.format 选择。模型实现(Claude/OpenAI 兼容/Mock)只负责
 * "按 dialect 调模型 → 拿原始提案 → dialect.buildChangeSet",绝不让模型直接产 OOXML/XML。
 */
import type { ChangeSet, DocRev, LogicalAnchor } from '@otterpatch/core';

export interface ProposeRequest {
  hostId: string;
  format: string; // 'excel' | 'drawio' | …(选 dialect)
  intent: string;
  baseRev: DocRev;
  anchors: LogicalAnchor[]; // 用户圈选(像素已转锚点)
  context: string; // 选区只读快照,喂给模型
  sessionId?: string;
}

/** 一种 host 格式的"方言":系统提示 + 工具(JSON Schema)+ 原始提案到 ChangeSet 的构造。 */
export interface HostDialect {
  format: string;
  systemPrompt: string;
  toolName: string;
  toolDescription: string;
  parameters: Record<string, unknown>; // 工具入参 JSON Schema(Anthropic input_schema / OpenAI function.parameters 复用)
  buildChangeSet(req: ProposeRequest, proposal: unknown): ChangeSet;
}

/** 任何模型实现(真实 Claude / OpenAI 兼容 / Mock)都只产 ChangeSet。 */
export interface ModelClient {
  proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet>;
}

/** 测试/离线用:给定 (req → 原始提案) 函数,交 dialect 确定性构造 ChangeSet。 */
export class MockModelClient implements ModelClient {
  constructor(private readonly fn: (req: ProposeRequest) => unknown) {}
  async proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet> {
    return dialect.buildChangeSet(req, this.fn(req));
  }
}
