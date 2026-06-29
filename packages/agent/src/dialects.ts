/**
 * Host 方言:Excel(A1 + setValue/setFormula)与 drawio(mxCell id + add/update/delete/move)。
 * 每种格式有自己的系统提示、工具 schema、原始提案 → ChangeSet 的构造。
 */
import type { AnchorId, CellValue, ChangeSet, Edit, EditOp, HostId, LogicalAnchor } from '@otterpatch/core';
import type { HostDialect, ProposeRequest } from './model.js';
import {
  EXCEL_SYSTEM, EXCEL_TOOL_DESC, DRAWIO_SYSTEM, DRAWIO_TOOL_DESC,
  WORD_SYSTEM, WORD_TOOL_DESC, PDF_SYSTEM, PDF_TOOL_DESC, PPT_SYSTEM, PPT_TOOL_DESC,
} from './prompts/index.js';

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
/** Excel 支持的操作(单一事实源:schema 与 serve 启动横幅都用它,便于核对 serve 是否最新)。 */
export const EXCEL_OPS = [
  'setValue', 'setFormula', 'setStyle', 'setNumberFormat',
  'insertRows', 'deleteRows', 'insertCols', 'deleteCols',
  'merge', 'unmerge', 'freeze', 'clear', 'sort',
  'condFormat', 'dataValidation', 'filter', 'chart',
] as const;
export type ExcelOp = (typeof EXCEL_OPS)[number];
export type CondWhen = 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'between' | 'equalTo' | 'textContains' | 'notEmpty' | 'formula';
export type DvKind = 'list' | 'numberBetween' | 'numberGreaterThan' | 'checkbox' | 'dateBetween';
export interface ExcelProposal {
  plan: string;
  edits: Array<{
    cell: string;
    op: ExcelOp;
    value?: CellValue;
    formula?: string;
    style?: ExcelStyle;
    pattern?: string; // setNumberFormat 的数字格式,如 0% / "¥"#,##0.00
    count?: number; // insert/delete 行列数
    before?: boolean; // insert 在目标前
    rows?: number; // freeze 冻结行数
    cols?: number; // freeze 冻结列数
    by?: number; // sort 依据列(范围内 0 基)
    asc?: boolean; // sort 升序
    when?: CondWhen; // condFormat 条件
    v1?: number | string; // condFormat 操作数1 / between 下界
    v2?: number; // condFormat between 上界
    rule?: DvKind; // dataValidation 类型
    list?: string[]; // dataValidation 下拉选项
    min?: number; // dataValidation numberBetween 下界
    max?: number; // dataValidation numberBetween 上界
    v?: number; // dataValidation numberGreaterThan 阈值
    chartType?: 'bar' | 'line' | 'pie'; // chart 图表类型
    title?: string; // chart 标题
  }>;
}

function sheetOf(cell: string): string {
  const i = cell.indexOf('!');
  return i >= 0 ? cell.slice(0, i).replace(/^'|'$/g, '') : 'Sheet1';
}

function buildExcelChangeSet(req: ProposeRequest, p: ExcelProposal): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits: Edit[] = [];
  (p.edits ?? []).forEach((e, i) => {
    const aid = ('a' + i) as AnchorId;
    anchors[aid] = {
      id: aid,
      hostId: req.hostId as HostId,
      kind: 'grid',
      ref: null,
      baseRev: req.baseRev,
      portable: { kind: 'grid', sheet: sheetOf(e.cell), a1: e.cell },
    };
    let op: EditOp;
    switch (e.op) {
      case 'setFormula': op = { family: 'value', kind: 'setFormula', formula: e.formula ?? '' }; break;
      case 'setStyle': op = { family: 'style', kind: 'setStyle', style: e.style ?? {} }; break;
      case 'setNumberFormat': op = { family: 'style', kind: 'setNumberFormat', pattern: e.pattern ?? 'General' }; break;
      case 'insertRows': op = { family: 'structure', kind: 'insertRows', count: e.count ?? 1, before: e.before ?? true }; break;
      case 'deleteRows': op = { family: 'structure', kind: 'deleteRows', count: e.count ?? 1 }; break;
      case 'insertCols': op = { family: 'structure', kind: 'insertCols', count: e.count ?? 1, before: e.before ?? true }; break;
      case 'deleteCols': op = { family: 'structure', kind: 'deleteCols', count: e.count ?? 1 }; break;
      case 'merge': op = { family: 'structure', kind: 'mergeCells' }; break;
      case 'unmerge': op = { family: 'structure', kind: 'unmergeCells' }; break;
      case 'freeze': op = { family: 'structure', kind: 'freezePanes', rows: e.rows ?? 1, cols: e.cols ?? 0 }; break;
      case 'sort': op = { family: 'structure', kind: 'sortRange', by: e.by ?? 0, asc: e.asc ?? true }; break;
      case 'condFormat': op = { family: 'style', kind: 'conditionalFormat', when: e.when ?? 'notEmpty', ...(e.v1 != null ? { v1: e.v1 } : {}), ...(e.v2 != null ? { v2: e.v2 } : {}), style: e.style ?? {} }; break;
      case 'dataValidation': op = { family: 'style', kind: 'dataValidation', rule: e.rule ?? 'list', ...(e.list ? { list: e.list } : {}), ...(e.min != null ? { min: e.min } : {}), ...(e.max != null ? { max: e.max } : {}), ...(e.v != null ? { v: e.v } : {}) }; break;
      case 'filter': op = { family: 'structure', kind: 'autoFilter' }; break;
      case 'chart': op = { family: 'object', kind: 'insertChart', chartType: e.chartType ?? 'bar', range: e.cell, title: e.title ?? '图表' }; break;
      case 'clear': op = { family: 'value', kind: 'deleteRange' }; break;
      default: op = { family: 'value', kind: 'setValue', value: (e.value ?? null) as CellValue };
    }
    edits.push({ id: 'e' + i, target: aid, op });
  });
  return newChangeSet(req, p.plan, anchors, edits);
}

