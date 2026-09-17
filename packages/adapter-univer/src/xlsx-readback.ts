/**
 * Deterministic post-write-back semantic read-back for xlsx.
 *
 * The runtime refuses to trust the backend's commit-time estimate: after the surgical
 * worksheet patch we re-open the written workbook, parse the target sheet's cells and
 * styles, and check each applied edit's intended effect against the bytes on disk:
 *  · setValue       → the cell now carries exactly the requested value;
 *  · setFormula     → the cell carries exactly the requested formula text;
 *  · setNumberFormat→ the cell's style resolves to the requested number-format code;
 *  · setStyle       → the cell's style resolves to the requested font/fill/alignment;
 *  · deleteRange    → every cell in the range is gone or empty.
 *
 * Formula cached results are deliberately NOT checked: the writer clears them and forces
 * a full recalculation on open, so the computed values are the host application's job.
 */
import { assertA1RangeBudget, type CellValue, type ChangeSet, type EditId, type LogicalAnchor } from '@otterpatch/core';
import { readOoxmlParts, type OoxmlSemanticOutcome } from '@otterpatch/writeback-surgical';
import { resolveSheetPart } from './xlsx-patch.js';
import { toArgb, type AbstractCellStyle } from './xlsx-styles.js';
import { indexXmlElements, xmlAttribute, type XmlElementSpan } from './xml-tokenizer.js';

const dec = new TextDecoder();

/** Builtin numFmtId codes Excel predefines (custom formats are registered from 164). */
const BUILTIN_NUM_FMT: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
  22: 'm/d/yy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

export interface XlsxCellState {
  ref: string;
  /** t attribute (absent → number). */
  type?: string;
  styleIndex?: number;
  value?: CellValue;
  formula?: string;
  empty: boolean;
}

interface FontModel { bold?: boolean; italic?: boolean; sz?: string; name?: string; colorRgb?: string }

interface XfModel {
  numFmtId: number;
  fontId: number;
  fillId: number;
  alignmentHorizontal?: string;
}

export interface XlsxStyleTables {
  numFmts: Map<number, string>;
  fonts: FontModel[];
  fills: Array<{ fgColor?: string }>;
  cellXfs: XfModel[];
}

export interface XlsxReadbackModel {
  cells: Map<string, XlsxCellState>;
  styles: XlsxStyleTables;
}

