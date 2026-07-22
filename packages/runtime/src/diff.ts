/**
 * Reviewable diff rendering. Actual before/after values come only from a format
 * engine's shadow result. Proposal-derived values are kept in a separate field so
 * callers can distinguish an intended edit from an observed preview.
 */
import {
  a1RangeCellCount,
  assessChangeSet,
  supportsFormatOperation,
  type AbstractStyle,
  type ChangeSet,
  type ChangeSetRiskContext,
  type Edit,
  type EditOp,
  type LogicalAnchor,
  type MergeConflict,
  type PreviewValue,
  type ShadowResult,
} from '@otterpatch/core';

export type DiffBadge = 'add' | 'remove' | 'modify' | 'move' | 'conflict';
export type DiffSupport = 'verified' | 'partial' | 'unsupported';
export type DiffPreviewStatus = 'verified' | 'partial' | 'unavailable';

export interface OtterPatchDiffEffect {
  target: string;
  kind: 'direct' | 'formula-recalculation' | 'reflow';
  summary: string;
  before?: PreviewValue;
  after?: PreviewValue;
  editIds?: string[];
}

export interface OtterPatchDiffItem {
  editId: string;
  ref: string;
  kind: string;
  badge: DiffBadge;
  label: string;
  /** Observed values from shadow execution. Absent when the operation was not simulated. */
  before?: PreviewValue;
  after?: PreviewValue;
  /** Intended value from the ChangeSet. This is never presented as an observed result. */
  proposedAfter?: PreviewValue;
  proposalSummary?: string;
  style?: AbstractStyle;
  directEffects: OtterPatchDiffEffect[];
  indirectEffects: OtterPatchDiffEffect[];
  affectedCount: number;
  boundary: string;
  sample: OtterPatchDiffEffect[];
  summary: string;
  conflicts: MergeConflict[];
  backendSupport: DiffSupport;
  risk: {
    level: 'safe' | 'caution' | 'destructive';
    reasons: string[];
  };
  expectedTouchedParts: string[];
}

export interface OtterPatchDiff {
  changeSetId: string;
  hostId: string;
  format: string;
  intent: string;
  previewStatus: DiffPreviewStatus;
  source: 'shadow' | 'unavailable';
  unavailableReason?: string;
  summary: string;
  affectedCount: number;
  boundary: string[];
  sample: OtterPatchDiffEffect[];
  conflicts: MergeConflict[];
  indirectEffects: OtterPatchDiffEffect[];
  backendSupport: DiffSupport;
  expectedTouchedParts: string[];
  items: OtterPatchDiffItem[];
}

export interface DiffObservation {
  format: string;
  shadow?: ShadowResult;
  supportByEdit?: Readonly<Record<string, DiffSupport>>;
  indirectEffects?: readonly OtterPatchDiffEffect[];
  unavailableReason?: string;
  riskContext?: ChangeSetRiskContext;
}

