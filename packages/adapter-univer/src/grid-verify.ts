/**
 * Excel shadow verifier — applies a proposal to a shadow grid built from the full-sheet
 * snapshot, recursively recalculates formulas, and produces "observations" fed back to the
 * model: recalculated results (for checking totals/percentages) plus an issue list
 * (out-of-bounds writes, duplicate hits, etc.).
 * This turns respond from one-shot into propose→observe→repair: the model sees the actual
 * computed results of its edits and can self-correct.
 */
import type { CellValue, ChangeSet, VerifyReport } from '@otterpatch/core';
import { GridChangeSetEngine, gridShadow } from './grid-engine.js';

const colLetter = (n: number): string => {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};
const colToNum = (c: string): number => {
  let n = 0;
  for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
function cellRC(a1: string): { col: number; row: number } {
  const m = /([A-Za-z]+)([0-9]+)/.exec(a1);
  return { col: m ? colToNum(m[1]!) : 1, row: m ? parseInt(m[2]!, 10) : 1 };
}
const bareCell = (a1: string): string =>
  (a1.replace(/^.*!/, '').replace(/\$/g, '').split(':')[0] ?? 'A1').toUpperCase();
/** Get the 0-based col/row of the top-left cell of a1 ("A1" / "A1:F20" / "Sheet1!A1"). */
function topLeft(a1: string): { c: number; r: number } {
  const rc = cellRC(bareCell(a1));
  return { c: rc.col - 1, r: rc.row - 1 };
}

export interface SheetSnapshot {
  a1: string;
  values: unknown[][];
  /** Formula matrix aligned with values. Empty strings mean the cell has no formula. */
  formulas?: Array<Array<string | null>>;
  name?: string;
  names?: string[];
}

/** Convert a host sheet snapshot into the typed grid used by shadow apply. */
export function gridShadowFromSnapshot(sheet: SheetSnapshot): ReturnType<typeof gridShadow> {
  const tl = topLeft(sheet.a1);
  const shadow = gridShadow();
  const rows = Math.max(sheet.values.length, sheet.formulas?.length ?? 0);
  for (let r = 0; r < rows; r++) {
    const row = sheet.values[r] ?? [];
    const formulas = sheet.formulas?.[r] ?? [];
    const width = Math.max(row.length, formulas.length);
    for (let c = 0; c < width; c++) {
      const ref = colLetter(tl.c + c) + (tl.r + r + 1);
      const value = row[c];
      const formula = formulas[c];
      if (typeof formula === 'string' && formula.length > 0) {
        shadow.set(ref, { formula });
        continue;
      }
      if (value == null || value === '') continue;
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(`sheet snapshot contains a non-finite number at ${ref}`);
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`sheet snapshot contains an unsupported value at ${ref}`);
      }
      shadow.set(ref, { value });
    }
  }
  return shadow;
}

/** True only when a single-cell reference is inside this exact sheet snapshot. */
export function sheetSnapshotContains(sheet: SheetSnapshot, a1: string, anchorSheet?: string): boolean {
  const snapshotSheet = sheet.name ?? sheetNameOf(sheet.a1);
  const targetSheet = sheetNameOf(a1) ?? anchorSheet;
  if (snapshotSheet && targetSheet && snapshotSheet !== targetSheet) return false;
  const tl = topLeft(sheet.a1);
  const target = cellRC(bareCell(a1));
  const rows = Math.max(sheet.values.length, sheet.formulas?.length ?? 0);
  let columns = 0;
  for (let row = 0; row < rows; row++) {
    columns = Math.max(columns, sheet.values[row]?.length ?? 0, sheet.formulas?.[row]?.length ?? 0);
  }
  return target.row >= tl.r + 1
    && target.row <= tl.r + rows
    && target.col >= tl.c + 1
    && target.col <= tl.c + columns;
}

function sheetNameOf(a1: string): string | undefined {
  const bang = a1.lastIndexOf('!');
  return bang >= 0 ? a1.slice(0, bang).replace(/^'|'$/g, '') : undefined;
}

/** Build a shadow verifier from a full-sheet snapshot (return signature is compatible with @otterpatch/agent's ChangeSetVerifier). */
export function buildGridVerifier(sheet: SheetSnapshot): (cs: ChangeSet) => Promise<VerifyReport> {
  return async (cs: ChangeSet): Promise<VerifyReport> => {
    const tl = topLeft(sheet.a1);
    const shadow = gridShadowFromSnapshot(sheet);
    const rows = Math.max(sheet.values.length, sheet.formulas?.length ?? 0);
    let maxCol = 0;
    for (let r = 0; r < rows; r++) {
      const row = sheet.values[r] ?? [];
      const formulas = sheet.formulas?.[r] ?? [];
      if (Math.max(row.length, formulas.length) > maxCol) maxCol = Math.max(row.length, formulas.length);
    }
    const dataMaxRow = tl.r + rows; // 1-based last data row
    const dataMaxCol = tl.c + maxCol; // 1-based last data column

    let recalculated: CellValue[][] = [];
    try {
      const res = await new GridChangeSetEngine().shadowApply(cs, shadow);
      recalculated = res.effects.recalculated ?? [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, report: `影子校验执行失败: ${msg}\n请修正提案后重新调用 propose_changeset。` };
    }

    const issues: string[] = [];
    const seen = new Set<string>();
    for (const e of cs.edits) {
      const a = cs.anchors[e.target];
      if (!a || a.portable.kind !== 'grid') continue;
      const ref = bareCell(a.portable.a1);
      const { col, row } = cellRC(ref);
      if (row > dataMaxRow + 1) issues.push(`${ref}:写到第 ${row} 行,但数据只到第 ${dataMaxRow} 行(中间留空,疑似 ref 笔误)`);
      else if (col > dataMaxCol + 1) issues.push(`${ref}:写到第 ${col} 列,但数据只到第 ${dataMaxCol} 列(疑似 ref 笔误)`);
      if (seen.has(ref)) issues.push(`${ref}:被多条改动重复命中(后者覆盖前者)`);
      seen.add(ref);
    }

    const recap = recalculated.slice(0, 12).map(([a, v]) => `${String(a)}=${String(v)}`).join('  ');
    const parts: string[] = [];
    if (recap) parts.push('影子重算(供你核对结果是否合理):' + recap);
    if (issues.length) parts.push('发现以下问题:\n' + issues.map((s) => '- ' + s).join('\n'));
    const tail = issues.length ? '\n请据此修正后重新调用 propose_changeset。' : '';
    return { ok: issues.length === 0, report: (parts.join('\n') || '影子校验通过,无明显问题。') + tail };
  };
}
