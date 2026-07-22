/** Excel simulation verifier backed by GridChangeSetEngine. */
import { RESOURCE_LIMITS, ResourceLimitError, isSheetScalar, sheetScalarToCellValue, type AbstractStyle, type CellValue, type ChangeSet, type SheetCellValue, type VerifyReport } from '@otterpatch/core';
import {
  GridChangeSetEngine,
  GridSimulationError,
  expandGridRange,
  gridEngineSupports,
  gridShadow,
  type GridCell,
  type GridShadow,
} from './grid-engine.js';

const colLetter = (index: number): string => {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const digit = (value - 1) % 26;
    result = String.fromCharCode(65 + digit) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

const colToNum = (column: string): number => {
  let value = 0;
  for (const char of column.toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value;
};

function cellRC(a1: string): { col: number; row: number } {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(a1);
  return { col: match ? colToNum(match[1]!) : 0, row: match ? Number(match[2]) : 0 };
}

const bareCell = (a1: string): string =>
  (a1.replace(/^.*!/, '').replace(/\$/g, '').split(':')[0] ?? '').toUpperCase();

function topLeft(a1: string): { c: number; r: number } {
  const coordinate = cellRC(bareCell(a1));
  return { c: coordinate.col - 1, r: coordinate.row - 1 };
}

export interface SheetSnapshot {
  a1: string;
  values: SheetCellValue[][];
  formulas?: Array<Array<string | null>>;
  /** Style matrix aligned with values. null means the host observed the default style. */
  styles?: Array<Array<AbstractStyle | null>>;
  name?: string;
  names?: string[];
}

export function assertGridSnapshotBudget(sheet: SheetSnapshot): void {
  const rows = Math.max(sheet.values.length, sheet.formulas?.length ?? 0, sheet.styles?.length ?? 0);
  if (rows > RESOURCE_LIMITS.totalTouchedCells) {
    throw new ResourceLimitError('sheet_snapshot_rows', RESOURCE_LIMITS.totalTouchedCells, rows);
  }
  let cells = 0;
  for (let index = 0; index < rows; index++) {
    cells += Math.max(sheet.values[index]?.length ?? 0, sheet.formulas?.[index]?.length ?? 0, sheet.styles?.[index]?.length ?? 0);
    if (cells > RESOURCE_LIMITS.totalTouchedCells) {
      throw new ResourceLimitError('sheet_snapshot_cells', RESOURCE_LIMITS.totalTouchedCells, cells);
    }
  }
}

const SNAPSHOT_STYLE_KEYS = new Set(['bold', 'italic', 'underline', 'color', 'bgColor', 'font', 'size', 'align', 'numberFormat']);

function snapshotStyle(value: AbstractStyle | null | undefined, ref: string): AbstractStyle | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`sheet snapshot contains an invalid style at ${ref}`);
  const style = value as Record<string, unknown>;
  const unknown = Object.keys(style).filter((key) => !SNAPSHOT_STYLE_KEYS.has(key));
  if (unknown.length) throw new Error(`sheet snapshot contains unsupported style fields at ${ref}: ${unknown.join(', ')}`);
  for (const key of ['bold', 'italic', 'underline']) {
    if (style[key] !== undefined && typeof style[key] !== 'boolean') throw new Error(`sheet snapshot style ${key} must be boolean at ${ref}`);
  }
  for (const key of ['color', 'bgColor', 'font', 'numberFormat']) {
    if (style[key] !== undefined && typeof style[key] !== 'string') throw new Error(`sheet snapshot style ${key} must be a string at ${ref}`);
  }
  if (style.size !== undefined && (typeof style.size !== 'number' || !Number.isFinite(style.size))) {
    throw new Error(`sheet snapshot style size must be finite at ${ref}`);
  }
  if (style.align !== undefined && !['left', 'center', 'right', 'justify'].includes(String(style.align))) {
    throw new Error(`sheet snapshot style align is invalid at ${ref}`);
  }
  return { ...value };
}

