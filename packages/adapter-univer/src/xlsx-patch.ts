/**
 * Excel ChangeSet → xlsx OOXML part patch compiler (OoxmlPatchCompiler implementation).
 * Compiles setValue/setFormula/setStyle/setNumberFormat/deleteRange into minimal changes to
 * xl/worksheets/sheetN.xml (values/formulas/style indices) and xl/styles.xml (style registration).
 *
 * Honest write-back:
 *  - Each edit reports applied / dropped (with reason); edits are isolated — one failure does not sink the batch;
 *  - Unsupported ops (structural/object/raw) are explicitly dropped with a reason, never silently "succeed";
 *  - If the target cell does not exist, insert a new <c> (creating a <row> if needed) instead of throwing.
 *  - Strings use inlineStr (sharedStrings untouched); formulas write <f> without a cached value (Excel recalculates on open).
 */
import { unzipSync } from 'fflate';
import { supportsFormatOperation, type CellValue, type ChangeSet, type EditId, type LogicalAnchor } from '@otterpatch/core';
import type { OoxmlParts, OoxmlPatchResult } from '@otterpatch/writeback-surgical';
import { XlsxStyles, type AbstractCellStyle } from './xlsx-styles.js';

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
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface CellHit {
  index: number;
  len: number;
  sIdx?: number;
  t?: string;
  inner?: string; // undefined ⇒ self-closing <c .../>
}
function findCell(sheetXml: string, ref: string): CellHit | null {
  const m = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(sheetXml);
  if (!m) return null;
  const attrs = m[1] ?? '';
  const s = /\bs="(\d+)"/.exec(attrs)?.[1];
  const t = /\bt="([^"]*)"/.exec(attrs)?.[1];
  return {
    index: m.index,
    len: m[0].length,
    ...(s != null ? { sIdx: parseInt(s, 10) } : {}),
    ...(t != null ? { t } : {}),
    ...(m[2] != null ? { inner: m[2] } : {}),
  };
}

const sAttrOf = (sIdx?: number): string => (sIdx != null ? ` s="${sIdx}"` : '');

/** Value-cell XML (preserves the given style index s). */
function valueCellXml(ref: string, value: CellValue, sIdx?: number): string {
  const s = sAttrOf(sIdx);
  if (value === null) return `<c r="${ref}"${s}/>`;
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t${space}>${escapeXml(value)}</t></is></c>`;
}
/** Formula-cell XML: writes <f> without a cached value (Excel/LibreOffice recalculates on open). */
function formulaCellXml(ref: string, formula: string, sIdx?: number): string {
  return `<c r="${ref}"${sAttrOf(sIdx)}><f>${escapeXml(formula.replace(/^=/, ''))}</f></c>`;
}
/** Cell XML that swaps only the style index s and keeps original content (setStyle/setNumberFormat). */
function restyleCellXml(ref: string, newS: number, existing: CellHit | null): string {
  const s = ` s="${newS}"`;
  if (!existing) return `<c r="${ref}"${s}/>`;
  const t = existing.t != null ? ` t="${existing.t}"` : '';
  if (existing.inner == null) return `<c r="${ref}"${s}${t}/>`;
  return `<c r="${ref}"${s}${t}>${existing.inner}</c>`;
}

/** Replace an existing <c>, or insert a new <c> in column/row order (creating a <row> if needed). */
function upsertCell(sheetXml: string, ref: string, newCellXml: string, hit: CellHit | null): string {
  if (hit) return sheetXml.slice(0, hit.index) + newCellXml + sheetXml.slice(hit.index + hit.len);
  const { col, row } = parseRef(ref);

  const rowOpen = new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*?(/?)>`).exec(sheetXml);
  if (rowOpen) {
    if (rowOpen[1] === '/') {
      const openTag = rowOpen[0].slice(0, -2) + '>';
      return sheetXml.slice(0, rowOpen.index) + openTag + newCellXml + '</row>' + sheetXml.slice(rowOpen.index + rowOpen[0].length);
    }
    const start = rowOpen.index + rowOpen[0].length;
    const end = sheetXml.indexOf('</row>', start);
    const inner = sheetXml.slice(start, end);
    let at = inner.length;
    for (const m of inner.matchAll(/<c\b[^>]*\br="([A-Za-z]+)\d+"/g)) {
      if (colToNum(m[1]!) > col) {
        at = m.index!;
        break;
      }
    }
    return sheetXml.slice(0, start) + inner.slice(0, at) + newCellXml + inner.slice(at) + sheetXml.slice(end);
  }

  const sd = /<sheetData\b[^>]*?(\/?)>/.exec(sheetXml);
  if (!sd) throw new Error('no <sheetData> in worksheet');
  const rowXml = `<row r="${row}">${newCellXml}</row>`;
  if (sd[1] === '/') {
    return sheetXml.slice(0, sd.index) + '<sheetData>' + rowXml + '</sheetData>' + sheetXml.slice(sd.index + sd[0].length);
  }
  const sdStart = sd.index + sd[0].length;
  let insAt = sheetXml.indexOf('</sheetData>', sdStart);
  for (const m of sheetXml.slice(sdStart).matchAll(/<row\b[^>]*\br="(\d+)"/g)) {
    if (parseInt(m[1]!, 10) > row) {
      insAt = sdStart + m.index!;
      break;
    }
  }
  return sheetXml.slice(0, insAt) + rowXml + sheetXml.slice(insAt);
}