const BLOCK_NAME: Record<string, string> = { h1: '标题1', h2: '标题2', h3: '标题3', p: '正文', blockquote: '引用' };
const ALIGN_NAME: Record<string, string> = { left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' };
const MARGIN_NAME: Record<string, string> = { narrow: '窄', normal: '常规', moderate: '适中', wide: '宽' };

function styleSummary(style: AbstractStyle): string {
  const parts: string[] = [];
  if (style.block) parts.push('段落样式 ' + (BLOCK_NAME[style.block] ?? style.block));
  if (style.font) parts.push('字体 ' + style.font);
  if (style.size !== undefined) parts.push('字号 ' + style.size);
  if (style.bgColor !== undefined) parts.push('填充 ' + style.bgColor);
  if (style.color !== undefined) parts.push('字色 ' + style.color);
  if (style.bold !== undefined) parts.push(style.bold ? '加粗' : '取消加粗');
  if (style.italic !== undefined) parts.push(style.italic ? '斜体' : '取消斜体');
  if (style.underline !== undefined) parts.push(style.underline ? '下划线' : '取消下划线');
  if (style.align) parts.push(ALIGN_NAME[style.align] ?? '对齐 ' + style.align);
  if (style.lineSpacing !== undefined) parts.push('行距 ' + style.lineSpacing);
  if (style.columns !== undefined) parts.push(style.columns <= 1 ? '单栏' : style.columns + ' 栏');
  if (style.margin) parts.push((MARGIN_NAME[style.margin] ?? style.margin) + '边距');
  if (style.orient) parts.push(style.orient === 'landscape' ? '横向纸张' : '纵向纸张');
  if (style.numberFormat !== undefined) parts.push('数字格式 ' + style.numberFormat);
  return parts.join(' · ') || '套用格式';
}

function refOf(anchor: LogicalAnchor | undefined, fallback: string): string {
  if (!anchor) return fallback;
  const portable = anchor.portable;
  switch (portable.kind) {
    case 'grid':
      return portable.a1.includes('!') ? portable.a1 : `${portable.sheet}!${portable.a1}`;
    case 'object':
      return portable.elementId;
    case 'flow':
      return portable.quote.text ? portable.quote.text.slice(0, 24) : portable.path[0] != null ? `第${portable.path[0] + 1}段` : fallback;
    case 'composite':
      return 'composite';
  }
}

function boundedJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return String(value);
    return encoded.length > 160 ? encoded.slice(0, 157) + '...' : encoded;
  } catch {
    return '[unserializable payload]';
  }
}