const attrOf = (el: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(el)?.[1];

function parseFont(el: string): FontModel {
  return {
    bold: /<b\b[^>]*\/?>/.test(el),
    italic: /<i\b[^>]*\/?>/.test(el),
    sz: attrOf(/<sz\b[^>]*\/?>/.exec(el)?.[0] ?? '', 'val'),
    name: attrOf(/<name\b[^>]*\/?>/.exec(el)?.[0] ?? '', 'val'),
    colorRgb: attrOf(/<color\b[^>]*\/?>/.exec(el)?.[0] ?? '', 'rgb'),
  };
}

function parseFill(el: string): { fgColor?: string } {
  return { fgColor: attrOf(/<fgColor\b[^>]*\/?>/.exec(el)?.[0] ?? '', 'rgb') };
}

function parseXf(el: string): XfModel {
  const align = /<alignment\b[^>]*\/?>/.exec(el)?.[0] ?? '';
  return {
    numFmtId: Number(attrOf(el, 'numFmtId') ?? 0),
    fontId: Number(attrOf(el, 'fontId') ?? 0),
    fillId: Number(attrOf(el, 'fillId') ?? 0),
    ...(align ? { alignmentHorizontal: attrOf(align, 'horizontal') } : {}),
  };
}

function sectionItems(xml: string, tag: string, itemTag: string): string[] | null {
  const open = new RegExp(`<${tag}\\b[^>]*?(/?)>`).exec(xml);
  if (!open) return null;
  if (open[1] === '/') return [];
  const start = open.index + open[0].length;
  const end = xml.indexOf(`</${tag}>`, start);
  if (end < 0) return [];
  const inner = xml.slice(start, end);
  const re = new RegExp(`<${itemTag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${itemTag}>)`, 'g');
  return [...inner.matchAll(re)].map((m) => m[0]);
}

function parseStyles(stylesXml: string | undefined): XlsxStyleTables {
  const numFmts = new Map<number, string>();
  for (const el of sectionItems(stylesXml ?? '', 'numFmts', 'numFmt') ?? []) {
    const id = Number(attrOf(el, 'numFmtId'));
    const code = attrOf(el, 'formatCode');
    if (Number.isFinite(id) && code !== undefined) numFmts.set(id, code);
  }
  return {
    numFmts,
    fonts: (sectionItems(stylesXml ?? '', 'fonts', 'font') ?? []).map(parseFont),
    fills: (sectionItems(stylesXml ?? '', 'fills', 'fill') ?? []).map(parseFill),
    cellXfs: (sectionItems(stylesXml ?? '', 'cellXfs', 'xf') ?? []).map(parseXf),
  };
}

function cellValueFrom(element: XmlElementSpan, xml: string, type: string | undefined): { value?: CellValue; formula?: string; empty: boolean } {
  if (element.selfClosing) return { empty: true };
  const inner = xml.slice(element.startTagEnd, element.endTagStart);
  const formulaMatch = /<[a-zA-Z0-9]*:?f\b[^>]*>([\s\S]*?)<\/[a-zA-Z0-9]*:?f>/.exec(inner);
  const formula = formulaMatch ? formulaMatch[1]! : undefined;
  if (type === 'inlineStr') {
    const textMatch = /<[a-zA-Z0-9]*:?t\b[^>]*>([\s\S]*?)<\/[a-zA-Z0-9]*:?t>/.exec(inner);
    if (!textMatch) return { ...(formula !== undefined ? { formula } : {}), empty: !formula };
    const text = textMatch[1]!
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return { ...(formula !== undefined ? { formula } : {}), value: text, empty: false };
  }
  const valueMatch = /<[a-zA-Z0-9]*:?v\b[^>]*>([\s\S]*?)<\/[a-zA-Z0-9]*:?v>/.exec(inner);
  if (!valueMatch) return { ...(formula !== undefined ? { formula } : {}), empty: !formula };
  const raw = valueMatch[1]!;
  if (type === 'b') return { ...(formula !== undefined ? { formula } : {}), value: raw === '1' || raw.toLowerCase() === 'true', empty: false };
  if (type === 'str') return { ...(formula !== undefined ? { formula } : {}), value: raw, empty: false };
  const numeric = Number(raw);
  return { ...(formula !== undefined ? { formula } : {}), value: Number.isFinite(numeric) ? numeric : raw, empty: false };
}

/** Read the target sheet's cells and the workbook style tables from written xlsx bytes. */
export function readXlsxReadback(bytes: Uint8Array, sheetName?: string): XlsxReadbackModel {
  const parts = readOoxmlParts(bytes);
  const sheetPart = resolveSheetPart(parts, sheetName);
  const sheetXml = dec.decode(parts[sheetPart]!);
  const stylesPath = parts['xl/styles.xml'] ? 'xl/styles.xml' : Object.keys(parts).find((p) => /(^|\/)styles\.xml$/.test(p));
  const styles = parseStyles(stylesPath ? dec.decode(parts[stylesPath]) : undefined);

  const elements = indexXmlElements(sheetXml);
  const worksheet = elements.find((element) => element.localName === 'worksheet' && element.parentStart === undefined);
  const sheetData = elements.find((element) => element.localName === 'sheetData' && element.parentStart === worksheet?.start);
  const rowStarts = new Set(
    (sheetData
      ? elements.filter((element) => element.localName === 'row' && element.parentStart === sheetData.start)
      : []).map((element) => element.start),
  );
  const cells = new Map<string, XlsxCellState>();
  for (const element of elements) {
    if (element.localName !== 'c' || !rowStarts.has(element.parentStart ?? -1)) continue;
    const ref = xmlAttribute(element, 'r');
    if (!ref) continue;
    const type = xmlAttribute(element, 't');
    const styleRaw = xmlAttribute(element, 's');
    const parsed = cellValueFrom(element, sheetXml, type);
    cells.set(ref, {
      ref,
      ...(type !== undefined ? { type } : {}),
      ...(styleRaw !== undefined && /^\d+$/.test(styleRaw) ? { styleIndex: Number(styleRaw) } : {}),
      ...(parsed.formula !== undefined ? { formula: parsed.formula } : {}),
      ...(parsed.value !== undefined ? { value: parsed.value } : {}),
      empty: parsed.empty,
    });
  }
  return { cells, styles };
}

/** A1 (optionally sheet-qualified) → list of cell refs, mirroring the writer's expansion. */
export function expandA1(a1: string): string[] {
  assertA1RangeBudget(a1);
  const unqualified = a1.slice(a1.lastIndexOf('!') + 1).replace(/\$/g, '').trim();
  const [from, to] = unqualified.split(':');
  if (!to) return [from!];
  const parseRef = (value: string): { col: number; row: number } => {
    const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(value)!;
    let col = 0;
    for (const char of match[1]!.toUpperCase()) col = col * 26 + char.charCodeAt(0) - 64;
    return { col, row: Number(match[2]) };
  };
  const colToNum = (n: number): string => {
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const a = parseRef(from!);
  const b = parseRef(to);
  const out: string[] = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) out.push(colToNum(c) + r);
  }
  return out;
}

