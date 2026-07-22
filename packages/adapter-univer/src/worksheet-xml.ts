import type { CellValue } from '@otterpatch/core';
import { indexXmlElements, xmlAttribute, type XmlElementSpan } from './xml-tokenizer.js';

interface CellHit {
  element: XmlElementSpan;
  styleIndex?: number;
}

function parseRef(ref: string): { col: number; row: number } {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(ref);
  if (!match) throw new Error(`invalid A1 reference ${ref}`);
  let col = 0;
  for (const char of match[1]!.toUpperCase()) col = col * 26 + char.charCodeAt(0) - 64;
  return { col, row: Number(match[2]) };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relatedName(elementName: string, local: string): string {
  const colon = elementName.lastIndexOf(':');
  return colon >= 0 ? `${elementName.slice(0, colon + 1)}${local}` : local;
}

function worksheetStructure(xml: string): { container: XmlElementSpan; rows: XmlElementSpan[]; cells: XmlElementSpan[] } {
  const elements = indexXmlElements(xml);
  const worksheets = elements.filter((element) => element.localName === 'worksheet' && element.parentStart === undefined);
  if (worksheets.length !== 1) throw new Error(`worksheet XML must contain exactly one worksheet root, found ${worksheets.length}`);
  const sheetData = elements.filter((element) => element.localName === 'sheetData' && element.parentStart === worksheets[0]!.start);
  if (sheetData.length !== 1) throw new Error(`worksheet must contain exactly one sheetData element, found ${sheetData.length}`);
  const container = sheetData[0]!;
  const rows = elements.filter((element) => element.localName === 'row' && element.parentStart === container.start);
  const rowStarts = new Set(rows.map((row) => row.start));
  const cells = elements.filter((element) => element.localName === 'c' && element.parentStart !== undefined && rowStarts.has(element.parentStart));
  for (const row of rows) {
    if (xmlAttribute(row, 'r') === undefined) throw new Error('worksheet contains a row without an explicit r attribute');
  }
  for (const cell of cells) {
    if (xmlAttribute(cell, 'r') === undefined) throw new Error('worksheet contains a cell without an explicit r attribute');
  }
  return { container, rows, cells };
}

function findCell(xml: string, ref: string): CellHit | null {
  const matches = worksheetStructure(xml).cells.filter((cell) => xmlAttribute(cell, 'r')?.toUpperCase() === ref.toUpperCase());
  if (matches.length > 1) throw new Error(`worksheet contains duplicate cell ${ref}`);
  const element = matches[0];
  if (!element) return null;
  const style = xmlAttribute(element, 's');
  if (style !== undefined && !/^\d+$/.test(style)) throw new Error(`cell ${ref} has an invalid style index`);
  return { element, ...(style !== undefined ? { styleIndex: Number(style) } : {}) };
}

function rewriteStartTag(xml: string, element: XmlElementSpan, changes: Record<string, string | undefined>): string {
  let tag = xml.slice(element.start, element.startTagEnd);
  const handled = new Set<string>();
  const attributes = element.attributes
    .filter((attribute) => Object.prototype.hasOwnProperty.call(changes, attribute.localName))
    .sort((left, right) => right.start - left.start);
  for (const attribute of attributes) {
    if (handled.has(attribute.localName)) throw new Error(`duplicate XML attribute ${attribute.localName}`);
    handled.add(attribute.localName);
    const value = changes[attribute.localName];
    const replacement = value === undefined ? '' : `${attribute.name}="${escapeXml(value)}"`;
    const start = attribute.start - element.start;
    const end = attribute.end - element.start;
    tag = tag.slice(0, start) + replacement + tag.slice(end);
  }
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined || handled.has(name)) continue;
    const selfClose = /\/\s*>$/.exec(tag);
    const insertAt = selfClose?.index ?? tag.lastIndexOf('>');
    if (insertAt < 0) throw new Error(`invalid start tag <${element.name}>`);
    tag = tag.slice(0, insertAt) + ` ${name}="${escapeXml(value)}"` + tag.slice(insertAt);
  }
  return tag;
}

const asOpenTag = (tag: string): string => tag.replace(/\/\s*>$/, '>');
const asSelfClosingTag = (tag: string): string => /\/\s*>$/.test(tag)
  ? tag
  : tag.slice(0, tag.lastIndexOf('>')).replace(/\s+$/, '') + '/>';

function buildCell(
  xml: string,
  ref: string,
  styleIndex: number | undefined,
  type: string | undefined,
  inner: (name: (local: string) => string) => string | undefined,
  hit: CellHit | null,
  elementName: string,
): string {
  const name = (local: string): string => relatedName(elementName, local);
  const content = inner(name);
  if (hit) {
    const startTag = rewriteStartTag(xml, hit.element, { t: type });
    return content === undefined
      ? asSelfClosingTag(startTag)
      : `${asOpenTag(startTag)}${content}</${hit.element.name}>`;
  }
  const style = styleIndex !== undefined ? ` s="${styleIndex}"` : '';
  const cellType = type !== undefined ? ` t="${escapeXml(type)}"` : '';
  const startTag = `<${elementName} r="${ref}"${style}${cellType}`;
  return content === undefined ? `${startTag}/>` : `${startTag}>${content}</${elementName}>`;
}

