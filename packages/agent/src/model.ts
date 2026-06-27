/**
 * Agent 模型层:把"自然语言意图 + 选区上下文"变成受约束的 ChangeSet。
 * 模型只用 A1 引用 + setValue/setFormula 说话(Proposal),由 buildChangeSet 组装成正式 ChangeSet
 * (锚点表 + edits),绝不让模型直接产 OOXML。
 */
import type { AnchorId, CellValue, ChangeSet, DocRev, Edit, EditOp, HostId, LogicalAnchor } from '@office-agent/core';

/** 模型面向的轻量提案:A1 + op。 */
export interface Proposal {
  plan: string;
  edits: Array<{ cell: string; op: 'setValue' | 'setFormula'; value?: CellValue; formula?: string }>;
}

export interface ProposeRequest {
  hostId: string;
  intent: string;
  baseRev: DocRev;
  anchors: LogicalAnchor[]; // 用户圈选(像素已转锚点)
  context: string; // 选区只读快照(值/表头),喂给模型
  sessionId?: string;
}

/** 任何模型实现(真实 Claude / Mock / 国产)都只产 ChangeSet。 */
export interface ModelClient {
  proposeChangeSet(req: ProposeRequest): Promise<ChangeSet>;
}

export const SYSTEM_PROMPT =
  '你是一个 Office 表格编辑 Agent。用户在电子表格里圈选了一块区域,你要把用户的意图转成一组结构化修改建议,' +
  '只能通过 propose_changeset 工具提交。规则:① 用 A1 引用(如 Sheet1!B1);② 只用 setValue / setFormula;' +
  '③ 不直接执行,改动会先交用户逐条审阅。先给一句话 plan,再给 edits。';

/** propose_changeset 工具的 JSON Schema(Anthropic 的 input_schema 与 OpenAI 的 function.parameters 复用同一份)。 */
export const PROPOSE_TOOL_NAME = 'propose_changeset';
export const PROPOSE_DESCRIPTION =
  '提出对所选单元格的修改建议(不直接执行,交用户审阅)。用 A1 引用,只用 setValue/setFormula。';
export const PROPOSE_PARAMETERS = {
  type: 'object',
  properties: {
    plan: { type: 'string', description: '一句话说明你打算做什么' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cell: { type: 'string', description: 'A1 引用,如 Sheet1!B1' },
          op: { type: 'string', enum: ['setValue', 'setFormula'] },
          value: { description: 'setValue 的新值(字符串/数字/布尔/空)' },
          formula: { type: 'string', description: 'setFormula 的公式,如 =C2*D2' },
        },
        required: ['cell', 'op'],
      },
    },
  },
  required: ['plan', 'edits'],
};

function refParts(cell: string): { sheet: string; a1: string } {
  const i = cell.indexOf('!');
  if (i >= 0) return { sheet: cell.slice(0, i).replace(/^'|'$/g, ''), a1: cell };
  return { sheet: 'Sheet1', a1: cell };
}

/** 把 Proposal 组装成正式 ChangeSet:每条 edit 一个锚点(portable.grid),op 为 setValue/setFormula。 */
export function buildChangeSet(req: ProposeRequest, proposal: Proposal): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits: Edit[] = [];

  proposal.edits.forEach((e, i) => {
    const aid = ('a' + i) as AnchorId;
    const { sheet } = refParts(e.cell);
    anchors[aid] = {
      id: aid,
      hostId: req.hostId as HostId,
      kind: 'grid',
      ref: null,
      baseRev: req.baseRev,
      portable: { kind: 'grid', sheet, a1: e.cell },
    };
    const op: EditOp =
      e.op === 'setFormula'
        ? { family: 'value', kind: 'setFormula', formula: e.formula ?? '' }
        : { family: 'value', kind: 'setValue', value: (e.value ?? null) as CellValue };
    edits.push({ id: 'e' + i, target: aid, op });
  });

  return {
    id: 'cs-' + Date.now(),
    hostId: req.hostId,
    baseRev: req.baseRev,
    anchors,
    origin: { by: 'agent', sessionId: req.sessionId ?? 'mock' },
    meta: { intent: req.intent, planSummary: proposal.plan },
    edits,
  };
}

/** 测试/离线用:给定一个 (req → Proposal) 函数,确定性产 ChangeSet。 */
export class MockModelClient implements ModelClient {
  constructor(private readonly fn: (req: ProposeRequest) => Proposal) {}
  async proposeChangeSet(req: ProposeRequest): Promise<ChangeSet> {
    return buildChangeSet(req, this.fn(req));
  }
}
