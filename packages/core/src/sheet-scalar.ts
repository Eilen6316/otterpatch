import type { CellValue } from './changeset.js';

/** A spreadsheet value whose semantic type was observed by the host. */
export type SheetScalar =
  | { kind: 'number'; value: number }
  | { kind: 'percent'; value: number; display: string }
  | { kind: 'currency'; value: number; currency?: string }
  | { kind: 'date'; serial: number; iso?: string }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'blank' }
  | { kind: 'error'; code: string };

/** Typed snapshots are preferred; primitive values remain accepted for legacy callers. */
export type SheetCellValue = SheetScalar | CellValue;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function isSheetScalar(value: unknown): value is SheetScalar {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'number':
      return finite(value.value);
    case 'percent':
      return finite(value.value) && typeof value.display === 'string';
    case 'currency':
      return finite(value.value) && (value.currency === undefined || typeof value.currency === 'string');
    case 'date':
      return finite(value.serial) && (value.iso === undefined || typeof value.iso === 'string');
    case 'text':
      return typeof value.value === 'string';
    case 'boolean':
      return typeof value.value === 'boolean';
    case 'blank':
      return true;
    case 'error':
      return typeof value.code === 'string' && value.code.length > 0;
    default:
      return false;
  }
}

export function sheetScalarToCellValue(value: SheetScalar): CellValue {
  switch (value.kind) {
    case 'number':
    case 'percent':
    case 'currency':
      return value.value;
    case 'date':
      return value.serial;
    case 'text':
      return value.value;
    case 'boolean':
      return value.value;
    case 'blank':
      return null;
    case 'error':
      return value.code;
  }
}

export function sheetScalarNumericValue(value: SheetScalar): number | undefined {
  switch (value.kind) {
    case 'number':
    case 'percent':
    case 'currency':
      return value.value;
    case 'date':
      return value.serial;
    default:
      return undefined;
  }
}
