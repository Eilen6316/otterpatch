/**
 * Host dialects: Excel (A1 + setValue/setFormula) and drawio (mxCell id + add/update/delete/move).
 * Each format has its own system prompt, tool schema, and raw-proposal → ChangeSet construction.
 */
import { RESOURCE_LIMITS, ResourceLimitError, proposalOperationNamesFor } from '@otterpatch/core';
import type { AnchorId, CellValue, ChangeSet, Edit, EditOp, EditOpKind, HostId, LogicalAnchor } from '@otterpatch/core';
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

function assertProposalItemCount(items: readonly unknown[]): void {
  if (items.length > RESOURCE_LIMITS.changeSetEdits) {
    throw new ResourceLimitError('changeset_edits', RESOURCE_LIMITS.changeSetEdits, items.length);
  }
}

// ───────────────────────── Excel ─────────────────────────

export interface ExcelStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string; // font color
  bgColor?: string; // fill/background color (red-flag highlighting means bgColor)
  align?: 'left' | 'center' | 'right';
}
const EXCEL_OP_BY_NAME = {
  setValue: 'setValue',
  setFormula: 'setFormula',
  setStyle: 'setStyle',
  setNumberFormat: 'setNumberFormat',
  clear: 'deleteRange',
} as const satisfies Record<string, EditOpKind>;
export type ExcelOp = keyof typeof EXCEL_OP_BY_NAME;
export const EXCEL_OPS = proposalOperationNamesFor('excel') as ExcelOp[];
if (EXCEL_OPS.some((op) => !(op in EXCEL_OP_BY_NAME))) throw new Error('Excel capability manifest has no dialect mapping');
export interface ExcelProposal {
  plan: string;
  edits: Array<{
    cell: string;
    op: ExcelOp;
    value?: CellValue;
    formula?: string;
    style?: ExcelStyle;
    pattern?: string; // setNumberFormat number format, e.g. 0% / "¥"#,##0.00
  }>;
}

function sheetOf(cell: string): string {
  const i = cell.indexOf('!');
  return i >= 0 ? cell.slice(0, i).replace(/^'|'$/g, '') : 'Sheet1';
}

