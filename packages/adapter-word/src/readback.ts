/**
 * Word post-write-back semantic verification.
 *
 * Pipeline: re-open the written word/document.xml, accept every revision (accept.ts), and
 * compare the accepted document against a text-level simulation of the ChangeSet:
 *  1. sequential simulation — apply every edit the writer reported as applied, in order,
 *     at block-text level (the same anchor semantics the writer uses);
 *  2. accepted-document comparison — the strongest check: identical ⇒ every applied edit
 *     is verified; mismatch ⇒ per-edit attribution;
 *  3. per-edit observable checks — each edit's intended effect must be visible in the
 *     accepted output (new text present / paragraph gone / table landed / style landed /
 *     page section patched / image removed-or-resized). If every edit passes its own check
 *     yet the combined text still mismatches, that is an interaction failure and ALL edits
 *     are reported failed — no silent success.
 */
import type { ChangeSet, EditId } from '@otterpatch/core';
import type { OoxmlSemanticOutcome } from '@otterpatch/writeback-surgical';
import { acceptRevisions, extractTextBlocks, splitTopLevelBlocks, type TextBlock } from './accept.js';
import type { DelParaEdit, DocEdit, FmtEdit, ImgEdit, InsertTableEdit, ParaEdit } from './document.js';
import { charElems, paraElems } from './style.js';
import { marginPreset } from './sect.js';

const isTextEdit = (edit: DocEdit): edit is ParaEdit => 'old' in edit;

/** Text shape of an inserted native table (must match accept.ts table extraction). */
const tableText = (rows: readonly string[][]): string => rows.map((row) => row.join('\t')).join('\n');

interface DocBlocks {
  xml: string[];
  text: TextBlock[];
}

const parseDoc = (documentXml: string): DocBlocks => ({
  xml: splitTopLevelBlocks(documentXml),
  text: extractTextBlocks(documentXml),
});

/** Block index the writer would target: paraIdx is a hard constraint (empty/duplicate paragraphs), else quote search. */
function locateParagraph(blocks: readonly TextBlock[], quote: string, paraIdx: number | undefined): number {
  if (paraIdx != null) return paraIdx;
  if (!quote) return -1;
  return blocks.findIndex((block) => block.kind === 'paragraph' && block.text.includes(quote));
}

/**
 * Apply one edit at block-text level. Returns null when the edit's anchor cannot be resolved
 * in the current simulated blocks — the writer drops such edits, so simulation and writer stay aligned.
 */
function simulateEdit(blocks: TextBlock[], edit: DocEdit): TextBlock[] | null {
  if (isTextEdit(edit)) {
    const index = locateParagraph(blocks, edit.old, edit.paraIdx);
    if (index < 0 || index >= blocks.length || blocks[index]!.kind !== 'paragraph') return null;
    const target = blocks[index]!.text;
    if (!target.includes(edit.old)) return null;
    const next = [...blocks];
    next[index] = { kind: 'paragraph', text: target.replace(edit.old, () => edit.new) };
    return next;
  }

  if (edit.kind === 'insertTable') {
    if (edit.at === 'end') return [...blocks, { kind: 'table', text: tableText(edit.rows) }];
    const index = locateParagraph(blocks, edit.quote ?? '', edit.paraIdx);
    if (index < 0 || index >= blocks.length) return null;
    const next = [...blocks];
    next.splice(edit.at === 'before' ? index : index + 1, 0, { kind: 'table', text: tableText(edit.rows) });
    return next;
  }

  if (edit.kind === 'delPara') {
    const index = locateParagraph(blocks, edit.quote ?? '', edit.paraIdx);
    if (index < 0 || index >= blocks.length || blocks[index]!.kind !== 'paragraph') return null;
    return blocks.filter((_, i) => i !== index);
  }

  // fmt / img edits: locate the paragraph; text stays unchanged.
  const index = locateParagraph(blocks, edit.quote ?? '', edit.paraIdx);
  if (index < 0 || index >= blocks.length || blocks[index]!.kind !== 'paragraph') return null;
  return blocks;
}

function sameBlocks(a: readonly TextBlock[], b: readonly TextBlock[]): boolean {
  return a.length === b.length && a.every((block, i) => block.kind === b[i]!.kind && block.text === b[i]!.text);
}

/** Locate the accepted paragraph XML carrying the given (pre-edit) text. */
function locateParagraphXml(accepted: DocBlocks, text: string): string | undefined {
  const index = accepted.text.findIndex((block) => block.kind === 'paragraph' && block.text === text);
  return index >= 0 ? accepted.xml[index] : undefined;
}

interface EditEffectCheck {
  ok: boolean;
  reason?: string;
}

