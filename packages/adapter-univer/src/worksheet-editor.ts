import type { CellValue } from '@otterpatch/core';
import { indexXmlElements, xmlAttribute, type XmlElementSpan } from './xml-tokenizer.js';

interface CellContent {
  kind: 'preserve' | 'replace';
  inner?: string;
}

interface CellRecord {
  ref: string;
  col: number;
  row: number;
  elementName: string;
  element?: XmlElementSpan;
  styleIndex?: number;
  type?: string;
  styleChanged: boolean;
  typeChanged: boolean;
  content: CellContent;
  changed: boolean;
}

interface RowRecord {
  row: number;
  elementName: string;
  element?: XmlElementSpan;
  cells: CellRecord[];
  changed: boolean;
}

interface TextPatch {
  start: number;
  end: number;
  text: string;
}

function parseRef(value: string): { ref: string; col: number; row: number } {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(value);
  if (!match) throw new Error(`invalid A1 reference ${value}`);
  let col = 0;
  for (const char of match[1]!.toUpperCase()) col = col * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (!Number.isSafeInteger(row)) throw new Error(`invalid A1 reference ${value}`);
  return { ref: match[1]!.toUpperCase() + row, col, row };
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

function applyPatches(xml: string, start: number, end: number, patches: TextPatch[]): string {
  const ordered = [...patches].sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = start;
  let output = '';
  for (const patch of ordered) {
    if (patch.start < cursor || patch.end < patch.start || patch.end > end) throw new Error('overlapping worksheet XML patches');
    output += xml.slice(cursor, patch.start) + patch.text;
    cursor = patch.end;
  }
  return output + xml.slice(cursor, end);
}

function groupedInsertions(items: Array<{ position: number; text: string }>): TextPatch[] {
  const grouped = new Map<number, string[]>();
  for (const item of items) {
    const values = grouped.get(item.position) ?? [];
    values.push(item.text);
    grouped.set(item.position, values);
  }
  return [...grouped].map(([position, values]) => ({ start: position, end: position, text: values.join('') }));
}

/** Parse once, accumulate cell mutations, then render one surgical worksheet patch. */
export class WorksheetXmlEditor {
  private readonly container: XmlElementSpan;
  private readonly rows = new Map<number, RowRecord>();
  private readonly cells = new Map<string, CellRecord>();
  private dirty = false;

  constructor(private readonly xml: string) {
    const elements = indexXmlElements(xml);
    const roots = elements.filter((element) => element.localName === 'worksheet' && element.parentStart === undefined);
    if (roots.length !== 1) throw new Error(`worksheet XML must contain exactly one worksheet root, found ${roots.length}`);
    const containers = elements.filter((element) => element.localName === 'sheetData' && element.parentStart === roots[0]!.start);
    if (containers.length !== 1) throw new Error(`worksheet must contain exactly one sheetData element, found ${containers.length}`);
    this.container = containers[0]!;

    const rowElements = elements
      .filter((element) => element.localName === 'row' && element.parentStart === this.container.start)
      .sort((left, right) => left.start - right.start);
    let previousRow = 0;
    for (const element of rowElements) {
      const rawRow = xmlAttribute(element, 'r');
      if (!rawRow || !/^[1-9][0-9]*$/.test(rawRow)) throw new Error('worksheet row has no valid r attribute');
      const row = Number(rawRow);
      if (!Number.isSafeInteger(row) || row <= previousRow) throw new Error(`worksheet rows are duplicate or out of order at ${rawRow}`);
      previousRow = row;
      const record: RowRecord = { row, elementName: element.name, element, cells: [], changed: false };
      this.rows.set(row, record);
    }

    const rowStarts = new Map([...this.rows.values()].map((row) => [row.element!.start, row]));
    const cellElements = elements
      .filter((element) => element.localName === 'c' && element.parentStart !== undefined && rowStarts.has(element.parentStart))
      .sort((left, right) => left.start - right.start);
    for (const element of cellElements) {
      const row = rowStarts.get(element.parentStart!)!;
      const rawRef = xmlAttribute(element, 'r');
      if (!rawRef) throw new Error(`row ${row.row} contains a cell without an explicit r attribute`);
      const parsed = parseRef(rawRef);
      if (parsed.row !== row.row) throw new Error(`cell ${rawRef} is stored in row ${row.row}`);
      const previousCell = row.cells.at(-1);
      if (previousCell && previousCell.col >= parsed.col) {
        throw new Error(`row ${row.row} cells are duplicate or out of order at ${rawRef}`);
      }
      if (this.cells.has(parsed.ref)) throw new Error(`worksheet contains duplicate cell ${parsed.ref}`);
      const rawStyle = xmlAttribute(element, 's');
      if (rawStyle !== undefined && !/^\d+$/.test(rawStyle)) throw new Error(`cell ${parsed.ref} has an invalid style index`);
      const cell: CellRecord = {
        ...parsed,
        elementName: element.name,
        element,
        ...(rawStyle !== undefined ? { styleIndex: Number(rawStyle) } : {}),
        styleChanged: false,
        typeChanged: false,
        content: { kind: 'preserve' },
        changed: false,
      };
      row.cells.push(cell);
      this.cells.set(parsed.ref, cell);
    }
  }

  hasCell(ref: string): boolean {
    return this.cells.has(parseRef(ref).ref);
  }

  cellStyleIndex(ref: string): number | undefined {
    return this.cells.get(parseRef(ref).ref)?.styleIndex;
  }

  setCellStyle(ref: string, styleIndex: number): void {
    const cell = this.ensureCell(ref);
    cell.styleIndex = styleIndex;
    cell.styleChanged = true;
    this.markChanged(cell);
  }

  setCellValue(ref: string, value: CellValue): void {
    const cell = this.ensureCell(ref);
    const name = (local: string): string => relatedName(cell.elementName, local);
    cell.typeChanged = true;
    if (value === null) {
      cell.type = undefined;
      cell.content = { kind: 'replace' };
    } else if (typeof value === 'number') {
      cell.type = undefined;
      cell.content = { kind: 'replace', inner: `<${name('v')}>${value}</${name('v')}>` };
    } else if (typeof value === 'boolean') {
      cell.type = 'b';
      cell.content = { kind: 'replace', inner: `<${name('v')}>${value ? 1 : 0}</${name('v')}>` };
    } else {
      cell.type = 'inlineStr';
      const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
      cell.content = { kind: 'replace', inner: `<${name('is')}><${name('t')}${space}>${escapeXml(value)}</${name('t')}></${name('is')}>` };
    }
    this.markChanged(cell);
  }

  setCellFormula(ref: string, formula: string): void {
    const cell = this.ensureCell(ref);
    const name = relatedName(cell.elementName, 'f');
    cell.type = undefined;
    cell.typeChanged = true;
    cell.content = { kind: 'replace', inner: `<${name}>${escapeXml(formula.replace(/^=/, ''))}</${name}>` };
    this.markChanged(cell);
  }

  toXml(): string {
    if (!this.dirty) return this.xml;
    const rows = [...this.rows.values()].sort((left, right) => left.row - right.row);
    const existingRows = rows.filter((row) => row.element);
    const newRows = rows.filter((row) => !row.element);

    if (this.container.selfClosing) {
      if (existingRows.length) throw new Error('self-closing sheetData cannot contain existing rows');
      const startTag = asOpenTag(this.xml.slice(this.container.start, this.container.startTagEnd));
      const content = newRows.map((row) => this.renderRow(row)).join('');
      const replacement = `${startTag}${content}</${this.container.name}>`;
      return this.xml.slice(0, this.container.start) + replacement + this.xml.slice(this.container.end);
    }

    const patches: TextPatch[] = existingRows
      .filter((row) => row.changed)
      .map((row) => ({ start: row.element!.start, end: row.element!.end, text: this.renderRow(row) }));
    const insertions: Array<{ position: number; text: string }> = [];
    for (const row of newRows) {
      let position = this.container.startTagEnd;
      for (const existing of existingRows) {
        if (existing.row > row.row) {
          position = existing.element!.start;
          break;
        }
        position = existing.element!.end;
      }
      insertions.push({ position, text: this.renderRow(row) });
    }
    patches.push(...groupedInsertions(insertions));
    return applyPatches(this.xml, 0, this.xml.length, patches);
  }

  private ensureCell(value: string): CellRecord {
    const parsed = parseRef(value);
    const existing = this.cells.get(parsed.ref);
    if (existing) return existing;
    let row = this.rows.get(parsed.row);
    if (!row) {
      row = {
        row: parsed.row,
        elementName: relatedName(this.container.name, 'row'),
        cells: [],
        changed: true,
      };
      this.rows.set(parsed.row, row);
    }
    const elementName = row.cells[0]?.elementName ?? relatedName(row.elementName, 'c');
    const cell: CellRecord = {
      ...parsed,
      elementName,
      styleChanged: false,
      typeChanged: false,
      content: { kind: 'replace' },
      changed: true,
    };
    row.cells.push(cell);
    this.cells.set(parsed.ref, cell);
    this.markChanged(cell);
    return cell;
  }

  private markChanged(cell: CellRecord): void {
    cell.changed = true;
    this.rows.get(cell.row)!.changed = true;
    this.dirty = true;
  }

  private renderCell(cell: CellRecord): string {
    if (cell.element) {
      const changes: Record<string, string | undefined> = {};
      if (cell.styleChanged) changes.s = cell.styleIndex === undefined ? undefined : String(cell.styleIndex);
      if (cell.typeChanged) changes.t = cell.type;
      const startTag = rewriteStartTag(this.xml, cell.element, changes);
      if (cell.content.kind === 'preserve') return startTag + this.xml.slice(cell.element.startTagEnd, cell.element.end);
      if (cell.content.inner === undefined) return asSelfClosingTag(startTag);
      return `${asOpenTag(startTag)}${cell.content.inner}</${cell.element.name}>`;
    }
    const style = cell.styleIndex !== undefined ? ` s="${cell.styleIndex}"` : '';
    const type = cell.type !== undefined ? ` t="${escapeXml(cell.type)}"` : '';
    const startTag = `<${cell.elementName} r="${cell.ref}"${style}${type}`;
    return cell.content.inner === undefined
      ? `${startTag}/>`
      : `${startTag}>${cell.content.inner}</${cell.elementName}>`;
  }

  private renderRow(row: RowRecord): string {
    const cells = [...row.cells].sort((left, right) => left.col - right.col);
    if (!row.element) {
      return `<${row.elementName} r="${row.row}">${cells.map((cell) => this.renderCell(cell)).join('')}</${row.elementName}>`;
    }
    if (row.element.selfClosing) {
      const startTag = asOpenTag(this.xml.slice(row.element.start, row.element.startTagEnd));
      return `${startTag}${cells.map((cell) => this.renderCell(cell)).join('')}</${row.element.name}>`;
    }

    const existing = cells.filter((cell) => cell.element);
    const added = cells.filter((cell) => !cell.element);
    const patches: TextPatch[] = existing
      .filter((cell) => cell.changed)
      .map((cell) => ({ start: cell.element!.start, end: cell.element!.end, text: this.renderCell(cell) }));
    const insertions: Array<{ position: number; text: string }> = [];
    for (const cell of added) {
      let position = row.element.startTagEnd;
      for (const current of existing) {
        if (current.col > cell.col) {
          position = current.element!.start;
          break;
        }
        position = current.element!.end;
      }
      insertions.push({ position, text: this.renderCell(cell) });
    }
    patches.push(...groupedInsertions(insertions));
    return applyPatches(this.xml, row.element.start, row.element.end, patches);
  }
}