function valueCell(xml: string, ref: string, value: CellValue, hit: CellHit | null, elementName: string): string {
  if (value === null) return buildCell(xml, ref, hit?.styleIndex, undefined, () => undefined, hit, elementName);
  if (typeof value === 'number') {
    return buildCell(xml, ref, hit?.styleIndex, undefined, (name) => `<${name('v')}>${value}</${name('v')}>`, hit, elementName);
  }
  if (typeof value === 'boolean') {
    return buildCell(xml, ref, hit?.styleIndex, 'b', (name) => `<${name('v')}>${value ? 1 : 0}</${name('v')}>`, hit, elementName);
  }
  const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
  return buildCell(xml, ref, hit?.styleIndex, 'inlineStr', (name) => (
    `<${name('is')}><${name('t')}${space}>${escapeXml(value)}</${name('t')}></${name('is')}>`
  ), hit, elementName);
}

function formulaCell(xml: string, ref: string, formula: string, hit: CellHit | null, elementName: string): string {
  return buildCell(xml, ref, hit?.styleIndex, undefined, (name) => (
    `<${name('f')}>${escapeXml(formula.replace(/^=/, ''))}</${name('f')}>`
  ), hit, elementName);
}

function styleCell(xml: string, ref: string, styleIndex: number, hit: CellHit | null, elementName: string): string {
  if (!hit) return `<${elementName} r="${ref}" s="${styleIndex}"/>`;
  return rewriteStartTag(xml, hit.element, { s: String(styleIndex) })
    + xml.slice(hit.element.startTagEnd, hit.element.end);
}

function upsertCell(xml: string, ref: string, hit: CellHit | null, makeCell: (elementName: string) => string): string {
  if (hit) {
    const replacement = makeCell(hit.element.name);
    return xml.slice(0, hit.element.start) + replacement + xml.slice(hit.element.end);
  }
  const { col, row } = parseRef(ref);
  const { container, rows, cells } = worksheetStructure(xml);
  const matchingRows = rows.filter((element) => Number(xmlAttribute(element, 'r')) === row);
  if (matchingRows.length > 1) throw new Error(`worksheet contains duplicate row ${row}`);
  const targetRow = matchingRows[0];
  if (targetRow) {
    const directCells = cells.filter((element) => element.parentStart === targetRow.start);
    const cellName = directCells[0]?.name ?? relatedName(targetRow.name, 'c');
    const cellXml = makeCell(cellName);
    if (targetRow.selfClosing) {
      const startTag = asOpenTag(xml.slice(targetRow.start, targetRow.startTagEnd));
      const replacement = `${startTag}${cellXml}</${targetRow.name}>`;
      return xml.slice(0, targetRow.start) + replacement + xml.slice(targetRow.end);
    }
    let insertAt = targetRow.startTagEnd;
    for (const cell of directCells) {
      const cellRef = xmlAttribute(cell, 'r');
      if (!cellRef) throw new Error(`row ${row} contains a cell without an explicit r attribute`);
      if (parseRef(cellRef).col > col) {
        insertAt = cell.start;
        break;
      }
      insertAt = cell.end;
    }
    return xml.slice(0, insertAt) + cellXml + xml.slice(insertAt);
  }

  const rowName = relatedName(container.name, 'row');
  const cellName = relatedName(container.name, 'c');
  const rowXml = `<${rowName} r="${row}">${makeCell(cellName)}</${rowName}>`;
  if (container.selfClosing) {
    const startTag = asOpenTag(xml.slice(container.start, container.startTagEnd));
    const replacement = `${startTag}${rowXml}</${container.name}>`;
    return xml.slice(0, container.start) + replacement + xml.slice(container.end);
  }
  const directRows = rows.filter((element) => element.parentStart === container.start);
  let insertAt = container.startTagEnd;
  for (const candidate of directRows) {
    if (Number(xmlAttribute(candidate, 'r')) > row) {
      insertAt = candidate.start;
      break;
    }
    insertAt = candidate.end;
  }
  return xml.slice(0, insertAt) + rowXml + xml.slice(insertAt);
}

export function worksheetCellStyleIndex(xml: string, ref: string): number | undefined {
  return findCell(xml, ref)?.styleIndex;
}

export function worksheetHasCell(xml: string, ref: string): boolean {
  return findCell(xml, ref) !== null;
}

export function setWorksheetCellValue(xml: string, ref: string, value: CellValue): string {
  const hit = findCell(xml, ref);
  return upsertCell(xml, ref, hit, (elementName) => valueCell(xml, ref, value, hit, elementName));
}

export function setWorksheetCellFormula(xml: string, ref: string, formula: string): string {
  const hit = findCell(xml, ref);
  return upsertCell(xml, ref, hit, (elementName) => formulaCell(xml, ref, formula, hit, elementName));
}

export function setWorksheetCellStyle(xml: string, ref: string, styleIndex: number): string {
  const hit = findCell(xml, ref);
  return upsertCell(xml, ref, hit, (elementName) => styleCell(xml, ref, styleIndex, hit, elementName));
}
