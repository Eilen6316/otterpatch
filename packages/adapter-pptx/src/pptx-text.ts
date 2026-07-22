import type { ChangeSet, VerifyReport } from '@otterpatch/core';
import { readOoxmlParts } from '@otterpatch/writeback-surgical';

export interface PptxTextParagraphSnapshot {
  runs: string[];
}

export interface PptxTextSlideSnapshot {
  paragraphs: PptxTextParagraphSnapshot[];
}

export interface PptxTextSnapshot {
  slides: PptxTextSlideSnapshot[];
}

interface IndexedRun {
  index: number;
  text: string;
}

interface IndexedParagraph {
  runs: IndexedRun[];
}

type QuoteResolution =
  | { kind: 'missing'; matches: 0 }
  | { kind: 'ambiguous'; matches: number }
  | { kind: 'cross-run'; matches: 1 }
  | { kind: 'unique'; matches: 1; paragraph: number; run: number; offset: number };

export type PptxTextReplacement =
  | { kind: 'replaced'; xml: string }
  | { kind: 'missing' | 'cross-run'; xml: string }
  | { kind: 'ambiguous'; xml: string; matches: number };

const TEXT_RUN_SOURCE = '<a:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/a:t>';
const TEXT_RUN_WITH_TAGS_SOURCE = '(<a:t(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/a:t>)';
const PARAGRAPH_SOURCE = '<a:p(?:\\s[^>]*)?>([\\s\\S]*?)<\\/a:p>';

function decodeXmlText(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, body: string) => {
    switch (body.toLowerCase()) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const hex = body[1]?.toLowerCase() === 'x';
        const point = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isSafeInteger(point) || point < 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return entity;
        return String.fromCodePoint(point);
      }
    }
  });
}

function encodeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function occurrences(text: string, quote: string): number[] {
  const hits: number[] = [];
  for (let from = 0; from <= text.length - quote.length;) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    hits.push(index);
    from = index + 1;
  }
  return hits;
}

function resolveQuote(paragraphs: readonly (readonly string[])[], quote: string): QuoteResolution {
  if (!quote) return { kind: 'missing', matches: 0 };
  const hits: Array<{ paragraph: number; run?: number; offset?: number }> = [];

  paragraphs.forEach((runs, paragraph) => {
    const starts: number[] = [];
    let text = '';
    for (const run of runs) {
      starts.push(text.length);
      text += run;
    }
    for (const offset of occurrences(text, quote)) {
      const end = offset + quote.length;
      const run = runs.findIndex((value, index) => offset >= starts[index]! && end <= starts[index]! + value.length);
      hits.push(run < 0
        ? { paragraph }
        : { paragraph, run, offset: offset - starts[run]! });
    }
  });

  if (!hits.length) return { kind: 'missing', matches: 0 };
  if (hits.length > 1) return { kind: 'ambiguous', matches: hits.length };
  const hit = hits[0]!;
  if (hit.run === undefined || hit.offset === undefined) return { kind: 'cross-run', matches: 1 };
  return { kind: 'unique', matches: 1, paragraph: hit.paragraph, run: hit.run, offset: hit.offset };
}

function indexedParagraphsFromXml(xml: string): IndexedParagraph[] {
  let nextRun = 0;
  const paragraphs: IndexedParagraph[] = [];
  for (const paragraph of xml.matchAll(new RegExp(PARAGRAPH_SOURCE, 'g'))) {
    const runs: IndexedRun[] = [];
    for (const run of paragraph[1]!.matchAll(new RegExp(TEXT_RUN_SOURCE, 'g'))) {
      runs.push({ index: nextRun++, text: decodeXmlText(run[1]!) });
    }
    if (runs.length) paragraphs.push({ runs });
  }
  if (paragraphs.length) return paragraphs;

  // Real PowerPoint text lives in a:p. Treat malformed/legacy orphan runs as separate
  // paragraphs so text from unrelated containers can never become a cross-run target.
  return [...xml.matchAll(new RegExp(TEXT_RUN_SOURCE, 'g'))]
    .map((run, index) => ({ runs: [{ index, text: decodeXmlText(run[1]!) }] }));
}

function plainParagraphs(paragraphs: readonly IndexedParagraph[]): string[][] {
  return paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text));
}

function replaceRun(xml: string, targetRun: number, offset: number, quote: string, replacement: string): string {
  let index = 0;
  return xml.replace(new RegExp(TEXT_RUN_WITH_TAGS_SOURCE, 'g'),
    (match, open: string, encoded: string, close: string) => {
      if (index++ !== targetRun) return match;
      const text = decodeXmlText(encoded);
      return open + encodeXmlText(text.slice(0, offset) + replacement + text.slice(offset + quote.length)) + close;
    });
}

/** Replace only when the quote has one semantic occurrence on the slide and stays in one a:t run. */
export function replaceUniquePptxText(xml: string, quote: string, replacement: string): PptxTextReplacement {
  const paragraphs = indexedParagraphsFromXml(xml);
  const resolution = resolveQuote(plainParagraphs(paragraphs), quote);
  if (resolution.kind !== 'unique') return { ...resolution, xml };
  const target = paragraphs[resolution.paragraph]!.runs[resolution.run]!;
  return {
    kind: 'replaced',
    xml: replaceRun(xml, target.index, resolution.offset, quote, replacement),
  };
}

