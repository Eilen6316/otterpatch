/**
 * Host 方言:Excel(A1 + setValue/setFormula)与 drawio(mxCell id + add/update/delete/move)。
 * 每种格式有自己的系统提示、工具 schema、原始提案 → ChangeSet 的构造。
 */
import type { AnchorId, CellValue, ChangeSet, Edit, EditOp, HostId, LogicalAnchor } from '@otterpatch/core';
import type { HostDialect, ProposeRequest } from './model.js';

function newChangeSet(
  req: ProposeRequest,
  plan: string,
  anchors: Record<AnchorId, LogicalAnchor>,
  edits: Edit[],
): ChangeSet {
  return {
    id: 'cs-' + Date.now(),
    hostId: req.hostId,
    baseRev: req.baseRev,
    anchors,
    origin: { by: 'agent', sessionId: req.sessionId ?? 'mock' },
    meta: { intent: req.intent, planSummary: plan },
    edits,
  };
}

// ───────────────────────── Excel ─────────────────────────

export interface ExcelStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string; // 字体色
  bgColor?: string; // 填充/背景色(标红高亮即 bgColor)
  align?: 'left' | 'center' | 'right';
}
export interface ExcelProposal {
  plan: string;
  edits: Array<{
    cell: string;
    op: 'setValue' | 'setFormula' | 'setStyle' | 'setNumberFormat';
    value?: CellValue;
    formula?: string;
    style?: ExcelStyle;
    pattern?: string; // setNumberFormat 的数字格式,如 0% / "¥"#,##0.00
  }>;
}

function sheetOf(cell: string): string {
  const i = cell.indexOf('!');
  return i >= 0 ? cell.slice(0, i).replace(/^'|'$/g, '') : 'Sheet1';
}

function buildExcelChangeSet(req: ProposeRequest, p: ExcelProposal): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits: Edit[] = [];
  p.edits.forEach((e, i) => {
    const aid = ('a' + i) as AnchorId;
    anchors[aid] = {
      id: aid,
      hostId: req.hostId as HostId,
      kind: 'grid',
      ref: null,
      baseRev: req.baseRev,
      portable: { kind: 'grid', sheet: sheetOf(e.cell), a1: e.cell },
    };
    const op: EditOp =
      e.op === 'setFormula'
        ? { family: 'value', kind: 'setFormula', formula: e.formula ?? '' }
        : e.op === 'setStyle'
          ? { family: 'style', kind: 'setStyle', style: e.style ?? {} }
          : e.op === 'setNumberFormat'
            ? { family: 'style', kind: 'setNumberFormat', pattern: e.pattern ?? 'General' }
            : { family: 'value', kind: 'setValue', value: (e.value ?? null) as CellValue };
    edits.push({ id: 'e' + i, target: aid, op });
  });
  return newChangeSet(req, p.plan, anchors, edits);
}

export const excelDialect: HostDialect = {
  format: 'excel',
  systemPrompt:
    '你是一个 Office 表格编辑 Agent。用户在电子表格里圈选了一块区域,把意图转成一组结构化修改建议,' +
    '只能通过 propose_changeset 工具提交。规则:① 用 A1 引用(如 Sheet1!B1);② 可用 setValue / setFormula 改内容;' +
    '③ 改格式用 setStyle:标红/高亮异常值用 style.bgColor(如 #ffd6d6),字体颜色 style.color,加粗 style.bold,对齐 style.align;' +
    '数字格式(如百分比/货币)用 setNumberFormat 的 pattern(如 0% / "¥"#,##0.00);' +
    '④ 不直接执行,改动会先交用户逐条审阅。先给一句话 plan,再给 edits。例:标红某异常单元格 → {cell:"Sheet1!C4", op:"setStyle", style:{bgColor:"#ffd6d6", color:"#d11", bold:true}}。',
  toolName: 'propose_changeset',
  toolDescription: '提出对所选单元格的修改建议(不直接执行,交用户审阅)。用 A1 引用;改内容用 setValue/setFormula,改格式(标红/加粗/字色/对齐)用 setStyle,数字格式用 setNumberFormat。',
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: '一句话说明你打算做什么' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            cell: { type: 'string', description: 'A1 引用,如 Sheet1!B1' },
            op: { type: 'string', enum: ['setValue', 'setFormula', 'setStyle', 'setNumberFormat'] },
            value: { description: 'setValue 的新值(字符串/数字/布尔/空)' },
            formula: { type: 'string', description: 'setFormula 的公式,如 =C2*D2' },
            style: {
              type: 'object',
              description: 'setStyle 的格式:bold 加粗、color 字体色、bgColor 背景/标红色、align 对齐',
              properties: {
                bold: { type: 'boolean' },
                italic: { type: 'boolean' },
                color: { type: 'string', description: '字体色,如 #d11' },
                bgColor: { type: 'string', description: '背景/标红色,如 #ffd6d6' },
                align: { type: 'string', enum: ['left', 'center', 'right'] },
              },
            },
            pattern: { type: 'string', description: 'setNumberFormat 的数字格式,如 0% 或 "¥"#,##0.00' },
          },
          required: ['cell', 'op'],
        },
      },
    },
    required: ['plan', 'edits'],
  },
  buildChangeSet: (req, proposal) => buildExcelChangeSet(req, proposal as ExcelProposal),
};

