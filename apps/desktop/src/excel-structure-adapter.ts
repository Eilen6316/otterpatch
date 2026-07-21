import {
  a1ToRC,
  buildChartGrid,
  gridToChartSpec,
  rcToColLetter,
  specFromInline,
  type ChartSpec,
} from './chart-data.js';
import { isGridStructureKind } from './grid-operation-kinds.js';
import type { SheetHandle } from './UniverSheet.js';

export interface ChartPlacement {
  row: number;
  col: number;
}

type ExcelStructureSheet = Pick<
  SheetHandle,
  | 'insertRows'
  | 'deleteRows'
  | 'insertCols'
  | 'deleteCols'
  | 'mergeRange'
  | 'unmergeRange'
  | 'freeze'
  | 'sortRange'
  | 'clearRange'
  | 'conditionalFormat'
  | 'dataValidation'
  | 'createFilter'
  | 'addSheet'
  | 'copyRange'
  | 'getValue'
  | 'insertChartImage'
>;

type StructureOp = {
  kind?: string;
  count?: number;
  before?: boolean;
  rows?: number;
  cols?: number;
  by?: number;
  asc?: boolean;
  when?: string;
  v1?: number | string;
  v2?: number;
  rule?: string;
  list?: string[];
  min?: number;
  max?: number;
  v?: number;
  style?: Parameters<ExcelStructureSheet['conditionalFormat']>[2];
  chartType?: ChartSpec['chartType'];
  title?: string;
  categories?: unknown[];
  series?: Array<{ name?: unknown; data?: unknown[] }>;
  name?: string;
  to?: string;
  value?: unknown;
  formula?: string;
};

type ExcelChangeSet = {
  edits?: Array<{ target: string; op?: StructureOp }>;
  anchors?: Record<string, { portable?: { a1?: string } }>;
} | null;

export interface ApplyExcelStructureOptions {
  sheet: ExcelStructureSheet | null | undefined;
  chartPlacements: ChartPlacement[];
  renderChart: (spec: ChartSpec) => string;
}

const chartPlacement = (
  anchor: string,
  range: string,
  inline: boolean,
  occupied: ChartPlacement[],
): string => {
  const initial = inline
    ? a1ToRC(anchor)
    : {
        row: a1ToRC(range.split(':')[0] ?? 'A1').row,
        col: a1ToRC(range.split(':')[1] ?? range.split(':')[0] ?? 'A1').col + 2,
      };
  const width = 8;
  const height = 18;
  let position = initial;
  for (let guard = 0; guard < 20; guard++) {
    const hit = occupied.find((rect) =>
      position.row < rect.row + height
      && rect.row < position.row + height
      && position.col < rect.col + width
      && rect.col < position.col + width,
    );
    if (!hit) break;
    position = { row: hit.row + height + 1, col: position.col };
  }
  occupied.push(position);
  return rcToColLetter(position.col) + (position.row + 1);
};

const writtenGridValues = (changeSet: NonNullable<ExcelChangeSet>): Map<string, unknown> => {
  const values = new Map<string, unknown>();
  for (const edit of changeSet.edits ?? []) {
    const kind = edit.op?.kind;
    if (kind !== 'setValue' && kind !== 'setFormula') continue;
    const a1 = (changeSet.anchors?.[edit.target]?.portable?.a1 ?? '').replace(/^.*!/, '').toUpperCase();
    const value = edit.op?.value ?? edit.op?.formula;
    if (a1 && value !== undefined) values.set(a1, value);
  }
  return values;
};

export function applyExcelStructure(changeSet: unknown, options: ApplyExcelStructureOptions): void {
  const sheet = options.sheet;
  const parsed = changeSet as ExcelChangeSet;
  if (!sheet || !parsed?.edits) return;

  for (const edit of parsed.edits) {
    const op = edit.op;
    const kind = op?.kind ?? '';
    if (!isGridStructureKind(kind)) continue;

    const fullA1 = parsed.anchors?.[edit.target]?.portable?.a1 ?? 'A1';
    const sheetName = /^([^!]+)!/.exec(fullA1)?.[1];
    const a1 = fullA1.replace(/^.*!/, '');
    const qualifiedA1 = sheetName ? `${sheetName}!${a1}` : a1;
    const { row, col } = a1ToRC(a1);
    const count = op?.count ?? 1;

    if (kind === 'insertRows') sheet.insertRows(op?.before === false ? row + 1 : row, count, sheetName);
    else if (kind === 'deleteRows') sheet.deleteRows(row, count, sheetName);
    else if (kind === 'insertCols') sheet.insertCols(op?.before === false ? col + 1 : col, count, sheetName);
    else if (kind === 'deleteCols') sheet.deleteCols(col, count, sheetName);
    else if (kind === 'mergeCells') sheet.mergeRange(qualifiedA1);
    else if (kind === 'unmergeCells') sheet.unmergeRange(qualifiedA1);
    else if (kind === 'freezePanes') sheet.freeze(op?.rows ?? 0, op?.cols ?? 0);
    else if (kind === 'sortRange') sheet.sortRange(qualifiedA1, op?.by ?? 0, op?.asc ?? true);
    else if (kind === 'deleteRange') sheet.clearRange(qualifiedA1);
    else if (kind === 'conditionalFormat') {
      sheet.conditionalFormat(
        qualifiedA1,
        { when: op?.when ?? 'notEmpty', v1: op?.v1, v2: op?.v2 },
        op?.style ?? {},
      );
    } else if (kind === 'dataValidation') {
      sheet.dataValidation(qualifiedA1, {
        kind: op?.rule ?? 'list',
        list: op?.list,
        min: op?.min,
        max: op?.max,
        v: op?.v,
      });
    } else if (kind === 'autoFilter') sheet.createFilter(qualifiedA1);
    else if (kind === 'addSheet') sheet.addSheet(op?.name ?? '新表');
    else if (kind === 'copyRange') sheet.copyRange(fullA1, op?.to ?? 'A1');
    else if (kind === 'insertChart') {
      const inline = (op?.categories?.length ?? 0) > 0;
      const spec = inline
        ? specFromInline(op?.chartType ?? 'bar', op?.title ?? '图表', op?.categories, op?.series)
        : gridToChartSpec(
            buildChartGrid(a1, writtenGridValues(parsed), (cell) => sheet.getValue(cell)),
            op?.chartType ?? 'bar',
            op?.title ?? '图表',
          );
      if (!spec.categories.length || !spec.series.length) continue;

      const anchor = chartPlacement(a1, a1, inline, options.chartPlacements);
      sheet.insertChartImage(anchor, options.renderChart(spec), 640, 400);
    }
  }
}
