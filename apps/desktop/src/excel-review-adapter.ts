import type { DiffTurn, Turn } from './app-thread-types.js';
import type { GridOp } from './proposal-materializers.js';
import type { SheetHandle } from './UniverSheet.js';

export type ExcelDiffView = 'orig' | 'mark' | 'final';

type ExcelReviewSheet = Pick<
  SheetHandle,
  | 'setCell'
  | 'setBackground'
  | 'setFontColor'
  | 'setBold'
  | 'setNumberFormat'
  | 'setAlign'
  | 'focus'
>;

export interface PlayGridOpsOptions {
  delay?: (ms: number) => Promise<void>;
  onStart?: () => void;
}

const MARK_BACKGROUND_ACCEPTED = '#dbeafe';
const MARK_BACKGROUND_REJECTED = '#fee2e2';
const CINEMATIC_MAX = 10;
const PLAYBACK_CHUNK_SIZE = 24;

const defaultDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const applyGridDimensions = (sheet: ExcelReviewSheet, op: GridOp, includeBackground: boolean): void => {
  if (op.value !== undefined) sheet.setCell(op.a1, op.value);
  if (op.bold) sheet.setBold(op.a1);
  if (op.color) sheet.setFontColor(op.a1, op.color);
  if (op.numFmt) sheet.setNumberFormat(op.a1, op.numFmt);
  if (op.align) sheet.setAlign(op.a1, op.align);
  if (includeBackground && op.bg != null) sheet.setBackground(op.a1, op.bg);
};

export function applyGridOp(sheet: ExcelReviewSheet | null | undefined, op: GridOp): void {
  if (!sheet) return;
  applyGridDimensions(sheet, op, true);
}

export function revertGridOp(sheet: ExcelReviewSheet | null | undefined, op: GridOp): void {
  if (!sheet) return;
  const before = op.beforeState;
  if (op.value !== undefined) {
    sheet.setCell(op.a1, before?.f ? before.f : (before ? before.v : op.before) ?? '');
  }
  if (op.bg != null) sheet.setBackground(op.a1, before?.bg ?? null);
  if (op.color) sheet.setFontColor(op.a1, before?.color ?? '#1f2937');
  if (op.bold) sheet.setBold(op.a1, before?.bold ?? false);
  if (op.numFmt) sheet.setNumberFormat(op.a1, before?.numFmt ?? 'General');
  if (op.align) sheet.setAlign(op.a1, before?.align ?? null);
}

export const gridOpBackground = (op: GridOp, accepted: boolean): string | null =>
  accepted ? op.bg ?? op.beforeState?.bg ?? null : op.beforeState?.bg ?? null;

export function boundingGridOps(ops: readonly Pick<GridOp, 'a1'>[]): string | null {
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (const op of ops) {
    const match = /([A-Za-z]+)([0-9]+)/.exec(op.a1.replace(/^.*!/, ''));
    if (!match) continue;
    let col = 0;
    for (const char of match[1]!.toUpperCase()) col = col * 26 + (char.charCodeAt(0) - 64);
    const row = parseInt(match[2]!, 10);
    minCol = Math.min(minCol, col);
    minRow = Math.min(minRow, row);
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
  }
  if (!Number.isFinite(minCol)) return null;

  const columnName = (value: number): string => {
    let name = '';
    let current = value;
    while (current > 0) {
      const remainder = (current - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      current = Math.floor((current - 1) / 26);
    }
    return name;
  };
  return `${columnName(minCol)}${minRow}:${columnName(maxCol)}${maxRow}`;
}

export async function playGridOps(
  sheet: ExcelReviewSheet | null | undefined,
  ops: readonly GridOp[],
  options: PlayGridOpsOptions = {},
): Promise<void> {
  if (!sheet || !ops.length) return;
  const delay = options.delay ?? defaultDelay;
  options.onStart?.();

  if (ops.length <= CINEMATIC_MAX) {
    for (const op of ops) {
      sheet.focus(op.a1);
      await delay(220);
      sheet.setBackground(op.a1, MARK_BACKGROUND_ACCEPTED);
      await delay(120);
      applyGridDimensions(sheet, op, false);
      await delay(240);
      sheet.setBackground(op.a1, op.bg ?? null);
      await delay(140);
    }
    return;
  }

  const region = boundingGridOps(ops);
  if (region) sheet.focus(region);
  await delay(120);
  for (let start = 0; start < ops.length; start += PLAYBACK_CHUNK_SIZE) {
    const end = Math.min(start + PLAYBACK_CHUNK_SIZE, ops.length);
    for (let index = start; index < end; index++) applyGridOp(sheet, ops[index]!);
    await delay(20);
  }
}

export function findLatestExcelDiffTurn(thread: readonly Turn[]): DiffTurn | undefined {
  for (let index = thread.length - 1; index >= 0; index--) {
    const turn = thread[index];
    if (turn?.role === 'assistant' && turn.kind === 'diff' && turn.format === 'excel' && turn.ops.length) {
      return turn;
    }
  }
  return undefined;
}

export function renderExcelDiffView(
  sheet: ExcelReviewSheet | null | undefined,
  turn: DiffTurn,
  view: ExcelDiffView,
  isAccepted: (editId: string) => boolean,
): void {
  if (!sheet) return;
  for (const op of turn.ops) {
    const accepted = !!op.editId && isAccepted(op.editId);
    if (view === 'orig') revertGridOp(sheet, op);
    else if (accepted) applyGridOp(sheet, op);
    else revertGridOp(sheet, op);

    if (view === 'mark') {
      sheet.setBackground(op.a1, accepted ? MARK_BACKGROUND_ACCEPTED : MARK_BACKGROUND_REJECTED);
    } else {
      sheet.setBackground(op.a1, view === 'orig' ? op.beforeState?.bg ?? null : gridOpBackground(op, accepted));
    }
  }
}
