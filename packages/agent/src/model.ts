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
  /** 整张表全量数据(本地传给 serve,不直接塞进模型 prompt;供 read_range/aggregate 工具按需取数)。 */
  sheet?: { a1: string; values: unknown[][] };
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

/** Agent 对一条请求的回应:要么回答问题(聊天),要么提出表格改动(待审阅 diff)。 */
export type AgentResponse =
  | { kind: 'answer'; text: string }
  | { kind: 'changeset'; changeSet: ChangeSet };

/** 任何模型实现(真实 Claude / OpenAI 兼容 / Mock)。 */
export interface ModelClient {
  /** 仅产 ChangeSet(强制执行路径,保留给确定要改表的场景/测试)。 */
  proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet>;
  /** 智能路由:模型自行决定『回答问题』还是『提出改动』(tool_choice:auto)。可选;无则回退到 proposeChangeSet。 */
  respond?(req: ProposeRequest, dialect: HostDialect): Promise<AgentResponse>;
}

/** 测试/离线用:给定 (req → 原始提案) 函数,交 dialect 确定性构造 ChangeSet。 */
export class MockModelClient implements ModelClient {
  constructor(private readonly fn: (req: ProposeRequest) => unknown) {}
  async proposeChangeSet(req: ProposeRequest, dialect: HostDialect): Promise<ChangeSet> {
    return dialect.buildChangeSet(req, this.fn(req));
  }
  async respond(req: ProposeRequest, dialect: HostDialect): Promise<AgentResponse> {
    return { kind: 'changeset', changeSet: dialect.buildChangeSet(req, this.fn(req)) };
  }
}