function describe(op: EditOp): { badge: DiffBadge; label: string; proposalSummary?: string; style?: AbstractStyle } {
  switch (op.kind) {
    case 'setValue':
      return { badge: 'modify', label: 'set value', proposalSummary: displayCellValue(op.value) };
    case 'setFormula':
      return { badge: 'modify', label: 'set formula', proposalSummary: op.formula };
    case 'replaceText':
      return { badge: 'modify', label: 'replace text', proposalSummary: op.text };
    case 'insertText':
      return { badge: 'add', label: `insert text (${op.at})`, proposalSummary: op.text };
    case 'deleteRange':
      return { badge: 'remove', label: '删除该段/该区域', proposalSummary: 'null' };
    case 'setStyle': {
      const summary = styleSummary(op.style);
      return { badge: 'modify', label: summary, proposalSummary: summary, style: op.style };
    }
    case 'setNumberFormat':
      return { badge: 'modify', label: '数字格式 ' + op.pattern, proposalSummary: op.pattern, style: { numberFormat: op.pattern } };
    case 'insertRows':
      return { badge: 'add', label: `插入 ${op.count} 行` };
    case 'deleteRows':
      return { badge: 'remove', label: `删除 ${op.count ?? 1} 行` };
    case 'sortRange':
      return { badge: 'modify', label: `按第 ${op.by + 1} 列${op.asc ? '升序' : '降序'}排序` };
    case 'insertCols':
      return { badge: 'add', label: `插入 ${op.count} 列` };
    case 'deleteCols':
      return { badge: 'remove', label: `删除 ${op.count ?? 1} 列` };
    case 'mergeCells':
      return { badge: 'modify', label: '合并单元格' };
    case 'unmergeCells':
      return { badge: 'modify', label: '取消合并' };
    case 'freezePanes':
      return { badge: 'modify', label: `冻结 ${op.rows} 行 / ${op.cols} 列` };
    case 'addSheet':
      return { badge: 'add', label: `新建工作表「${op.name}」` };
    case 'copyRange':
      return { badge: 'add', label: `整块复制 → ${op.to}(值/公式/数字格式)` };
    case 'autoFilter':
      return { badge: 'modify', label: '自动筛选' };
    case 'insertChart': {
      const kind = op.chartType === 'pie' ? '饼' : op.chartType === 'line' ? '折线' : '柱状';
      const data = op.categories?.length
        ? `${op.categories.length} 类 · ${(op.series ?? []).map((series) => series.name).join('/') || '系列'}`
        : `数据 ${op.range ?? ''}`;
      return { badge: 'add', label: `插入${kind}图「${op.title}」(${data})`, proposalSummary: `${kind}图「${op.title}」· ${data}` };
    }
    case 'insertTable': {
      const columns = op.rows[0]?.length ?? 0;
      const header = op.headerRows > 0 ? ` · ${op.headerRows} 行表头` : '';
      return { badge: 'add', label: `插入 ${op.rows.length}×${columns} 表格${header}`, proposalSummary: `${op.rows.length}×${columns} 表格` };
    }
    case 'conditionalFormat':
      return { badge: 'modify', label: `条件格式 ${op.when}${op.style.bgColor ? ' → 填充 ' + op.style.bgColor : ''}${op.style.color ? ' 字色 ' + op.style.color : ''}` };
    case 'dataValidation':
      return { badge: 'modify', label: `数据验证 ${op.rule}` };
    case 'setMark':
      return { badge: 'modify', label: `mark ${op.mark.type}` };
    case 'setParagraphStyle':
      return { badge: 'modify', label: `paragraph style ${op.styleName}` };
    case 'moveObject':
      return { badge: 'move', label: `move object ${boundedJson(op.box)}`, proposalSummary: boundedJson(op.box) };
    case 'setObjectProps': {
      const imageAction = (op.props as { imgAction?: string; width?: number }).imgAction;
      if (imageAction === 'remove') return { badge: 'remove', label: '删除图片' };
      if (imageAction === 'resize') return { badge: 'modify', label: `图片宽度 ${(op.props as { width?: number }).width ?? '?'}px` };
      return { badge: 'modify', label: 'set object properties', proposalSummary: boundedJson(op.props) };
    }
    case 'addObject': {
      const payload = (op.payload ?? {}) as { value?: string; edge?: boolean; source?: string; target?: string };
      if (payload.edge || (payload.source && payload.target)) return { badge: 'add', label: `连线 ${payload.source ?? '?'} → ${payload.target ?? '?'}` };
      return payload.value
        ? { badge: 'add', label: `新增节点「${payload.value}」`, proposalSummary: String(payload.value) }
        : { badge: 'add', label: '新增节点', proposalSummary: boundedJson(op.payload) };
    }
    case 'deleteObject':
      return { badge: 'remove', label: 'delete object' };
    case 'rawHost':
      return { badge: 'modify', label: `raw ${op.hostId}: ${boundedJson(op.payload)}`, proposalSummary: boundedJson(op.payload) };
  }
}

function displayCellValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === '') return '""';
  return String(value);
}

function proposedAfterOf(op: EditOp): PreviewValue | undefined {
  switch (op.kind) {
    case 'setValue':
      return { kind: 'cell', value: op.value };
    case 'setFormula':
      return { kind: 'cell', value: null, formula: op.formula };
    case 'deleteRange':
      return { kind: 'cell', value: null };
    case 'replaceText':
    case 'insertText':
      return { kind: 'text', runs: [{ text: op.text }] };
    default:
      return undefined;
  }
}

function flattenLeaves(shadow: ShadowResult | undefined): Array<ShadowResult['diff']['root']> {
  if (!shadow) return [];
  const leaves: Array<ShadowResult['diff']['root']> = [];
  const visit = (node: ShadowResult['diff']['root']): void => {
    if (node.level === 'leaf' || node.children.length === 0) leaves.push(node);
    else node.children.forEach(visit);
  };
  visit(shadow.diff.root);
  return leaves;
}

function affectedCountOf(edit: Edit, anchor: LogicalAnchor | undefined): number {
  if (!anchor) return 1;
  if (anchor.portable.kind === 'grid') return a1RangeCellCount(anchor.portable.a1) ?? 1;
  if (anchor.portable.kind === 'composite') return Math.max(1, anchor.portable.parts.length);
  if (edit.op.kind === 'setStyle' && (edit.op.style.columns !== undefined || edit.op.style.margin !== undefined || edit.op.style.orient !== undefined)) return 1;
  return 1;
}