/** Convert a host sheet snapshot into the typed grid used by shadow apply. */
export function gridShadowFromSnapshot(sheet: SheetSnapshot): GridShadow {
  assertGridSnapshotBudget(sheet);
  const origin = topLeft(sheet.a1);
  if (origin.c < 0 || origin.r < 0) throw new Error(`invalid sheet snapshot range ${sheet.a1}`);
  const shadow = gridShadow({}, true);
  const rows = Math.max(sheet.values.length, sheet.formulas?.length ?? 0, sheet.styles?.length ?? 0);
  let columns = 0;
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    columns = Math.max(
      columns,
      sheet.values[rowIndex]?.length ?? 0,
      sheet.formulas?.[rowIndex]?.length ?? 0,
      sheet.styles?.[rowIndex]?.length ?? 0,
    );
  }
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    const values = sheet.values[rowIndex] ?? [];
    const formulas = sheet.formulas?.[rowIndex] ?? [];
    const styles = sheet.styles?.[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
      const ref = colLetter(origin.c + columnIndex) + (origin.r + rowIndex + 1);
      const value = snapshotCellValue(values[columnIndex], ref);
      const formula = formulas[columnIndex];
      const style = snapshotStyle(styles[columnIndex], ref);
      const cell: GridCell = {};
      if (formula !== undefined && formula !== null && typeof formula !== 'string') {
        throw new Error(`sheet snapshot contains an invalid formula at ${ref}`);
      }
      if (typeof formula === 'string' && formula.length > 0) {
        cell.formula = formula;
        if (value !== undefined) cell.value = value;
      } else if (value != null && value !== '') {
        cell.value = value;
      }
      if (style) cell.style = style;
      // Empty cells are still observed. Keeping them lets formula evaluation
      // distinguish a real blank from a reference outside the snapshot.
      shadow.set(ref, cell);
    }
  }
  return shadow;
}

function isCellValue(value: unknown): value is CellValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function snapshotCellValue(value: unknown, ref: string): CellValue | undefined {
  if (value === undefined) return undefined;
  if (isSheetScalar(value)) return sheetScalarToCellValue(value);
  if (isCellValue(value)) return value;
  throw new Error(`sheet snapshot contains an unsupported value at ${ref}`);
}

/** True only when a single-cell reference is inside this exact sheet snapshot. */
export function sheetSnapshotContains(sheet: SheetSnapshot, a1: string, anchorSheet?: string): boolean {
  const snapshotSheet = sheet.name ?? sheetNameOf(sheet.a1);
  const targetSheet = sheetNameOf(a1) ?? anchorSheet;
  if (snapshotSheet && targetSheet && snapshotSheet !== targetSheet) return false;
  const origin = topLeft(sheet.a1);
  const target = cellRC(bareCell(a1));
  const rows = Math.max(sheet.values.length, sheet.formulas?.length ?? 0, sheet.styles?.length ?? 0);
  let columns = 0;
  for (let row = 0; row < rows; row++) {
    columns = Math.max(
      columns,
      sheet.values[row]?.length ?? 0,
      sheet.formulas?.[row]?.length ?? 0,
      sheet.styles?.[row]?.length ?? 0,
    );
  }
  return target.row >= origin.r + 1
    && target.row <= origin.r + rows
    && target.col >= origin.c + 1
    && target.col <= origin.c + columns;
}

/** Whether the host explicitly observed style state (including a null/default style) for a cell. */
export function sheetSnapshotHasStyleAt(sheet: SheetSnapshot, a1: string, anchorSheet?: string): boolean {
  if (!sheet.styles) return false;
  const snapshotSheet = sheet.name ?? sheetNameOf(sheet.a1);
  const targetSheet = sheetNameOf(a1) ?? anchorSheet;
  if (snapshotSheet && targetSheet && snapshotSheet !== targetSheet) return false;
  const origin = topLeft(sheet.a1);
  const target = cellRC(bareCell(a1));
  const row = target.row - origin.r - 1;
  const column = target.col - origin.c - 1;
  const styleRow = sheet.styles[row];
  return row >= 0
    && column >= 0
    && row < sheet.styles.length
    && Boolean(styleRow && Object.prototype.hasOwnProperty.call(styleRow, column) && styleRow[column] !== undefined);
}

/** A values matrix cannot prove that cells contain no formulas; explicit nulls can. */
export function sheetSnapshotHasCompleteFormulaState(sheet: SheetSnapshot): boolean {
  if (!sheet.formulas) return false;
  const rows = Math.max(sheet.values.length, sheet.formulas.length, sheet.styles?.length ?? 0);
  let columns = 0;
  for (let row = 0; row < rows; row++) {
    columns = Math.max(columns, sheet.values[row]?.length ?? 0, sheet.formulas[row]?.length ?? 0, sheet.styles?.[row]?.length ?? 0);
  }
  if (sheet.formulas.length < rows) return false;
  for (let row = 0; row < rows; row++) {
    const formulaRow = sheet.formulas[row];
    if (!formulaRow || formulaRow.length < columns) return false;
    for (let column = 0; column < columns; column++) {
      if (!Object.prototype.hasOwnProperty.call(formulaRow, column)) return false;
      const formula = formulaRow[column];
      if (formula !== null && typeof formula !== 'string') return false;
    }
  }
  return true;
}

function sheetNameOf(a1: string): string | undefined {
  const bang = a1.lastIndexOf('!');
  return bang >= 0 ? a1.slice(0, bang).replace(/^'|'$/g, '') : undefined;
}