const ok: EditEffectCheck = { ok: true };
const fail = (reason: string): EditEffectCheck => ({ ok: false, reason });

/** Per-edit observable checks against the accepted document (used for attribution on mismatch). */
function checkEffect(edit: DocEdit, snapshot: readonly TextBlock[], accepted: DocBlocks): EditEffectCheck {
  const acceptedText = accepted.text.map((block) => block.text).join('\n');

  if (isTextEdit(edit)) {
    if (!acceptedText.includes(edit.new)) return fail('accepted document does not contain the replacement text');
    if (edit.new !== edit.old && acceptedText.includes(edit.old)) return fail('original quote text still present after accepting revisions');
    return ok;
  }

  if (edit.kind === 'delPara') {
    const targetText = (edit.paraIdx != null ? snapshot[edit.paraIdx]?.text : undefined) ?? edit.quote ?? '';
    if (targetText && acceptedText.includes(targetText)) return fail('deleted paragraph text still present after accepting revisions');
    return ok;
  }

  if (edit.kind === 'insertTable') {
    if (!acceptedText.includes(tableText(edit.rows.slice(0, 1)))) return fail('inserted table text is not present after accepting revisions');
    return ok;
  }

  if (edit.kind === 'img') {
    const anchorText = edit.quote || (edit.paraIdx != null ? snapshot[edit.paraIdx]?.text : undefined);
    const paragraphXml = (anchorText ? locateParagraphXml(accepted, anchorText) : undefined)
      ?? accepted.xml.find((block) => /<w:drawing\b|<w:pict\b/.test(block));
    if (!paragraphXml) return fail('image paragraph not found in the accepted document');
    if (edit.action === 'remove') {
      return /<w:drawing\b|<w:pict\b/.test(paragraphXml)
        ? fail('drawing still present after accepting the deletion revision')
        : ok;
    }
    const width = Math.round((edit.width ?? 0) * 9525);
    return paragraphXml.includes(`cx="${width}"`)
      ? ok
      : fail(`resized drawing extent does not show cx="${width}"`);
  }

  // fmt: formatting lands directly in the paragraph's rPr/pPr; the original snapshot sits in rPrChange/pPrChange.
  const anchorText = edit.quote || (edit.paraIdx != null ? snapshot[edit.paraIdx]?.text : undefined);
  let paragraphXml = anchorText ? locateParagraphXml(accepted, anchorText) : undefined;
  if (!paragraphXml) {
    paragraphXml = accepted.xml.find((block) => {
      if (edit.char && /<w:rPrChange\b/.test(block)) return true;
      if (edit.para && /<w:pPrChange\b/.test(block)) return true;
      return false;
    });
  }
  if (!paragraphXml) return fail('formatted paragraph not found in the accepted document');
  if (edit.char) {
    for (const element of charElems(edit.char).xml.match(/<w:[a-zA-Z]+\b[^>]*\/?>/g) ?? []) {
      if (!paragraphXml.includes(element)) return fail(`expected character property ${element} is missing from the paragraph runs`);
    }
    if (!/<w:rPrChange\b/.test(paragraphXml)) return fail('character format revision (rPrChange) is missing');
  }
  if (edit.para) {
    const expected = [paraElems(edit.para).pStyle, paraElems(edit.para).xml].filter(Boolean).join('');
    for (const element of expected.match(/<w:[a-zA-Z]+\b[^>]*\/?>/g) ?? []) {
      if (!paragraphXml.includes(element)) return fail(`expected paragraph property ${element} is missing`);
    }
    if (!/<w:pPrChange\b/.test(paragraphXml)) return fail('paragraph format revision (pPrChange) is missing');
  }
  if (!edit.char && !edit.para) return fail('format edit carries no properties');
  return ok;
}