function touchedPartsFor(format: string, edit: Edit, anchor: LogicalAnchor | undefined): string[] {
  const normalized = format.toLowerCase();
  if (normalized === 'excel' || normalized === 'xlsx') {
    const sheet = anchor?.portable.kind === 'grid' ? anchor.portable.sheet : 'unknown';
    const parts = [`worksheet[${sheet}]`];
    if (edit.op.kind === 'setStyle' || edit.op.kind === 'setNumberFormat') parts.push('xl/styles.xml');
    return parts;
  }
  if (normalized === 'word' || normalized === 'docx') return ['word/document.xml'];
  if (normalized === 'drawio') return ['drawio/diagram'];
  if (normalized === 'pdf') return ['pdf/AcroForm'];
  if (normalized === 'ppt' || normalized === 'pptx') return ['ppt/slides'];
  return ['unknown'];
}

function defaultSupport(format: string, edit: Edit, hasObservedNode: boolean): DiffSupport {
  const preview = supportsFormatOperation(format, edit.op.kind, 'preview');
  const writeback = supportsFormatOperation(format, edit.op.kind, 'writeback');
  if (!writeback) return 'unsupported';
  return hasObservedNode && preview ? 'verified' : 'partial';
}

function mergeRiskContext(
  cs: ChangeSet,
  observation: DiffObservation,
  nodesByEdit: ReadonlyMap<string, Array<ShadowResult['diff']['root']>>,
): ChangeSetRiskContext {
  const supplied = observation.riskContext ?? {};
  const byEdit: NonNullable<ChangeSetRiskContext['byEdit']> = { ...(supplied.byEdit ?? {}) };
  for (const edit of cs.edits) {
    const nodes = nodesByEdit.get(edit.id) ?? [];
    const beforeCells = nodes.map((node) => node.before).filter((value) => value.kind === 'cell');
    if (!beforeCells.length) continue;
    const existing = byEdit[edit.id] ?? {};
    const first = beforeCells[0]!;
    byEdit[edit.id] = {
      beforeState: beforeCells.length === 1
        ? { value: first.value, ...(first.formula !== undefined ? { formula: first.formula } : {}), ...(first.style ? { style: first.style } : {}) }
        : { sample: beforeCells.slice(0, 12), affectedCount: beforeCells.length },
      destinationOccupied: beforeCells.some((value) => value.formula !== undefined || value.value !== null),
      ...existing,
    };
  }
  const { byEdit: _ignored, ...global } = supplied;
  return { ...global, byEdit };
}

function supportSummary(values: readonly DiffSupport[]): DiffSupport {
  if (!values.length || values.every((value) => value === 'unsupported')) return 'unsupported';
  if (values.every((value) => value === 'verified')) return 'verified';
  return 'partial';
}