/** The canonical {sheet, a1} pair from the core grid-locator contract. */
export function anchorA1(a: LogicalAnchor): { sheet: string; a1: string } {
  const p = a.portable;
  if (p.kind !== 'grid') throw new Error('excel readback requires a grid anchor');
  if (!p.sheet.trim()) throw new Error('grid anchor sheet is empty');
  let a1 = p.a1;
  const bang = a1.lastIndexOf('!');
  if (bang >= 0) a1 = a1.slice(bang + 1);
  return { sheet: p.sheet, a1 };
}

function numberFormatOf(model: XlsxReadbackModel, styleIndex: number | undefined): string | undefined {
  if (styleIndex === undefined) return BUILTIN_NUM_FMT[0];
  const xf = model.styles.cellXfs[styleIndex];
  if (!xf) return undefined;
  return model.styles.numFmts.get(xf.numFmtId) ?? BUILTIN_NUM_FMT[xf.numFmtId];
}

function checkValue(cell: XlsxCellState | undefined, expected: CellValue): string | undefined {
  if (expected === null) {
    if (cell && !cell.empty) return `expected empty cell, read back ${JSON.stringify(cell.value ?? cell.formula ?? '')}`;
    return undefined;
  }
  if (!cell || cell.empty) return `expected ${JSON.stringify(expected)}, read back an empty cell`;
  if (typeof expected === 'number') return cell.value === expected ? undefined : `expected ${expected}, read back ${JSON.stringify(cell.value)}`;
  if (typeof expected === 'boolean') return cell.value === expected ? undefined : `expected ${expected}, read back ${JSON.stringify(cell.value)}`;
  return cell.value === expected ? undefined : `expected ${JSON.stringify(expected)}, read back ${JSON.stringify(cell.value)}`;
}

function checkStyle(model: XlsxReadbackModel, styleIndex: number | undefined, style: { bold?: boolean; italic?: boolean; color?: string; bgColor?: string; align?: string }): string | undefined {
  if (style.bold != null) {
    const font = model.styles.fonts[model.styles.cellXfs[styleIndex ?? 0]?.fontId ?? 0];
    if (!!font?.bold !== style.bold) return `expected bold=${style.bold}, cell font has bold=${!!font?.bold}`;
  }
  if (style.italic != null) {
    const font = model.styles.fonts[model.styles.cellXfs[styleIndex ?? 0]?.fontId ?? 0];
    if (!!font?.italic !== style.italic) return `expected italic=${style.italic}, cell font has italic=${!!font?.italic}`;
  }
  if (style.color != null) {
    const font = model.styles.fonts[model.styles.cellXfs[styleIndex ?? 0]?.fontId ?? 0];
    const expected = toArgb(style.color);
    if ((font?.colorRgb ?? '').toUpperCase() !== expected) return `expected font color ${expected}, cell font has ${font?.colorRgb ?? '(none)'}`;
  }
  if (style.bgColor != null) {
    const fill = model.styles.fills[model.styles.cellXfs[styleIndex ?? 0]?.fillId ?? 0];
    const expected = toArgb(style.bgColor);
    if ((fill?.fgColor ?? '').toUpperCase() !== expected) return `expected fill color ${expected}, cell fill has ${fill?.fgColor ?? '(none)'}`;
  }
  if (style.align != null) {
    const horizontal = model.styles.cellXfs[styleIndex ?? 0]?.alignmentHorizontal;
    if (horizontal !== style.align) return `expected alignment ${style.align}, cell style has ${horizontal ?? '(none)'}`;
  }
  return undefined;
}

