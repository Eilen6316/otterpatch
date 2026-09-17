/**
 * Deterministic post-write-back semantic read-back for word/document.xml.
 *
 * The runtime refuses to trust a backend's optimistic commit-time claims: after the surgical
 * redline write-back we re-derive what Word itself would show after "Accept All Changes"
 * (unwrap <w:ins>, drop <w:del> and its delText, drop paragraphs whose paragraph mark carries
 * a deletion revision, drop the original-property <w:rPrChange>/<w:pPrChange>) and compare
 * the resulting document text against a text-level simulation of the ChangeSet.
 *
 * This is the same criterion the redline notes describe as the stronger future check
 * (unzip → accept all revisions → compare), implemented in TypeScript without requiring a
 * LibreOffice subprocess.
 */

const TOP_LEVEL_BLOCK = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g;

/** Top-level blocks of the body: each <w:tbl> counts as ONE block (mirrors the writer and the workspace importer). */
export function splitTopLevelBlocks(documentXml: string): string[] {
  return [...documentXml.matchAll(TOP_LEVEL_BLOCK)].map((match) => match[0]);
}

const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** All visible text of a paragraph element (every <w:t>, including nested ones e.g. inside hyperlinks). */
export function paragraphText(para: string): string {
  let text = '';
  for (const match of para.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) text += unescapeXml(match[1]!);
  return text;
}

/** Text of a table element: cells joined by tab within a row, rows by newline (same shape the simulation produces). */
function tableText(table: string): string {
  const rows: string[] = [];
  for (const rowMatch of table.matchAll(/<w:tr\b[^>]*\/>|<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<w:tc\b[^>]*\/>|<w:tc\b[\s\S]*?<\/w:tc>/g)) {
      cells.push(paragraphText(cellMatch[0]));
    }
    rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

export interface TextBlock {
  kind: 'paragraph' | 'table';
  text: string;
}

/** Extract the document as top-level text blocks (paragraph or table) in body order. */
export function extractTextBlocks(documentXml: string): TextBlock[] {
  return splitTopLevelBlocks(documentXml).map((block) => ({
    kind: block.startsWith('<w:tbl') ? 'table' : 'paragraph',
    text: block.startsWith('<w:tbl') ? tableText(block) : paragraphText(block),
  }));
}

/** Depth-aware extraction of a paragraph's direct <w:pPr> child (pPrChange may nest a <w:pPr>). */
function paragraphProperties(para: string): string {
  const open = /^<w:p\b[^>]*>/.exec(para)?.[0];
  if (!open) return '';
  const inner = para.slice(open.length, para.length - '</w:p>'.length);
  if (/^\s*<w:pPr\b[^>]*\/>/.test(inner)) return /^\s*(<w:pPr\b[^>]*\/>)/.exec(inner)![1]!;
  if (!/^\s*<w:pPr\b/.test(inner)) return '';
  const re = /<w:pPr\b(?:[^>]*[^/])?>|<\/w:pPr>/g;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(inner))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return inner.slice(0, re.lastIndex);
  }
  return '';
}

/** Drop paragraphs whose pPr marks the paragraph mark itself as deleted (accepting leaves no empty paragraph). */
function dropParagraphMarkDeletions(documentXml: string): string {
  return documentXml.replace(
    /<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g,
    (para) => {
      const pPr = paragraphProperties(para);
      return /<w:del\b[^>]*\/>/.test(pPr) ? '' : para;
    },
  );
}

/**
 * Accept every revision in document.xml:
 *  - paragraphs with a paragraph-mark deletion vanish entirely;
 *  - <w:del>…</w:del> (and <w:delText>) are removed; <w:ins>…</w:ins> is unwrapped;
 *  - <w:rPrChange>/<w:pPrChange> (the original-property snapshots) are dropped.
 * Elements this writer never emits (moveFrom/moveTo, cellIns/…) are left untouched.
 */
export function acceptRevisions(documentXml: string): string {
  let xml = dropParagraphMarkDeletions(documentXml);
  xml = xml.replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, '$1');
  xml = xml.replace(/<w:ins\b[^>]*\/>/g, '');
  xml = xml.replace(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/g, '');
  xml = xml.replace(/<w:del\b[^>]*\/>/g, '');
  xml = xml.replace(/<w:rPrChange\b[^>]*>([\s\S]*?)<\/w:rPrChange>/g, '');
  xml = xml.replace(/<w:rPrChange\b[^>]*\/>/g, '');
  xml = xml.replace(/<w:pPrChange\b[^>]*>([\s\S]*?)<\/w:pPrChange>/g, '');
  xml = xml.replace(/<w:pPrChange\b[^>]*\/>/g, '');
  return xml;
}