/** Extract {sheet?, a1} from a grid anchor (a1 may be a range). */
function anchorA1(a: LogicalAnchor): { sheet?: string; a1: string } | null {
  const p = a.portable;
  if (p.kind !== 'grid') return null;
  let a1 = p.a1;
  let sheet: string | undefined;
  const bang = a1.indexOf('!');
  if (bang >= 0) {
    sheet = a1.slice(0, bang).replace(/^'|'$/g, '');
    a1 = a1.slice(bang + 1);
  }
  return sheet != null ? { sheet, a1 } : { a1 };
}

function resolveStylesPath(parts: OoxmlParts): string | null {
  if (parts['xl/styles.xml']) return 'xl/styles.xml';
  const k = Object.keys(parts).find((p) => /(^|\/)styles\.xml$/.test(p));
  return k ?? null;
}

/** Build the Excel OoxmlPatchCompiler: ChangeSet → sheet/styles XML patches + per-edit report. */
export function buildXlsxCompiler() {
  return async function compile(cs: ChangeSet, original: Uint8Array): Promise<OoxmlPatchResult> {
    const parts = unzipSync(original);
    const sheetCache = new Map<string, string>();
    const applied: EditId[] = [];
    const dropped: Array<{ editId: EditId; reason: string }> = [];

    const stylesPath = resolveStylesPath(parts);
    const styleBox: { ed: XlsxStyles | null } = { ed: null };
    const ensureStyles = (): XlsxStyles | null => {
      if (styleBox.ed) return styleBox.ed;
      if (!stylesPath || !parts[stylesPath]) return null;
      styleBox.ed = new XlsxStyles(dec.decode(parts[stylesPath]));
      return styleBox.ed;
    };
    const getSheet = (path: string): string => {
      const cached = sheetCache.get(path);
      if (cached !== undefined) return cached;
      const b = parts[path];
      if (!b) throw new Error(`missing part ${path}`);
      const xml = dec.decode(b);
      sheetCache.set(path, xml);
      return xml;
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
          for (const ref of cells) {
            let xml = getSheet(path);
            const hit = findCell(xml, ref);
            const newS = ed.resolveXf(hit?.sIdx, style);
            xml = upsertCell(xml, ref, restyleCellXml(ref, newS, hit), hit);
            sheetCache.set(path, xml);
          }
        } else {
          for (const ref of cells) {
            let xml = getSheet(path);
            const hit = findCell(xml, ref);
            let cellXml: string;
            if (kind === 'setFormula') {
              cellXml = formulaCellXml(ref, (edit.op as { formula: string }).formula ?? '', hit?.sIdx);
            } else if (kind === 'deleteRange') {
              if (!hit) continue; // target already empty; clearing is a no-op
              cellXml = valueCellXml(ref, null, hit.sIdx);
            } else {
              const value = (edit.op as { value: CellValue }).value ?? null;
              if (value === null && !hit) continue; // writing null to an empty cell; skip
              cellXml = valueCellXml(ref, value, hit?.sIdx);
            }
            xml = upsertCell(xml, ref, cellXml, hit);
            sheetCache.set(path, xml);
          }
        }
        applied.push(edit.id);
      } catch (e) {
        dropped.push({ editId: edit.id, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    const out: OoxmlParts = {};
    for (const [path, xml] of sheetCache) {
      const original = parts[path];
      if (!original || dec.decode(original) !== xml) out[path] = encoder.encode(xml);
    }
    if (styleBox.ed && styleBox.ed.dirty && stylesPath) out[stylesPath] = encoder.encode(styleBox.ed.toXml());
    return { parts: out, report: { applied, dropped } };
  };
}