function failure(code: string, message: string, details?: unknown): VerifyReport {
  const payload = { ok: false, level: 'simulation', code, message, ...(details !== undefined ? { details } : {}) };
  return { ok: false, level: 'simulation', code, report: JSON.stringify(payload), ...(details !== undefined ? { details } : {}) };
}

function writeChannels(edit: ChangeSet['edits'][number]): string[] {
  if (edit.op.kind === 'setValue' || edit.op.kind === 'setFormula' || edit.op.kind === 'deleteRange') return ['value'];
  if (edit.op.kind === 'setNumberFormat') return ['style:numberFormat'];
  if (edit.op.kind === 'setStyle') return Object.keys(edit.op.style).map((key) => `style:${key}`);
  return [edit.op.kind];
}

/** Build a verifier from a complete, read-only sheet snapshot. */
export function buildGridVerifier(sheet: SheetSnapshot): (cs: ChangeSet) => Promise<VerifyReport> {
  return async (cs: ChangeSet): Promise<VerifyReport> => {
    const occupiedTargets = new Map<string, Map<string, string>>();
    const issues: Array<{ code: string; editId: string; message: string; target?: string }> = [];

    for (const edit of cs.edits) {
      if (!gridEngineSupports(edit.op.kind)) {
        issues.push({
          code: 'VERIFIER_UNSUPPORTED_OPERATION',
          editId: edit.id,
          message: `Excel simulation does not support ${edit.op.kind}`,
        });
        continue;
      }
      const anchor = cs.anchors[edit.target];
      if (!anchor || anchor.portable.kind !== 'grid') {
        issues.push({ code: 'VERIFIER_INVALID_TARGET', editId: edit.id, message: 'edit does not target a grid anchor' });
        continue;
      }
      let refs: string[];
      try {
        refs = expandGridRange(anchor.portable.a1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push({ code: 'VERIFIER_INVALID_TARGET', editId: edit.id, message, target: anchor.portable.a1 });
        continue;
      }
      for (const ref of refs) {
        if (!sheetSnapshotContains(sheet, ref, anchor.portable.sheet)) {
          issues.push({
            code: 'VERIFIER_SNAPSHOT_OUT_OF_BOUNDS',
            editId: edit.id,
            message: `${ref} is outside the supplied sheet snapshot`,
            target: ref,
          });
        }
        if ((edit.op.kind === 'setStyle' || edit.op.kind === 'setNumberFormat')
          && !sheetSnapshotHasStyleAt(sheet, ref, anchor.portable.sheet)) {
          issues.push({
            code: 'VERIFIER_INSUFFICIENT_SNAPSHOT',
            editId: edit.id,
            message: `${ref} has no observed style state in the supplied snapshot`,
            target: ref,
          });
        }
        const channels = occupiedTargets.get(ref) ?? new Map<string, string>();
        for (const channel of writeChannels(edit)) {
          const prior = channels.get(channel);
          if (prior) {
            issues.push({
              code: 'VERIFIER_OVERLAPPING_EDITS',
              editId: edit.id,
              message: `${ref} channel ${channel} is targeted by both ${prior} and ${edit.id}`,
              target: ref,
            });
          } else {
            channels.set(channel, edit.id);
          }
        }
        occupiedTargets.set(ref, channels);
      }
    }

    const calculationEdit = cs.edits.find((edit) => edit.op.kind === 'setValue' || edit.op.kind === 'setFormula' || edit.op.kind === 'deleteRange');
    if (calculationEdit && !sheetSnapshotHasCompleteFormulaState(sheet)) {
      issues.unshift({
        code: 'VERIFIER_INSUFFICIENT_SNAPSHOT',
        editId: calculationEdit.id,
        message: 'Excel value simulation requires an explicit formula matrix; values alone cannot prove that no formulas are affected',
      });
    }

    if (issues.length) return failure(issues[0]!.code, issues[0]!.message, { issues });

    try {
      const result = await new GridChangeSetEngine().shadowApply(cs, gridShadowFromSnapshot(sheet));
      const recalculated = result.effects.recalculated ?? [];
      const recap = recalculated.slice(0, 12).map(([ref, value]) => `${String(ref)}=${String(value)}`).join('  ');
      return {
        ok: true,
        level: 'simulation',
        report: recap ? `模拟重算:${recap}` : '模拟通过:所有操作均已执行。',
        details: {
          affectedCells: result.diff.root.children.length,
          recalculated,
        },
      };
    } catch (error) {
      if (error instanceof GridSimulationError) return failure(error.code, error.message, error.details);
      return failure('VERIFIER_SIMULATION_FAILED', error instanceof Error ? error.message : String(error));
    }
  };
}