export interface XlsxReadbackOutcome extends OoxmlSemanticOutcome {
  warnings: string[];
}

/**
 * Verify every applied edit against the written workbook. Edits the caller already knows
 * were dropped are excluded (the caller preserves their failures). Formula edits verify
 * the formula text; their cached results are the host application's job (see module doc).
 */
export function verifyXlsxReadback(bytes: Uint8Array, cs: ChangeSet, appliedIds: ReadonlySet<EditId>): XlsxReadbackOutcome {
  const verified: EditId[] = [];
  const unverifiable: EditId[] = [];
  const failed: Array<{ editId: EditId; reason: string }> = [];
  const warnings: string[] = [];
  let formulaWarned = false;

  const models = new Map<string, XlsxReadbackModel>();
  const modelFor = (sheet: string): XlsxReadbackModel => {
    const cached = models.get(sheet);
    if (cached) return cached;
    const model = readXlsxReadback(bytes, sheet);
    models.set(sheet, model);
    return model;
  };

  for (const edit of cs.edits) {
    if (!appliedIds.has(edit.id)) continue;
    try {
      const { sheet, a1 } = anchorA1(cs.anchors[edit.target]!);
      const model = modelFor(sheet);
      const refs = expandA1(a1);
      let reason: string | undefined;

      switch (edit.op.kind) {
        case 'setValue': {
          for (const ref of refs) {
            reason = checkValue(model.cells.get(ref), edit.op.value);
            if (reason) { reason = `cell ${ref}: ${reason}`; break; }
          }
          break;
        }
        case 'setFormula': {
          const expected = edit.op.formula.replace(/^=/, '');
          for (const ref of refs) {
            const cell = model.cells.get(ref);
            if (!cell || cell.formula !== expected) {
              reason = `cell ${ref}: expected formula ${JSON.stringify(expected)}, read back ${cell?.formula !== undefined ? JSON.stringify(cell.formula) : '(none)'}`;
              break;
            }
          }
          if (!reason && !formulaWarned) {
            formulaWarned = true;
            warnings.push('formula cached results are not recalculated by write-back; the host application computes them on open');
          }
          break;
        }
        case 'setNumberFormat': {
          for (const ref of refs) {
            const actual = numberFormatOf(model, model.cells.get(ref)?.styleIndex);
            if (actual !== edit.op.pattern) {
              reason = `cell ${ref}: expected number format ${JSON.stringify(edit.op.pattern)}, read back ${actual !== undefined ? JSON.stringify(actual) : '(unresolvable style)'}`;
              break;
            }
          }
          break;
        }
        case 'setStyle': {
          for (const ref of refs) {
            reason = checkStyle(model, model.cells.get(ref)?.styleIndex, edit.op.style);
            if (reason) { reason = `cell ${ref}: ${reason}`; break; }
          }
          break;
        }
        case 'deleteRange': {
          for (const ref of refs) {
            reason = checkValue(model.cells.get(ref), null);
            if (reason) { reason = `cell ${ref}: ${reason}`; break; }
          }
          break;
        }
        default:
          unverifiable.push(edit.id);
          continue;
      }

      if (reason) failed.push({ editId: edit.id, reason });
      else verified.push(edit.id);
    } catch (error) {
      failed.push({ editId: edit.id, reason: `read-back failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return { verifiedEdits: verified, unverifiableEdits: unverifiable, failedEdits: failed, warnings };
}
