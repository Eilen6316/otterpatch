/**
 * Excel ChangeSet → xlsx OOXML part patch compiler (OoxmlPatchCompiler implementation).
 * Compiles setValue/setFormula/setStyle/setNumberFormat/deleteRange into minimal changes to
 * xl/worksheets/sheetN.xml (values/formulas/style indices) and xl/styles.xml (style registration).
 *
 * Honest write-back:
 *  - Each edit reports applied / dropped (with reason); edits are isolated — one failure does not sink the batch;
 *  - Unsupported ops (structural/object/raw) are explicitly dropped with a reason, never silently "succeed";
 *  - If the target cell does not exist, insert a new <c> (creating a <row> if needed) instead of throwing.
 *  - Strings use inlineStr (sharedStrings untouched); formulas clear cached values and force a full workbook recalculation.
 */
import { assertA1RangeBudget, supportsFormatOperation, type CellValue, type ChangeSet, type EditId, type LogicalAnchor } from '@otterpatch/core';
import { readOoxmlParts, type OoxmlParts, type OoxmlPatchResult } from '@otterpatch/writeback-surgical';
import { XlsxStyles, type AbstractCellStyle } from './xlsx-styles.js';
import { prepareFormulaRecalculation, type FormulaRecalculationPatch } from './xlsx-recalculation.js';
import { WorksheetXmlEditor } from './worksheet-editor.js';

const dec = new TextDecoder();
const encoder = new TextEncoder();

const colToNum = (c: string): number => {
  let n = 0;
  for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const numToCol = (n: number): string => {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
function parseRef(ref: string): { col: number; row: number } {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(ref);
  if (!m) throw new Error('invalid A1 reference ' + ref);
  const row = parseInt(m[2]!, 10);
  if (row < 1) throw new Error('invalid A1 reference ' + ref);
  return { col: colToNum(m[1]!), row };
}
/** A1 or A1:B3 → list of cell refs (ranges expanded row by row, column by column). */
function expandCells(a1: string): string[] {
  assertA1RangeBudget(a1);
  const [from, to] = a1.split(':');
  if (!to) {
    const a = parseRef(from!);
    return [numToCol(a.col) + a.row];
  }
  const a = parseRef(from!);
  const b = parseRef(to);
  const out: string[] = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++)
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) out.push(numToCol(c) + r);
  return out;
}

/** Resolve a sheet name to xl/worksheets/sheetN.xml; single sheet or resolution failure → default sheet1. */
export function resolveSheetPart(parts: OoxmlParts, sheetName?: string): string {
  const fallback = 'xl/worksheets/sheet1.xml';
  const wbBytes = parts['xl/workbook.xml'];
  const relBytes = parts['xl/_rels/workbook.xml.rels'];
  if (!wbBytes || !relBytes) {
    if (sheetName) throw new Error(`sheet '${sheetName}' not found`);
    if (parts[fallback]) return fallback;
    throw new Error('workbook relationships missing; cannot resolve worksheet');
  }
  const wb = dec.decode(wbBytes);
  const rels = dec.decode(relBytes);

  let rid: string | undefined;
  let sheetCount = 0;
  for (const m of wb.matchAll(/<sheet\b[^>]*?\/?>/g)) {
    sheetCount++;
    const tag = m[0] ?? '';
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const id = /\br:id="([^"]*)"/.exec(tag)?.[1];
    if (!id) continue;
    if (!sheetName || name === sheetName) {
      rid = id;
      break;
    }
  }
  if (!rid) {
    if (sheetName) throw new Error(`sheet '${sheetName}' not found`);
    if (sheetCount > 1) throw new Error('sheet name required for multi-sheet workbook');
    if (parts[fallback]) return fallback;
    throw new Error('worksheet not found');
  }

  const relTag = new RegExp(`<Relationship\\b[^>]*?\\bId="${rid}"[^>]*?>`).exec(rels)?.[0];
  const target = relTag ? /\bTarget="([^"]*)"/.exec(relTag)?.[1] : undefined;
  if (!target) throw new Error(`relationship '${rid}' target not found`);
  const path = normalizeWorksheetPartTarget(target);
  if (!parts[path]) throw new Error(`worksheet part '${path}' not found`);
  return path;
}
function normalizeWorksheetPartTarget(target: string): string {
  const raw = target.startsWith('/') ? target.slice(1) : (target.startsWith('xl/') ? target : `xl/${target}`);
  const parts = raw.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) throw new Error(`invalid worksheet relationship target '${target}'`);
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(raw)) throw new Error(`invalid worksheet relationship target '${target}'`);
  return raw;
}
function unquoteSheetName(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("'") && trimmed.endsWith("'")
    ? trimmed.slice(1, -1).replace(/''/g, "'")
    : trimmed;
}