/** Read the exact paragraph/run boundaries used by the narrow PPTX writer. */
export function pptxTextSnapshotFromBytes(bytes: Uint8Array): PptxTextSnapshot {
  const parts = readOoxmlParts(bytes);
  const slidesByIndex = new Map<number, PptxTextSlideSnapshot>();
  let maxIndex = -1;
  for (const [path, data] of Object.entries(parts)) {
    const match = /^ppt\/slides\/slide([1-9]\d*)\.xml$/.exec(path);
    if (!match) continue;
    const index = Number(match[1]) - 1;
    maxIndex = Math.max(maxIndex, index);
    const paragraphs = indexedParagraphsFromXml(new TextDecoder().decode(data))
      .map((paragraph) => ({ runs: paragraph.runs.map((run) => run.text) }));
    slidesByIndex.set(index, { paragraphs });
  }
  return {
    slides: Array.from({ length: maxIndex + 1 }, (_, index) => slidesByIndex.get(index) ?? { paragraphs: [] }),
  };
}

interface VerificationIssue {
  code: string;
  editId: string;
  message: string;
}

function verificationResult(errors: VerificationIssue[]): VerifyReport {
  if (!errors.length) {
    return {
      ok: true,
      level: 'lint',
      report: 'PPTX target check passed: every quote resolves once inside one text run.',
      details: { issues: [] },
    };
  }
  const payload = { ok: false, level: 'lint', code: errors[0]!.code, issues: errors };
  return {
    ok: false,
    level: 'lint',
    code: errors[0]!.code,
    report: JSON.stringify(payload),
    details: { issues: errors },
  };
}

function validSnapshot(snapshot: PptxTextSnapshot | undefined): snapshot is PptxTextSnapshot {
  return Boolean(snapshot
    && Array.isArray(snapshot.slides)
    && snapshot.slides.every((slide) => slide
      && Array.isArray(slide.paragraphs)
      && slide.paragraphs.every((paragraph) => paragraph
        && Array.isArray(paragraph.runs)
        && paragraph.runs.every((run) => typeof run === 'string'))));
}

/** Build the proposal-time target verifier. Missing structured snapshots fail closed. */
export function buildPptxVerifier(snapshot: PptxTextSnapshot | undefined): (cs: ChangeSet) => VerifyReport {
  return (cs: ChangeSet): VerifyReport => {
    const errors: VerificationIssue[] = [];
    const targeted = new Set<string>();
    if (!validSnapshot(snapshot)) {
      return verificationResult(cs.edits.map((edit) => ({
        code: 'PPTX_SNAPSHOT_REQUIRED',
        editId: edit.id,
        message: 'PPTX proposals require a structured slides/paragraphs/runs snapshot.',
      })));
    }

    for (const edit of cs.edits) {
      if (edit.op.kind !== 'replaceText') {
        errors.push({ code: 'PPTX_UNSUPPORTED_OPERATION', editId: edit.id, message: `PPTX preview does not support ${edit.op.kind}.` });
        continue;
      }
      const anchor = cs.anchors[edit.target];
      if (!anchor || anchor.portable.kind !== 'flow' || anchor.portable.path.length !== 1) {
        errors.push({ code: 'PPTX_INVALID_TARGET', editId: edit.id, message: 'PPTX text edits require one zero-based slide index.' });
        continue;
      }
      const slideIndex = anchor.portable.path[0]!;
      const slide = snapshot.slides[slideIndex];
      if (!slide) {
        errors.push({ code: 'PPTX_SLIDE_OUT_OF_BOUNDS', editId: edit.id, message: `Slide ${slideIndex} is outside the ${snapshot.slides.length}-slide snapshot.` });
        continue;
      }
      const quote = anchor.portable.quote.text;
      if (!quote) {
        errors.push({ code: 'PPTX_MISSING_QUOTE', editId: edit.id, message: 'PPTX text edits require a non-empty quote.' });
        continue;
      }
      const resolution = resolveQuote(slide.paragraphs.map((paragraph) => paragraph.runs), quote);
      if (resolution.kind === 'missing') {
        errors.push({ code: 'PPTX_QUOTE_NOT_FOUND', editId: edit.id, message: `Quote is not present on slide ${slideIndex}.` });
        continue;
      }
      if (resolution.kind === 'ambiguous') {
        errors.push({ code: 'PPTX_AMBIGUOUS_QUOTE', editId: edit.id, message: `Quote appears ${resolution.matches} times on slide ${slideIndex}.` });
        continue;
      }
      if (resolution.kind === 'cross-run') {
        errors.push({ code: 'PPTX_CROSS_RUN_QUOTE', editId: edit.id, message: `Quote spans multiple text runs on slide ${slideIndex}; cross-run replacement is unsupported.` });
        continue;
      }
      if (edit.op.text === quote) {
        errors.push({ code: 'PPTX_NO_OP', editId: edit.id, message: 'Replacement text is identical to the quote.' });
        continue;
      }
      const target = `${slideIndex}:${resolution.paragraph}:${resolution.run}:${resolution.offset}`;
      if (targeted.has(target)) {
        errors.push({ code: 'PPTX_DUPLICATE_TARGET', editId: edit.id, message: 'Multiple edits target the same slide text occurrence.' });
        continue;
      }
      targeted.add(target);
    }

    return verificationResult(errors);
  };
}
