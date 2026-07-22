import type { SheetScalar } from '@otterpatch/core';

export interface SheetCellMetadata {
  v?: unknown;
  /** Univer CellValueType: string=1, number=2, boolean=3, forced string=4. */
  t?: number | null;
}

const CELL_TYPE_STRING = 1;
const CELL_TYPE_NUMBER = 2;
const CELL_TYPE_BOOLEAN = 3;
const CELL_TYPE_FORCE_STRING = 4;

function semanticFormat(format: string): string {
  return format
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, '');
}

function currencyFrom(format: string): string | undefined {
  const code = /\[\$([A-Za-z]{3})(?:-[^\]]+)?\]/.exec(format)?.[1];
  if (code) return code.toUpperCase();
  return /[¥￥]/.test(format) ? 'CNY'
    : /€/.test(format) ? 'EUR'
      : /£/.test(format) ? 'GBP'
        : /₹/.test(format) ? 'INR'
          : /₩/.test(format) ? 'KRW'
            : /₽/.test(format) ? 'RUB'
              : /\$/.test(format) ? 'USD'
                : undefined;
}

function numericScalar(value: unknown, display: string | undefined, numberFormat: string | undefined): SheetScalar {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { kind: 'error', code: 'INVALID_NUMERIC_CELL' };
  const rawFormat = numberFormat ?? '';
  const format = semanticFormat(rawFormat);
  if (/[%％]/.test(format)) {
    return { kind: 'percent', value, display: display ?? `${value * 100}%` };
  }
  const currency = currencyFrom(rawFormat);
  if (currency) return { kind: 'currency', value, currency };
  if (/[ydhs]/i.test(format)) {
    const iso = display && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(display) ? display : undefined;
    return { kind: 'date', serial: value, ...(iso ? { iso } : {}) };
  }
  return { kind: 'number', value };
}

/** Build a type-honest scalar without parsing display strings into numbers. */
export function toSheetScalar(
  value: unknown,
  display?: string,
  numberFormat?: string,
  valueType?: number | null,
): SheetScalar {
  if (value == null || value === '') return { kind: 'blank' };
  if (valueType === CELL_TYPE_STRING || valueType === CELL_TYPE_FORCE_STRING) {
    return { kind: 'text', value: String(value) };
  }
  if (valueType === CELL_TYPE_BOOLEAN) {
    return typeof value === 'boolean'
      ? { kind: 'boolean', value }
      : { kind: 'error', code: 'INVALID_BOOLEAN_CELL' };
  }
  if (valueType === CELL_TYPE_NUMBER) return numericScalar(value, display, numberFormat);

  if (typeof value === 'number') return numericScalar(value, display, numberFormat);
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'string') return { kind: 'text', value };
  return { kind: 'error', code: 'UNSUPPORTED_CELL_VALUE' };
}

export function buildSheetScalars(
  values: unknown[][],
  displays?: string[][],
  numberFormats?: string[][],
  metadata?: Array<Array<SheetCellMetadata | null>>,
): SheetScalar[][] {
  return values.map((row, rowIndex) => row.map((value, columnIndex) => toSheetScalar(
    value,
    displays?.[rowIndex]?.[columnIndex],
    numberFormats?.[rowIndex]?.[columnIndex],
    metadata?.[rowIndex]?.[columnIndex]?.t,
  )));
}