// ───────────────────────── drawio ─────────────────────────

export interface DrawioProposalOp {
  op: 'add' | 'update' | 'delete' | 'move';
  cellId?: string; // update/delete/move 的目标 mxCell id;add 时为新节点 id
  page?: number; // diagram 序号,默认 0
  value?: string;
  style?: string;
  parent?: string;
  source?: string;
  target?: string;
  vertex?: boolean;
  edge?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
export interface DrawioProposal {
  plan: string;
  ops: DrawioProposalOp[];
}

const defined = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

function buildDrawioChangeSet(req: ProposeRequest, p: DrawioProposal): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits: Edit[] = [];
  p.ops.forEach((o, i) => {
    const aid = ('a' + i) as AnchorId;
    const page = o.page ?? 0;
    let elementId: string;
    let op: EditOp;
    switch (o.op) {
      case 'add': {
        const parent = o.parent ?? '1';
        elementId = o.cellId ?? 'add' + i; // 锚点指向【新建对象】本身(diff/审阅更清晰);父容器由 payload.parent 携带
        op = {
          family: 'object',
          kind: 'addObject',
          payload: {
            id: o.cellId ?? 'add' + i,
            value: o.value,
            style: o.style,
            vertex: o.vertex,
            edge: o.edge,
            parent,
            source: o.source,
            target: o.target,
            geometry: { x: o.x, y: o.y, width: o.width, height: o.height },
          },
        };
        break;
      }
      case 'update':
        elementId = o.cellId ?? '';
        op = { family: 'object', kind: 'setObjectProps', props: defined({ value: o.value, style: o.style }) };
        break;
      case 'delete':
        elementId = o.cellId ?? '';
        op = { family: 'object', kind: 'deleteObject' };
        break;
      case 'move':
        elementId = o.cellId ?? '';
        op = { family: 'object', kind: 'moveObject', box: { left: o.x, top: o.y, width: o.width, height: o.height } };
        break;
      default:
        throw new Error(`drawio dialect: unknown op ${(o as { op: string }).op}`);
    }
    anchors[aid] = {
      id: aid,
      hostId: req.hostId as HostId,
      kind: 'object',
      ref: null,
      baseRev: req.baseRev,
      portable: { kind: 'object', slide: page, elementId },
    };
    edits.push({ id: 'e' + i, target: aid, op });
  });
  return newChangeSet(req, p.plan, anchors, edits);
}

