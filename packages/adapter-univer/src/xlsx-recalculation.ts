import type { OoxmlParts } from '@otterpatch/writeback-surgical';
import { indexXmlElements, xmlAttribute, type XmlElementSpan } from './xml-tokenizer.js';

const WORKBOOK_PART = 'xl/workbook.xml';
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const CONTENT_TYPES_PART = '[Content_Types].xml';
const CALC_CHAIN_PART = 'xl/calcChain.xml';
const CALC_CHAIN_RELATIONSHIPS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/calcChain',
]);

const CALC_PR_FOLLOWERS = new Set([
  'oleSize',
  'customWorkbookViews',
  'pivotCaches',
  'smartTagPr',
  'smartTagTypes',
  'webPublishing',
  'fileRecoveryPr',
  'webPublishObjects',
  'extLst',
]);

interface TextPatch {
  start: number;
  end: number;
  text: string;
}

export interface FormulaRecalculationPatch {
  parts: OoxmlParts;
  removedParts: string[];
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

function rewriteStartTag(xml: string, element: XmlElementSpan, changes: Record<string, string>): string {
  let tag = xml.slice(element.start, element.startTagEnd);
  const handled = new Set<string>();
  const attributes = element.attributes
    .filter((attribute) => Object.prototype.hasOwnProperty.call(changes, attribute.localName))
    .sort((left, right) => right.start - left.start);
  for (const attribute of attributes) {
    if (handled.has(attribute.localName)) throw new Error(`duplicate XML attribute ${attribute.localName}`);
    handled.add(attribute.localName);
    const start = attribute.start - element.start;
    const end = attribute.end - element.start;
    tag = tag.slice(0, start) + `${attribute.name}="${escapeXml(changes[attribute.localName]!)}"` + tag.slice(end);
  }
  for (const [name, value] of Object.entries(changes)) {
    if (handled.has(name)) continue;
    const selfClose = /\/\s*>$/.exec(tag);
    const insertAt = selfClose?.index ?? tag.lastIndexOf('>');
    if (insertAt < 0) throw new Error(`invalid start tag <${element.name}>`);
    tag = tag.slice(0, insertAt) + ` ${name}="${escapeXml(value)}"` + tag.slice(insertAt);
  }
  return tag;
}

function rootAndChildren(xml: string, rootName: string): { root: XmlElementSpan; children: XmlElementSpan[] } {
  const elements = indexXmlElements(xml);
  const roots = elements.filter((element) => element.localName === rootName && element.parentStart === undefined);
  if (roots.length !== 1) throw new Error(`${rootName} XML must contain exactly one ${rootName} root, found ${roots.length}`);
  const root = roots[0]!;
  return { root, children: elements.filter((element) => element.parentStart === root.start) };
}

function applyPatches(xml: string, patches: TextPatch[]): string {
  const ordered = [...patches].sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = 0;
  let output = '';
  for (const patch of ordered) {
    if (patch.start < cursor || patch.end < patch.start || patch.end > xml.length) {
      throw new Error('overlapping workbook metadata XML patches');
    }
    output += xml.slice(cursor, patch.start) + patch.text;
    cursor = patch.end;
  }
  return output + xml.slice(cursor);
}

function patchWorkbook(xml: string): string {
  const { root, children } = rootAndChildren(xml, 'workbook');
  const calculationProperties = children.filter((element) => element.localName === 'calcPr');
  if (calculationProperties.length > 1) throw new Error('workbook contains duplicate calcPr elements');

  const attributes = { calcMode: 'auto', fullCalcOnLoad: '1', forceFullCalc: '1' };
  const existing = calculationProperties[0];
  if (existing) {
    return applyPatches(xml, [{
      start: existing.start,
      end: existing.startTagEnd,
      text: rewriteStartTag(xml, existing, attributes),
    }]);
  }
  if (root.selfClosing) throw new Error('workbook root cannot be self-closing');

  const follower = children.find((element) => CALC_PR_FOLLOWERS.has(element.localName));
  const insertAt = follower?.start ?? root.endTagStart;
  const name = relatedName(root.name, 'calcPr');
  const calcPr = `<${name} calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`;
  return applyPatches(xml, [{ start: insertAt, end: insertAt, text: calcPr }]);
}

function normalizeWorkbookTarget(target: string): string {
  if (!target || target.includes('\\') || /[?#]/.test(target) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) {
    throw new Error(`invalid calcChain relationship target '${target}'`);
  }
  const resolved = target.startsWith('/') ? [] : ['xl'];
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!resolved.length) throw new Error(`invalid calcChain relationship target '${target}'`);
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}

function patchWorkbookRelationships(xml: string): string {
  const { children } = rootAndChildren(xml, 'Relationships');
  const patches: TextPatch[] = [];
  for (const relationship of children.filter((element) => element.localName === 'Relationship')) {
    const type = xmlAttribute(relationship, 'Type');
    const target = xmlAttribute(relationship, 'Target');
    const isCalcChainType = type !== undefined && CALC_CHAIN_RELATIONSHIPS.has(type);
    const mentionsCalcChain = target !== undefined && /(?:^|\/)calcChain\.xml$/i.test(target);
    if (!isCalcChainType && !mentionsCalcChain) continue;
    if (xmlAttribute(relationship, 'TargetMode')?.toLowerCase() === 'external' || !target) {
      if (isCalcChainType) throw new Error(`invalid calcChain relationship target '${target ?? ''}'`);
      continue;
    }
    const normalized = normalizeWorkbookTarget(target);
    if (normalized !== CALC_CHAIN_PART) {
      if (isCalcChainType) throw new Error(`invalid calcChain relationship target '${target}'`);
      continue;
    }
    patches.push({ start: relationship.start, end: relationship.end, text: '' });
  }
  return patches.length ? applyPatches(xml, patches) : xml;
}

function patchContentTypes(xml: string): string {
  const { children } = rootAndChildren(xml, 'Types');
  const patches = children
    .filter((element) => element.localName === 'Override')
    .filter((element) => {
      const partName = xmlAttribute(element, 'PartName');
      return partName === `/${CALC_CHAIN_PART}` || partName === CALC_CHAIN_PART;
    })
    .map((element) => ({ start: element.start, end: element.end, text: '' }));
  return patches.length ? applyPatches(xml, patches) : xml;
}

function patchXmlPart(
  source: OoxmlParts,
  output: OoxmlParts,
  path: string,
  patch: (xml: string) => string,
  required = false,
): void {
  const bytes = source[path];
  if (!bytes) {
    if (required) throw new Error(`missing ${path}; cannot configure formula recalculation`);
    return;
  }
  const decoder = new TextDecoder();
  const xml = decoder.decode(bytes);
  const updated = patch(xml);
  if (updated !== xml) output[path] = new TextEncoder().encode(updated);
}

/** Build the workbook-level changes required after a successful formula write. */
export function prepareFormulaRecalculation(parts: OoxmlParts): FormulaRecalculationPatch {
  const output: OoxmlParts = {};
  patchXmlPart(parts, output, WORKBOOK_PART, patchWorkbook, true);
  patchXmlPart(parts, output, WORKBOOK_RELS_PART, patchWorkbookRelationships);
  patchXmlPart(parts, output, CONTENT_TYPES_PART, patchContentTypes);
  return {
    parts: output,
    removedParts: parts[CALC_CHAIN_PART] ? [CALC_CHAIN_PART] : [],
  };
}