export const excelDialect: HostDialect = {
  format: 'excel',
  systemPrompt: EXCEL_SYSTEM,
  toolName: 'propose_changeset',
  toolDescription: EXCEL_TOOL_DESC,
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: '一句话说明你打算做什么' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            cell: { type: 'string', description: 'A1 引用:单格如 B2;范围如 A1:C3(merge/clear/sort 用范围);插删行用该行任一格(如 A5),插删列用该列任一格(如 C1);freeze 用 A1' },
            op: { type: 'string', enum: [...EXCEL_OPS] },
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
            count: { type: 'number', description: 'insert/delete 行列的数量(默认 1)' },
            before: { type: 'boolean', description: 'insertRows/insertCols 在目标行/列之前插入(默认 true)' },
            rows: { type: 'number', description: 'freeze 冻结的行数' },
            cols: { type: 'number', description: 'freeze 冻结的列数' },
            by: { type: 'number', description: 'sort 排序依据列(范围内从 0 起)' },
            asc: { type: 'boolean', description: 'sort 升序(默认 true)' },
            when: { type: 'string', enum: ['greaterThan', 'greaterThanOrEqual', 'lessThan', 'between', 'equalTo', 'textContains', 'notEmpty', 'formula'], description: 'condFormat 条件;配合 style 给满足条件的格式' },
            v1: { description: 'condFormat 操作数(>、<、=、between 下界、textContains 文本、formula 公式)' },
            v2: { type: 'number', description: 'condFormat between 的上界' },
            rule: { type: 'string', enum: ['list', 'numberBetween', 'numberGreaterThan', 'checkbox', 'dateBetween'], description: 'dataValidation 类型' },
            list: { type: 'array', items: { type: 'string' }, description: 'dataValidation=list 的下拉选项' },
            min: { type: 'number', description: 'dataValidation numberBetween 下界' },
            max: { type: 'number', description: 'dataValidation numberBetween 上界' },
            v: { type: 'number', description: 'dataValidation numberGreaterThan 阈值' },
            chartType: { type: 'string', enum: ['bar', 'line', 'pie'], description: 'chart 图表类型' },
            title: { type: 'string', description: 'chart 标题' },
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
  (p.ops ?? []).forEach((o, i) => {
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
  systemPrompt: DRAWIO_SYSTEM,
  toolName: 'propose_changeset',
  toolDescription: DRAWIO_TOOL_DESC,
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
  (p.edits ?? []).forEach((e, i) => {
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
  systemPrompt: WORD_SYSTEM,
  toolName: 'propose_changeset',
  toolDescription: WORD_TOOL_DESC,
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
  (p.edits ?? []).forEach((e, i) => {
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
  systemPrompt: PDF_SYSTEM,
  toolName: 'propose_changeset',
  toolDescription: PDF_TOOL_DESC,
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
  (p.edits ?? []).forEach((e, i) => {
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
  systemPrompt: PPT_SYSTEM,
  toolName: 'propose_changeset',
  toolDescription: PPT_TOOL_DESC,
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