/** Extract the canonical {sheet, a1} pair from the core grid-locator contract. */
function anchorA1(a: LogicalAnchor): { sheet: string; a1: string } | null {
  const p = a.portable;
  if (p.kind !== 'grid') return null;
  if (!p.sheet.trim()) throw new Error('grid anchor sheet is empty');
  let a1 = p.a1;
  const bang = a1.lastIndexOf('!');
  if (bang >= 0) {
    const qualifiedSheet = unquoteSheetName(a1.slice(0, bang));
    if (qualifiedSheet !== p.sheet) {
      throw new Error(`grid anchor sheet mismatch: portable.sheet='${p.sheet}', a1 sheet='${qualifiedSheet}'`);
    }
    a1 = a1.slice(bang + 1);
  }
  return { sheet: p.sheet, a1 };
}

function resolveStylesPath(parts: OoxmlParts): string | null {
  if (parts['xl/styles.xml']) return 'xl/styles.xml';
  const k = Object.keys(parts).find((p) => /(^|\/)styles\.xml$/.test(p));
  return k ?? null;
}

/** Build the Excel OoxmlPatchCompiler: ChangeSet → sheet/styles XML patches + per-edit report. */
export function buildXlsxCompiler() {
  return async function compile(cs: ChangeSet, original: Uint8Array): Promise<OoxmlPatchResult> {
    const parts = readOoxmlParts(original);
    const sheetEditors = new Map<string, WorksheetXmlEditor>();
    const applied: EditId[] = [];
    const dropped: Array<{ editId: EditId; reason: string }> = [];
    let formulaRecalculation: FormulaRecalculationPatch | undefined;

    const stylesPath = resolveStylesPath(parts);
    const styleBox: { ed: XlsxStyles | null } = { ed: null };
    const ensureStyles = (): XlsxStyles | null => {
      if (styleBox.ed) return styleBox.ed;
      if (!stylesPath || !parts[stylesPath]) return null;
      styleBox.ed = new XlsxStyles(dec.decode(parts[stylesPath]));
      return styleBox.ed;
    };
    const getSheetEditor = (path: string): WorksheetXmlEditor => {
      const cached = sheetEditors.get(path);
      if (cached) return cached;
      const b = parts[path];
      if (!b) throw new Error(`missing part ${path}`);
      const editor = new WorksheetXmlEditor(dec.decode(b));
      sheetEditors.set(path, editor);
      return editor;
    };

    for (const edit of cs.edits) {
      const kind = edit.op.kind;
      try {
        if (!supportsFormatOperation('excel', kind, 'writeback')) {
          dropped.push({ editId: edit.id, reason: `op '${kind}' 不被 xlsx 外科写回支持(需结构/对象写回后端)` });
          continue;
        }
        const anchor = cs.anchors[edit.target];
        if (!anchor) throw new Error(`anchor ${edit.target} missing`);
        const ac = anchorA1(anchor);
        if (!ac) {
          dropped.push({ editId: edit.id, reason: 'anchor 非 grid(无 A1 引用)' });
          continue;
        }
        const path = resolveSheetPart(parts, ac.sheet);
        const cells = expandCells(ac.a1);
        const sheet = getSheetEditor(path);

        if (kind === 'setStyle' || kind === 'setNumberFormat') {
          const ed = ensureStyles();
          if (!ed) {
            dropped.push({ editId: edit.id, reason: '缺少 xl/styles.xml,无法登记样式' });
            continue;
          }
          const style: AbstractCellStyle =
            kind === 'setNumberFormat'
              ? { numberFormat: (edit.op as { pattern: string }).pattern }
              : ((edit.op as { style: AbstractCellStyle }).style ?? {});
          const updates = cells.map((ref) => ({ ref, styleIndex: ed.resolveXf(sheet.cellStyleIndex(ref), style) }));
          for (const update of updates) sheet.setCellStyle(update.ref, update.styleIndex);
        } else {
          for (const ref of cells) {
            if (kind === 'setFormula') {
              const recalculation = formulaRecalculation ?? prepareFormulaRecalculation(parts);
              sheet.setCellFormula(ref, (edit.op as { formula: string }).formula ?? '');
              formulaRecalculation = recalculation;
            } else if (kind === 'deleteRange') {
              if (!sheet.hasCell(ref)) continue; // target already empty; clearing is a no-op
              sheet.setCellValue(ref, null);
            } else {
              const value = (edit.op as { value: CellValue }).value ?? null;
              if (value === null && !sheet.hasCell(ref)) continue; // writing null to an empty cell; skip
              sheet.setCellValue(ref, value);
            }
          }
        }
        applied.push(edit.id);
      } catch (e) {
        dropped.push({ editId: edit.id, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    const out: OoxmlParts = {};
    for (const [path, editor] of sheetEditors) {
      const original = parts[path];
      const xml = editor.toXml();
      if (!original || dec.decode(original) !== xml) out[path] = encoder.encode(xml);
    }
    if (styleBox.ed && styleBox.ed.dirty && stylesPath) out[stylesPath] = encoder.encode(styleBox.ed.toXml());
    if (formulaRecalculation) Object.assign(out, formulaRecalculation.parts);
    return {
      parts: out,
      ...(formulaRecalculation?.removedParts.length ? { removedParts: formulaRecalculation.removedParts } : {}),
      report: { applied, dropped },
    };
  };
}