export const drawioDialect: HostDialect = {
  format: 'drawio',
  systemPrompt:
    '你是一个 drawio 流程图编辑 Agent。把用户意图转成一组按 mxCell id 的操作,只能通过 propose_changeset 工具提交。' +
    'op:add(新增节点/边)、update(改 value/style)、delete(删,自动级联删边)、move(改 x/y/width/height)。\n' +
    '【画图要点 —— 务必产出一张真正可用的图,而不是几个空盒子】:\n' +
    '① 每个节点都要给 cellId(唯一,如 n1/n2…)、value(节点上显示的文字,必填,别留空)、vertex:true、以及 x/y/width/height;\n' +
    '② 坐标系:画布左上为原点,x 向右、y 向下,单位 px。节点【不要重叠】:同一列纵向叠放时,相邻节点 y 间隔 ≥ height+40;典型节点 width 160、height 48;"在左边" → x 取 40~120;\n' +
    '③ 连接关系用 add + edge:true + source/target(两端节点的 cellId)表达,把流程/层级真正连起来;\n' +
    '④ 文字用 value 字段(中文直接写),形状用 style(如 rounded=1;fillColor=#dae8fc; 或 ellipse; / rhombus;)。\n' +
    '示例(竖直叠放两层并连线):ops=[' +
    '{op:"add",cellId:"n1",value:"应用层",vertex:true,x:60,y:40,width:160,height:48,style:"rounded=1;fillColor=#dae8fc;"},' +
    '{op:"add",cellId:"n2",value:"表示层",vertex:true,x:60,y:128,width:160,height:48,style:"rounded=1;fillColor=#dae8fc;"},' +
    '{op:"add",cellId:"e1",edge:true,source:"n1",target:"n2"}]。\n' +
    '不直接执行,改动交用户逐条审阅。先给一句话 plan,再给 ops。',
  toolName: 'propose_changeset',
  toolDescription: '提出对所选 drawio 节点/连线的修改建议(不直接执行,交用户审阅)。按 mxCell id 操作。',
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: '一句话说明你打算做什么' },
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['add', 'update', 'delete', 'move'] },
            cellId: { type: 'string', description: 'update/delete/move 的目标 mxCell id;add 时为新节点 id' },
            page: { type: 'number', description: 'diagram 序号,默认 0' },
            value: { type: 'string', description: '节点/边的文字' },
            style: { type: 'string', description: 'drawio 样式串,如 rounded=1;fillColor=#dae8fc;' },
            parent: { type: 'string' },
            source: { type: 'string', description: '边的起点 cell id' },
            target: { type: 'string', description: '边的终点 cell id' },
            vertex: { type: 'boolean' },
            edge: { type: 'boolean' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['op'],
        },
      },
    },
    required: ['plan', 'ops'],
  },
  buildChangeSet: (req, proposal) => buildDrawioChangeSet(req, proposal as DrawioProposal),
};

// ───────────────────────── Word ─────────────────────────

export interface WordProposal {
  plan: string;
  edits: Array<{ quote: string; replacement: string }>;
}

function buildWordChangeSet(req: ProposeRequest, p: WordProposal): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits: Edit[] = [];
  p.edits.forEach((e, i) => {
    const aid = ('a' + i) as AnchorId;
    anchors[aid] = {
      id: aid,
      hostId: req.hostId as HostId,
      kind: 'flow',
      ref: null,
      baseRev: req.baseRev,
      portable: { kind: 'flow', path: [i], quote: { prefix: '', text: e.quote, suffix: '' }, bias: 'left' },
    };
    edits.push({ id: 'e' + i, target: aid, op: { family: 'text', kind: 'replaceText', text: e.replacement } });
  });
  return newChangeSet(req, p.plan, anchors, edits);
}

export const wordDialect: HostDialect = {
  format: 'word',
  systemPrompt:
    '你是一个 Word 正文编辑 Agent。用户在文档里圈选了文字,把意图转成一组"原文 → 改后"的替换建议,' +
    '只能通过 propose_changeset 工具提交。规则:① quote 必须是文档中真实存在、足以唯一定位的原文片段;' +
    '② replacement 是改后的整段文字;③ 改动会落成 Word 原生修订(可逐条接受/拒绝),不直接覆盖。先给一句话 plan,再给 edits。',
  toolName: 'propose_changeset',
  toolDescription: '提出对所选 Word 文本的替换建议(落成可审阅修订)。给 quote(原文)与 replacement(改后)。',
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: '一句话说明你打算做什么' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            quote: { type: 'string', description: '文档中真实存在的原文片段(用于定位)' },
            replacement: { type: 'string', description: '改后的文字' },
          },
          required: ['quote', 'replacement'],
        },
      },
    },
    required: ['plan', 'edits'],
  },
  buildChangeSet: (req, proposal) => buildWordChangeSet(req, proposal as WordProposal),
};

// ───────────────────────── PDF ─────────────────────────