/** Page-level (sectPr) observable check for document-scope setStyle edits (columns / margins / orientation). */
export function checkPagePatchEffect(
  patch: { columns?: number; margin?: 'narrow' | 'normal' | 'moderate' | 'wide'; orient?: 'portrait' | 'landscape' },
  afterXml: string,
): EditEffectCheck {
  const bodyEnd = afterXml.lastIndexOf('</w:body>');
  if (bodyEnd < 0) return fail('document body not found');
  const sectRe = /<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g;
  let last = '';
  let match: RegExpExecArray | null;
  while ((match = sectRe.exec(afterXml))) {
    if (match.index < bodyEnd) last = match[0];
  }
  if (!last) return fail('no body-level sectPr found in the written document');

  if (patch.columns != null) {
    const n = Math.max(1, Math.min(3, Math.floor(patch.columns)));
    const colsTag = /<w:cols\b[^>]*\/?>/.exec(last)?.[0] ?? '';
    const num = /\bw:num="(\d+)"/.exec(colsTag)?.[1];
    if (n > 1 ? num !== String(n) : num !== undefined) return fail(`expected ${n} columns, sectPr shows ${colsTag || '(none)'}`);
  }
  if (patch.margin) {
    const preset = marginPreset(patch.margin);
    const pgMar = /<w:pgMar\b[^>]*\/?>/.exec(last)?.[0] ?? '';
    for (const [name, expected] of Object.entries(preset)) {
      const actual = new RegExp(`\\bw:${name}="(\\d+)"`).exec(pgMar)?.[1];
      if (actual !== String(expected)) return fail(`expected ${name} margin ${expected}, sectPr shows ${actual ?? '(none)'}`);
    }
  }
  if (patch.orient) {
    const pgSz = /<w:pgSz\b[^>]*\/?>/.exec(last)?.[0] ?? '';
    const orient = /\bw:orient="([^"]*)"/.exec(pgSz)?.[1];
    const w = Number(/\bw:w="(\d+)"/.exec(pgSz)?.[1] ?? 0);
    const h = Number(/\bw:h="(\d+)"/.exec(pgSz)?.[1] ?? 0);
    if (patch.orient === 'landscape') {
      if (orient !== 'landscape') return fail('expected landscape orientation, pgSz has no w:orient="landscape"');
      if (w <= h) return fail('landscape pgSz must have width greater than height');
    } else if (orient === 'landscape' || (w > h && w > 0 && h > 0)) {
      return fail('expected portrait orientation, pgSz still shows landscape dimensions');
    }
  }
  return ok;
}

export interface WordReadbackInput {
  beforeXml: string;
  afterXml: string;
  /** Edits the writer reported as applied (paragraph-level DocEdits, in writer order). */
  appliedEdits: DocEdit[];
  /** Page-level setStyle edits and their accumulated sectPr patch. */
  pageEdits: Array<{ editId: EditId; patch: { columns?: number; margin?: 'narrow' | 'normal' | 'moderate' | 'wide'; orient?: 'portrait' | 'landscape' } }>;
  /** Edits the writer dropped (with reasons) — kept as failed regardless of read-back. */
  droppedEdits: Array<{ editId: EditId; reason: string }>;
}

/**
 * Verify the written document semantically. Every accepted edit ends up in exactly one of
 * verified / unverifiable / failed. unverifiable is reserved for op kinds this reader cannot
 * observe (none today — every supported Word op has a deterministic observable).
 */
export function verifyWordReadback(input: WordReadbackInput): OoxmlSemanticOutcome {
  const { beforeXml, afterXml, appliedEdits, pageEdits, droppedEdits } = input;
  const before = parseDoc(beforeXml);
  const accepted = parseDoc(acceptRevisions(afterXml));

  const failedEdits: Array<{ editId: EditId; reason: string }> = [...droppedEdits];
  const alreadyFailed = new Set(failedEdits.map((failure) => failure.editId));
  const verified: EditId[] = [];
  const unverifiable: EditId[] = [];

  // Sequential simulation mirrors the writer's edit order.
  let simulated = before.text;
  const snapshots: TextBlock[][] = [before.text];
  for (const edit of appliedEdits) {
    const next = simulateEdit(simulated, edit);
    if (next === null) {
      if (edit.id && !alreadyFailed.has(edit.id)) {
        failedEdits.push({ editId: edit.id, reason: 'anchor could not be resolved during semantic simulation' });
        alreadyFailed.add(edit.id);
      }
      snapshots.push(simulated);
      continue;
    }
    simulated = next;
    snapshots.push(simulated);
  }

  if (sameBlocks(simulated, accepted.text)) {
    // Strongest check passed: every surviving edit landed exactly as intended.
    for (const edit of appliedEdits) {
      if (edit.id && !alreadyFailed.has(edit.id)) verified.push(edit.id);
    }
    for (const pageEdit of pageEdits) {
      const check = checkPagePatchEffect(pageEdit.patch, afterXml);
      if (check.ok) verified.push(pageEdit.editId);
      else failedEdits.push({ editId: pageEdit.editId, reason: check.reason ?? 'page patch effect is not observable' });
    }
    return { verifiedEdits: verified, unverifiableEdits: unverifiable, failedEdits };
  }

  // Combined mismatch: attribute per edit via observable checks.
  let checksAllPassed = true;
  for (let i = 0; i < appliedEdits.length; i++) {
    const edit = appliedEdits[i]!;
    if (!edit.id || alreadyFailed.has(edit.id)) continue;
    const check = checkEffect(edit, snapshots[i] ?? before.text, accepted);
    if (check.ok) verified.push(edit.id);
    else {
      checksAllPassed = false;
      failedEdits.push({ editId: edit.id, reason: check.reason ?? 'intended effect is not observable in the accepted document' });
      alreadyFailed.add(edit.id);
    }
  }
  for (const pageEdit of pageEdits) {
    const check = checkPagePatchEffect(pageEdit.patch, afterXml);
    if (check.ok) verified.push(pageEdit.editId);
    else {
      checksAllPassed = false;
      failedEdits.push({ editId: pageEdit.editId, reason: check.reason ?? 'page patch effect is not observable' });
      alreadyFailed.add(pageEdit.editId);
    }
  }

  if (checksAllPassed) {
    // Every edit individually visible, yet the composed document still differs: an
    // interaction failure. Retract the per-edit passes and fail the whole accepted subset.
    verified.length = 0;
    for (const edit of appliedEdits) {
      if (edit.id && !alreadyFailed.has(edit.id)) {
        failedEdits.push({ editId: edit.id, reason: 'combined document text does not match the simulated intent (edit interaction failure)' });
        alreadyFailed.add(edit.id);
      }
    }
    for (const pageEdit of pageEdits) {
      if (!alreadyFailed.has(pageEdit.editId)) {
        failedEdits.push({ editId: pageEdit.editId, reason: 'combined document text does not match the simulated intent (edit interaction failure)' });
        alreadyFailed.add(pageEdit.editId);
      }
    }
  }

  return { verifiedEdits: verified, unverifiableEdits: unverifiable, failedEdits };
}