export function buildDiff(cs: ChangeSet, observation: DiffObservation): OtterPatchDiff {
  const leaves = flattenLeaves(observation.shadow);
  const nodesByEdit = new Map<string, Array<ShadowResult['diff']['root']>>();
  for (const node of leaves) {
    for (const editId of node.editIds) {
      const nodes = nodesByEdit.get(editId) ?? [];
      nodes.push(node);
      nodesByEdit.set(editId, nodes);
    }
  }

  const riskByEdit = new Map(
    assessChangeSet(cs, mergeRiskContext(cs, observation, nodesByEdit)).byEdit.map((risk) => [risk.editId, risk]),
  );
  const indirectEffects = [...(observation.indirectEffects ?? [])];
  const shadowConflicts = [...(observation.shadow?.diff.conflicts ?? [])];

  const items = cs.edits.map((edit): OtterPatchDiffItem => {
    const anchor = cs.anchors[edit.target];
    const ref = edit.op.kind === 'insertTable' && edit.op.at === 'end' ? '文档末尾' : refOf(anchor, edit.target);
    const description = describe(edit.op);
    const nodes = nodesByEdit.get(edit.id) ?? [];
    const node = nodes[0];
    const backendSupport = observation.supportByEdit?.[edit.id] ?? defaultSupport(observation.format, edit, nodes.length > 0);
    const directEffects: OtterPatchDiffEffect[] = nodes.map((observed) => ({
          target: refOf(observed.anchor, ref),
          kind: 'direct',
          summary: observed.render.label ?? description.label,
          before: observed.before,
          after: observed.after,
          editIds: [edit.id],
        }));
    const itemIndirect = indirectEffects.filter((effect) => effect.editIds?.includes(edit.id));
    const conflicts = shadowConflicts.filter((conflict) => conflict.anchor === edit.target);
    const affectedCount = affectedCountOf(edit, anchor);
    const expectedTouchedParts = touchedPartsFor(observation.format, edit, anchor);
    const risk = riskByEdit.get(edit.id) ?? { level: 'caution' as const, reasons: ['risk assessment unavailable'] };
    const sample = [...directEffects, ...itemIndirect].slice(0, 12);
    const item: OtterPatchDiffItem = {
      editId: edit.id,
      ref,
      kind: edit.op.kind,
      badge: conflicts.length ? 'conflict' : (node?.render.badge ?? description.badge),
      label: node?.render.label && node.render.label !== ref.replace(/^.*!/, '')
        ? node.render.label
        : description.label,
      directEffects,
      indirectEffects: itemIndirect,
      affectedCount,
      boundary: ref,
      sample,
      summary: `${description.label}; ${affectedCount} target${affectedCount === 1 ? '' : 's'}; preview ${backendSupport}`,
      conflicts,
      backendSupport,
      risk: { level: risk.level, reasons: [...risk.reasons] },
      expectedTouchedParts,
    };
    if (nodes.length === 1 && node) {
      item.before = node.before;
      item.after = node.after;
    }
    const proposedAfter = proposedAfterOf(edit.op);
    if (proposedAfter) item.proposedAfter = proposedAfter;
    if (description.proposalSummary !== undefined) item.proposalSummary = description.proposalSummary;
    if (description.style) item.style = description.style;
    return item;
  });

  const supports = items.map((item) => item.backendSupport);
  const backendSupport = supportSummary(supports);
  const observedItems = items.filter((item) => item.directEffects.length > 0).length;
  const previewStatus: DiffPreviewStatus = observedItems === 0
    ? 'unavailable'
    : observedItems === items.length && backendSupport === 'verified'
      ? 'verified'
      : 'partial';
  const affectedCount = items.reduce((sum, item) => sum + item.affectedCount, 0);
  const expectedTouchedParts = [...new Set(items.flatMap((item) => item.expectedTouchedParts))];
  const boundary = [...new Set(items.map((item) => item.boundary))];
  const sample = [...items.flatMap((item) => item.directEffects), ...indirectEffects].slice(0, 12);

  const diff: OtterPatchDiff = {
    changeSetId: cs.id,
    hostId: cs.hostId,
    format: observation.format,
    intent: cs.meta.intent,
    previewStatus,
    source: observation.shadow ? 'shadow' : 'unavailable',
    summary: `${items.length} edits; ${affectedCount} affected targets; ${observedItems} shadow-observed`,
    affectedCount,
    boundary,
    sample,
    conflicts: shadowConflicts,
    indirectEffects,
    backendSupport,
    expectedTouchedParts,
    items,
  };
  if (previewStatus === 'unavailable') {
    diff.unavailableReason = observation.unavailableReason ?? 'No format-engine shadow observation was supplied.';
  } else if (observation.unavailableReason) {
    diff.unavailableReason = observation.unavailableReason;
  }
  return diff;
}