export interface PdfProposal {
  plan: string;
  edits: Array<{ field: string; value: string }>;
}

function buildPdfChangeSet(req: ProposeRequest, p: PdfProposal): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits: Edit[] = [];
  p.edits.forEach((e, i) => {
    const aid = ('a' + i) as AnchorId;
    anchors[aid] = {
      id: aid,
      hostId: req.hostId as HostId,
      kind: 'object',
      ref: null,
      baseRev: req.baseRev,
      portable: { kind: 'object', slide: 0, elementId: e.field },
    };
    edits.push({ id: 'e' + i, target: aid, op: { family: 'value', kind: 'setValue', value: e.value } });
  });
  return newChangeSet(req, p.plan, anchors, edits);
}

export const pdfDialect: HostDialect = {
  format: 'pdf',
  systemPrompt:
    '你是一个 PDF 表单填写 Agent。用户要填一份带 AcroForm 表单字段的 PDF,把意图转成一组"字段名 → 值"的填写建议,' +
    '只能通过 propose_changeset 工具提交。规则:① field 必须是表单里真实存在的字段名;② value 是要填入的文本;' +
    '③ 改动交用户逐条审阅后才落盘,只改字段值、不动页面内容。先给一句话 plan,再给 edits。',
  toolName: 'propose_changeset',
  toolDescription: '提出对 PDF 表单字段的填写建议(只改字段值,交用户审阅)。给 field(字段名)与 value(值)。',
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: '一句话说明你打算做什么' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'AcroForm 表单字段名' },
            value: { type: 'string', description: '要填入的文本' },
          },
          required: ['field', 'value'],
        },
      },
    },
    required: ['plan', 'edits'],
  },
  buildChangeSet: (req, proposal) => buildPdfChangeSet(req, proposal as PdfProposal),
};

// ───────────────────────── PPT ─────────────────────────

export interface PptProposal {
  plan: string;
  edits: Array<{ slide: number; find: string; replace: string }>;
}

function buildPptChangeSet(req: ProposeRequest, p: PptProposal): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits: Edit[] = [];
  p.edits.forEach((e, i) => {
    const aid = ('a' + i) as AnchorId;
    anchors[aid] = {
      id: aid,
      hostId: req.hostId as HostId,
      kind: 'flow',
      ref: null,
      baseRev: req.baseRev,
      portable: { kind: 'flow', path: [e.slide], quote: { prefix: '', text: e.find, suffix: '' }, bias: 'left' },
    };
    edits.push({ id: 'e' + i, target: aid, op: { family: 'text', kind: 'replaceText', text: e.replace } });
  });
  return newChangeSet(req, p.plan, anchors, edits);
}

export const pptDialect: HostDialect = {
  format: 'ppt',
  systemPrompt:
    '你是一个 PowerPoint 正文编辑 Agent。用户要改某页幻灯片上的文字,把意图转成一组"幻灯片序号 + 原文 → 改后"的替换建议,' +
    '只能通过 propose_changeset 工具提交。规则:① slide 是从 0 开始的幻灯片序号;② find 是该页真实存在的文字片段;' +
    '③ replace 是改后的文字;④ 改动交用户逐条审阅后才落盘,只改命中文本、其余字节不变。先给一句话 plan,再给 edits。',
  toolName: 'propose_changeset',
  toolDescription: '提出对 PPT 幻灯片文字的替换建议(交用户审阅)。给 slide(序号,从0起)、find(原文)、replace(改后)。',
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: '一句话说明你打算做什么' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slide: { type: 'number', description: '幻灯片序号,从 0 开始' },
            find: { type: 'string', description: '该页真实存在的原文片段' },
            replace: { type: 'string', description: '改后的文字' },
          },
          required: ['slide', 'find', 'replace'],
        },
      },
    },
    required: ['plan', 'edits'],
  },
  buildChangeSet: (req, proposal) => buildPptChangeSet(req, proposal as PptProposal),
};

export const DIALECTS: Record<string, HostDialect> = {
  excel: excelDialect,
  drawio: drawioDialect,
  word: wordDialect,
  docx: wordDialect,
  pdf: pdfDialect,
  ppt: pptDialect,
  pptx: pptDialect,
};