/**
 * Whole-set read-back for outputs this instance did not produce: simulate every text-observable
 * edit and compare against the accepted document. All-or-nothing — the applied/dropped split is
 * unknown, so a mismatch fails the subset rather than guessing per edit. Page-level edits leave
 * no text trace and are reported unverifiable here.
 */
export function verifyWholeSetReadback(beforeXml: string, afterXml: string, cs: ChangeSet): OoxmlSemanticOutcome {
  const before = parseDoc(beforeXml);
  const accepted = parseDoc(acceptRevisions(afterXml));
  const allIds = cs.edits.map((edit) => edit.id);

  let blocks = before.text;
  let pageEditIds: EditId[] = [];
  let resolvable = true;
  for (const edit of cs.edits) {
    const anchor = cs.anchors[edit.target];
    const portable = anchor?.portable.kind === 'flow' ? anchor.portable : undefined;
    const quote = portable?.quote.text ?? '';
    const paraIdx = portable?.path[0];
    if (edit.op.kind === 'setStyle' && (edit.op.scope === 'document' || edit.op.scope === 'section')) {
      pageEditIds.push(edit.id);
      continue;
    }
    const docEdit = docEditFromChangeSetEdit(edit, quote, paraIdx);
    const next = docEdit ? simulateEdit(blocks, docEdit) : null;
    if (next === null) {
      resolvable = false;
      break;
    }
    blocks = next;
  }

  if (resolvable && sameBlocks(blocks, accepted.text)) {
    return {
      verifiedEdits: allIds.filter((id) => !pageEditIds.includes(id)),
      unverifiableEdits: pageEditIds,
      failedEdits: [],
    };
  }
  const reason = resolvable
    ? 'accepted document text does not match the simulated intent (whole-set read-back)'
    : 'a ChangeSet anchor could not be resolved during whole-set semantic simulation';
  return { verifiedEdits: [], unverifiableEdits: [], failedEdits: allIds.map((editId) => ({ editId, reason })) };
}

function docEditFromChangeSetEdit(edit: ChangeSet['edits'][number], quote: string, paraIdx: number | undefined): DocEdit | null {
  const located = { quote, ...(paraIdx != null ? { paraIdx } : {}) };
  switch (edit.op.kind) {
    case 'replaceText':
      return { id: edit.id, old: quote, new: edit.op.text, ...(paraIdx != null ? { paraIdx } : {}) };
    case 'deleteRange':
      return { id: edit.id, kind: 'delPara', ...located };
    case 'insertTable':
      return { id: edit.id, kind: 'insertTable', rows: edit.op.rows, headerRows: edit.op.headerRows, at: edit.op.at, ...located };
    case 'setObjectProps': {
      const props = edit.op.props as { imgAction?: 'remove' | 'resize'; width?: unknown };
      if (props.imgAction !== 'remove' && props.imgAction !== 'resize') return null;
      return {
        id: edit.id,
        kind: 'img',
        action: props.imgAction,
        ...(typeof props.width === 'number' ? { width: props.width } : {}),
        ...located,
      };
    }
    case 'setStyle':
      return { id: edit.id, kind: 'fmt', ...located };
    default:
      return null;
  }
}

export type { DelParaEdit, DocEdit, FmtEdit, ImgEdit, InsertTableEdit, ParaEdit };