function buildExcelChangeSet(req: ProposeRequest, p: ExcelProposal): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits: Edit[] = [];
  assertProposalItemCount(p.edits ?? []);
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
      case 'clear': op = { family: 'value', kind: 'deleteRange' }; break;
      case 'setValue': op = { family: 'value', kind: 'setValue', value: (e.value ?? null) as CellValue }; break;
      default: throw new Error('excel dialect: unknown op ' + (e as { op: string }).op);
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
        maxItems: RESOURCE_LIMITS.changeSetEdits,
        items: {
          type: 'object',
          properties: {
            cell: { type: 'string', description: 'A1 引用:单格如 B2;setStyle/setNumberFormat/clear 可用范围如 A1:C3;多表必须带真实表名前缀如 Sheet2!B3' },
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
  cellId?: string; // target mxCell id for update/delete/move; new node id for add
  page?: number; // diagram index, defaults to 0
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
  assertProposalItemCount(p.ops ?? []);
  (p.ops ?? []).forEach((o, i) => {
    const aid = ('a' + i) as AnchorId;
    const page = o.page ?? 0;
    let elementId: string;
    let op: EditOp;
    switch (o.op) {
      case 'add': {
        const parent = o.parent ?? '1';
        elementId = o.cellId ?? 'add' + i; // anchor points at the newly created object itself (clearer diff/review); parent container is carried via payload.parent
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
        maxItems: RESOURCE_LIMITS.changeSetEdits,
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
  edits: Array<{
    quote: string;
    /** 1-based paragraph number (from context/read_blocks) — anchors empty or non-unique paragraphs where quote can't; quote may be '' */
    para?: number;
    /** Structural: delete the whole paragraph at para/quote (empty-paragraph cleanup, redundant blocks) */
    deletePara?: boolean;
    /** Image op on the image inside the anchored paragraph: remove it, or resize to imgWidth px */
    img?: 'remove' | 'resize';
    imgWidth?: number;
    /** Real Word table. Every row must have the same number of string cells. */
    table?: string[][];
    tableHeaderRows?: number;
    tableAt?: 'before' | 'after' | 'end';
    replacement?: string; // text rewrite: if given, replaces the original text
    // Formatting (any present = format edit, replacement not needed).
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    font?: string;
    size?: number;
    color?: string;
    // Paragraph-level formatting (applies to the whole paragraph containing quote)
    align?: 'left' | 'center' | 'right' | 'justify';
    lineSpacing?: number; // line spacing multiple: 1 / 1.5 / 2
    bgColor?: string; // paragraph shading color
    block?: 'h1' | 'h2' | 'h3' | 'p' | 'blockquote'; // paragraph style: heading 1-3 / body / blockquote
    // Page-level: columns / margins / orientation use an empty document anchor.
    columns?: number;
    margin?: 'narrow' | 'normal' | 'moderate' | 'wide';
    orient?: 'portrait' | 'landscape';
  }>;
}

function buildWordChangeSet(req: ProposeRequest, p: WordProposal): ChangeSet {
  const anchors: Record<AnchorId, LogicalAnchor> = {};
  const edits: Edit[] = [];
  assertProposalItemCount(p.edits ?? []);
  (p.edits ?? []).forEach((e, i) => {
    const aid = ('a' + i) as AnchorId;
    const quoteText = e.quote ?? '';
    anchors[aid] = {
      id: aid,
      hostId: req.hostId as HostId,
      kind: 'flow',
      ref: null,
      baseRev: req.baseRev,
      // path 携带显式段号(0-based;仅当模型给了 para)——前端 quote 定位失败/空段落时按段号落锚
      portable: { kind: 'flow', path: e.para != null && e.para >= 1 ? [e.para - 1] : [], quote: { prefix: '', text: quoteText, suffix: '' }, bias: 'left' },
    };
    const isFormat = !e.deletePara && !e.img && !e.table && e.replacement == null && (e.bold != null || e.italic != null || e.underline != null || e.font != null || e.size != null || e.color != null || e.align != null || e.lineSpacing != null || e.bgColor != null || e.block != null || e.columns != null || e.margin != null || e.orient != null);
    const op: EditOp = e.table
      ? {
          family: 'structure',
          kind: 'insertTable',
          rows: e.table,
          headerRows: e.tableHeaderRows ?? 1,
          at: e.tableAt ?? (quoteText || e.para != null ? 'after' : 'end'),
        }
      : e.deletePara
      ? { family: 'value', kind: 'deleteRange' }
      : e.img
      ? { family: 'object', kind: 'setObjectProps', props: { imgAction: e.img, ...(e.imgWidth != null ? { width: e.imgWidth } : {}) } }
      : isFormat
      ? {
          family: 'style',
          kind: 'setStyle',
          style: {
            ...(e.bold != null ? { bold: e.bold } : {}),
            ...(e.italic != null ? { italic: e.italic } : {}),
            ...(e.underline != null ? { underline: e.underline } : {}),
            ...(e.font != null ? { font: e.font } : {}),
            ...(e.size != null ? { size: e.size } : {}),
            ...(e.color != null ? { color: e.color } : {}),
            ...(e.align != null ? { align: e.align } : {}),
            ...(e.lineSpacing != null ? { lineSpacing: e.lineSpacing } : {}),
            ...(e.bgColor != null ? { bgColor: e.bgColor } : {}),
            ...(e.block != null ? { block: e.block } : {}),
            ...(e.columns != null ? { columns: e.columns } : {}),
            ...(e.margin != null ? { margin: e.margin } : {}),
            ...(e.orient != null ? { orient: e.orient } : {}),
          },
        }
      : { family: 'text', kind: 'replaceText', text: e.replacement ?? '' };
    edits.push({ id: 'e' + i, target: aid, op });
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
        maxItems: RESOURCE_LIMITS.changeSetEdits,
        items: {
          type: 'object',
          properties: {
            quote: { type: 'string', description: '文档中真实存在的原文片段(用于定位);局部格式也必须用它选中目标。页面设置使用空串;空段落或无法唯一定位时给空串并用 para 段号锚定' },
            para: { type: 'number', description: '段号(1-based,即上下文/read_blocks 里的"第N段")。空段落、重复文本等 quote 无法唯一定位时用它锚定整段;给了 para 时 quote 可为空串' },
            deletePara: { type: 'boolean', description: '结构操作:true=删除 para(或 quote)所在的整段(清理空段落/删除冗余段落)。不要同时给 replacement 或格式字段' },
            img: { type: 'string', enum: ['remove', 'resize'], description: '图片操作:对锚定段落里的图片(上下文标注为 [图片 …] 的段)remove=删除该图 / resize=调宽(配 imgWidth)。锚定用 para 段号或该段 quote' },
            imgWidth: { type: 'number', description: '配合 img=resize:图片目标宽度(像素),高度等比' },
            table: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              description: '插入真实 Word 表格的二维字符串数组。每个内层数组是一行,列数必须一致;不要用竖线文本伪造表格',
              items: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', maxLength: 10_000 } },
            },
            tableHeaderRows: { type: 'integer', minimum: 0, maximum: 100, description: '表头行数,默认 1;无表头给 0' },
            tableAt: { type: 'string', enum: ['before', 'after', 'end'], description: '表格插入位置:end=文档末尾(quote 给空串);before/after=锚定段前/后(须 quote 或 para)' },
            replacement: { type: 'string', description: '文本改写:改后的文字(给了它即为"替换原文"。要改格式就别给它)' },
            bold: { type: 'boolean', description: '加粗:true 设为加粗、false 取消加粗' },
            italic: { type: 'boolean', description: '斜体' },
            underline: { type: 'boolean', description: '下划线' },
            font: { type: 'string', description: '字体名,如 宋体 / 黑体 / Arial' },
            size: { type: 'number', description: '字号(磅);如 五号≈10.5、小四≈12、四号≈14、三号≈16' },
            color: { type: 'string', description: '字体颜色,如 #c00000' },
            align: { type: 'string', enum: ['left', 'center', 'right', 'justify'], description: '段落对齐(作用于 quote 所在整段):左/居中/右/两端对齐' },
            lineSpacing: { type: 'number', description: '行距倍数(作用于整段),如 1 / 1.5 / 2' },
            bgColor: { type: 'string', description: '段落底纹色,如 #fff3cd' },
            block: { type: 'string', enum: ['h1', 'h2', 'h3', 'p', 'blockquote'], description: '段落样式:h1/h2/h3=标题1/2/3、p=正文、blockquote=引用(如"把这行设为标题2""这段改成引用")' },
            columns: { type: 'number', enum: [1, 2, 3], description: '【页面级,须 quote="" 且不带局部格式字段】分栏数:2=双栏、1=恢复单栏' },
            margin: { type: 'string', enum: ['narrow', 'normal', 'moderate', 'wide'], description: '【页面级,须 quote="" 且不带局部格式字段】页边距预设' },
            orient: { type: 'string', enum: ['portrait', 'landscape'], description: '【页面级,须 quote="" 且不带局部格式字段】纸张方向' },
          },
          required: ['quote'],
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
  assertProposalItemCount(p.edits ?? []);
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
        maxItems: RESOURCE_LIMITS.changeSetEdits,
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
  assertProposalItemCount(p.edits ?? []);
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
        maxItems: RESOURCE_LIMITS.changeSetEdits,
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
