export interface XmlAttributeSpan {
  name: string;
  localName: string;
  value: string;
  start: number;
  end: number;
}

export interface XmlElementSpan {
  name: string;
  localName: string;
  start: number;
  startTagEnd: number;
  endTagStart: number;
  end: number;
  selfClosing: boolean;
  attributes: XmlAttributeSpan[];
  depth: number;
  parentStart?: number;
}

interface StartTag {
  kind: 'start';
  name: string;
  localName: string;
  start: number;
  end: number;
  selfClosing: boolean;
  attributes: XmlAttributeSpan[];
}

interface EndTag {
  kind: 'end';
  name: string;
  start: number;
  end: number;
}

type Tag = StartTag | EndTag;

const localName = (name: string): string => name.slice(name.lastIndexOf(':') + 1);
const whitespace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char);

function decodeAttribute(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\dA-Fa-f]+)|(amp|lt|gt|quot|apos));/g, (_entity, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return named === 'amp' ? '&' : named === 'lt' ? '<' : named === 'gt' ? '>' : named === 'quot' ? '"' : "'";
  });
}

function specialMarkupEnd(xml: string, start: number): number | null {
  if (xml.startsWith('<!--', start)) {
    const end = xml.indexOf('-->', start + 4);
    if (end < 0) throw new Error('unterminated XML comment');
    return end + 3;
  }
  if (xml.startsWith('<![CDATA[', start)) {
    const end = xml.indexOf(']]>', start + 9);
    if (end < 0) throw new Error('unterminated XML CDATA section');
    return end + 3;
  }
  if (xml.startsWith('<?', start)) {
    const end = xml.indexOf('?>', start + 2);
    if (end < 0) throw new Error('unterminated XML processing instruction');
    return end + 2;
  }
  if (!xml.startsWith('<!', start)) return null;

  let quote = '';
  let subsetDepth = 0;
  for (let index = start + 2; index < xml.length; index++) {
    const char = xml[index]!;
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '[') {
      subsetDepth++;
    } else if (char === ']') {
      subsetDepth = Math.max(0, subsetDepth - 1);
    } else if (char === '>' && subsetDepth === 0) {
      return index + 1;
    }
  }
  throw new Error('unterminated XML declaration');
}

function readName(xml: string, cursor: number): { name: string; cursor: number } {
  const start = cursor;
  while (cursor < xml.length && !whitespace(xml[cursor]) && !['/', '>', '='].includes(xml[cursor]!)) cursor++;
  if (cursor === start) throw new Error(`invalid XML name at offset ${start}`);
  const name = xml.slice(start, cursor);
  if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(name)) throw new Error(`unsupported XML name ${name}`);
  return { name, cursor };
}

function readTag(xml: string, start: number): Tag {
  let cursor = start + 1;
  const closing = xml[cursor] === '/';
  if (closing) cursor++;
  while (whitespace(xml[cursor])) cursor++;
  const parsedName = readName(xml, cursor);
  const name = parsedName.name;
  cursor = parsedName.cursor;

  if (closing) {
    while (whitespace(xml[cursor])) cursor++;
    if (xml[cursor] !== '>') throw new Error(`invalid XML closing tag </${name}>`);
    return { kind: 'end', name, start, end: cursor + 1 };
  }

  const attributes: XmlAttributeSpan[] = [];
  let selfClosing = false;
  let closed = false;
  while (cursor < xml.length) {
    while (whitespace(xml[cursor])) cursor++;
    if (xml[cursor] === '>') {
      cursor++;
      closed = true;
      break;
    }
    if (xml[cursor] === '/') {
      selfClosing = true;
      cursor++;
      while (whitespace(xml[cursor])) cursor++;
      if (xml[cursor] !== '>') throw new Error(`invalid self-closing XML tag <${name}>`);
      cursor++;
      closed = true;
      break;
    }

    const attributeStart = cursor;
    const parsedAttribute = readName(xml, cursor);
    cursor = parsedAttribute.cursor;
    while (whitespace(xml[cursor])) cursor++;
    if (xml[cursor] !== '=') throw new Error(`XML attribute ${parsedAttribute.name} has no value`);
    cursor++;
    while (whitespace(xml[cursor])) cursor++;
    const quote = xml[cursor];
    if (quote !== '"' && quote !== "'") throw new Error(`XML attribute ${parsedAttribute.name} must be quoted`);
    const valueStart = ++cursor;
    const valueEnd = xml.indexOf(quote, valueStart);
    if (valueEnd < 0) throw new Error(`unterminated XML attribute ${parsedAttribute.name}`);
    cursor = valueEnd + 1;
    if (attributes.some((attribute) => attribute.name === parsedAttribute.name)) {
      throw new Error(`duplicate XML attribute ${parsedAttribute.name}`);
    }
    attributes.push({
      name: parsedAttribute.name,
      localName: localName(parsedAttribute.name),
      value: decodeAttribute(xml.slice(valueStart, valueEnd)),
      start: attributeStart,
      end: cursor,
    });
  }
  if (!closed) throw new Error(`unterminated XML tag <${name}>`);
  return { kind: 'start', name, localName: localName(name), start, end: cursor, selfClosing, attributes };
}

function tags(xml: string): Tag[] {
  const result: Tag[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) break;
    const specialEnd = specialMarkupEnd(xml, start);
    if (specialEnd !== null) {
      cursor = specialEnd;
      continue;
    }
    const tag = readTag(xml, start);
    result.push(tag);
    cursor = tag.end;
  }
  return result;
}

/** Index element spans without serializing or otherwise changing the source XML. */
export function indexXmlElements(xml: string): XmlElementSpan[] {
  const result: XmlElementSpan[] = [];
  const stack: Array<StartTag & { depth: number; parentStart?: number }> = [];
  for (const tag of tags(xml)) {
    if (tag.kind === 'start') {
      const depth = stack.length;
      const parentStart = stack.at(-1)?.start;
      if (tag.selfClosing) {
        result.push({
          name: tag.name,
          localName: tag.localName,
          start: tag.start,
          startTagEnd: tag.end,
          endTagStart: tag.end,
          end: tag.end,
          selfClosing: true,
          attributes: tag.attributes,
          depth,
          ...(parentStart !== undefined ? { parentStart } : {}),
        });
      } else {
        stack.push({ ...tag, depth, ...(parentStart !== undefined ? { parentStart } : {}) });
      }
      continue;
    }

    const open = stack.pop();
    if (!open || open.name !== tag.name) {
      throw new Error(`mismatched XML closing tag </${tag.name}>`);
    }
    result.push({
      name: open.name,
      localName: open.localName,
      start: open.start,
      startTagEnd: open.end,
      endTagStart: tag.start,
      end: tag.end,
      selfClosing: false,
      attributes: open.attributes,
      depth: open.depth,
      ...(open.parentStart !== undefined ? { parentStart: open.parentStart } : {}),
    });
  }
  if (stack.length) throw new Error(`unclosed XML tag <${stack.at(-1)!.name}>`);
  return result.sort((left, right) => left.start - right.start);
}

export function xmlAttribute(element: XmlElementSpan, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.localName === name)?.value;
}
