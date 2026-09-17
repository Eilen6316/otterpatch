/**
 * WordRedlineWriteback — surgical OOXML writeback backend for Word.
 * Locates source text via the flow anchor's quote.text, then lands each op as a native Word reviewable revision, rewriting only word/document.xml and passing all other parts through byte-for-byte:
 *  · replaceText → run-level, word-level redlines <w:ins>/<w:del> (untouched runs preserved);
 *  · setStyle    → character formatting <w:rPr>+<w:rPrChange> and paragraph formatting <w:pPr>+<w:pPrChange> (format revisions that can be accepted/rejected individually).
 * Fidelity comes from reusing writeback-surgical's repack; this is OtterPatch's moat.
 */
import { assertChangeSet, assertFormatCapabilities, writebackOperationKindsFor } from '@otterpatch/core';
import type {
  ChangeSet,
  EditId,
  DocHandle,
  EditOpKind,
  FidelityReport,
  OoxmlPart,
  WritebackBackend,
  WritebackId,
  WritebackKind,
  WritebackResult,
} from '@otterpatch/core';
import { ooxmlFidelityReport, readOoxmlParts, repackOoxml, type OoxmlSemanticOutcome } from '@otterpatch/writeback-surgical';
import { redlineDocumentXml, type DocEdit } from './document.js';
import { verifyWholeSetReadback, verifyWordReadback, type WordReadbackInput } from './readback.js';
import { patchSectPr, type PagePatch } from './sect.js';
import type { CharProps, ParaProps } from './style.js';

const dec = new TextDecoder();
const enc = new TextEncoder();
// replaceText → word-level redlines; setStyle → character (rPr/rPrChange) + paragraph (pPr/pPrChange) format revisions;
// deleteRange → whole-paragraph deletion revision (runs in <w:del> + paragraph-mark <w:del/>);
// setObjectProps(imgAction) → image remove (drawing run in <w:del>) / resize (wp:extent in EMU)
const SUPPORTED: ReadonlySet<EditOpKind> = new Set(writebackOperationKindsFor('word'));
const DOC_PART = 'word/document.xml';

export interface WordRedlineOptions {
  author?: string;
  date?: string;
}

interface WordOutputExpectation {
  intendedParts: string[];
  semantic: OoxmlSemanticOutcome;
  warnings: string[];
  /** Inputs for the deterministic post-commit semantic read-back (absent for foreign outputs). */
  readback?: Omit<WordReadbackInput, 'beforeXml' | 'afterXml'> & { beforeXml: string; afterXml: string };
}

export class WordRedlineWriteback implements WritebackBackend {
  readonly id = 'word-redline' as WritebackId;
  readonly strategy: WritebackKind = 'surgical-ooxml';
  private readonly verificationByOutput = new WeakMap<Uint8Array, WordOutputExpectation>();

  constructor(private readonly opts: WordRedlineOptions = {}) {}

  canHandle(cs: ChangeSet): { ok: boolean; reason?: string } {
    try {
      assertFormatCapabilities('word', cs, 'writeback');
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const bad = cs.edits.find((e) => !SUPPORTED.has(e.op.kind));
    if (bad) return { ok: false, reason: `word-redline supports replaceText / setStyle / deleteRange / setObjectProps / insertTable (got ${bad.op.kind})` };
    return { ok: true };
  }

  supports(op: EditOpKind, _part: OoxmlPart): boolean {
    return SUPPORTED.has(op);
  }

  async commit(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult> {
    if (!doc.bytes) throw new Error('WordRedlineWriteback.commit: DocHandle.bytes required');
    assertChangeSet(cs);
    const support = this.canHandle(cs);
    if (!support.ok) throw new Error(`WordRedlineWriteback cannot handle ChangeSet: ${support.reason ?? 'unsupported'}`);
    const parts = readOoxmlParts(doc.bytes);
    const docXml = parts[DOC_PART];
    if (!docXml) throw new Error(`WordRedlineWriteback: ${DOC_PART} not found`);

    const edits: DocEdit[] = [];
    const page: PagePatch = {};
    const preDropped: Array<{ editId: EditId; reason: string }> = [];
    const pageAppliedIds: EditId[] = [];
    for (const e of cs.edits) {
      const anchor = cs.anchors[e.target];
      const quote = anchor && anchor.portable.kind === 'flow' ? anchor.portable.quote.text : '';
      const paraIdx = anchor && anchor.portable.kind === 'flow' ? anchor.portable.path[0] : undefined; // 段号锚(0-based):空段/重复文本的定位通道
      if (e.op.kind === 'replaceText') {
        if (quote) { edits.push({ id: e.id, old: quote, new: e.op.text, ...(paraIdx != null ? { paraIdx } : {}) }); }
        else preDropped.push({ editId: e.id, reason: '文本改写缺少 quote 锚点,无法定位' });
      } else if (e.op.kind === 'deleteRange') {
        if (quote || paraIdx != null) { edits.push({ id: e.id, kind: 'delPara', ...(quote ? { quote } : {}), ...(paraIdx != null ? { paraIdx } : {}) }); }
        else preDropped.push({ editId: e.id, reason: '删段缺少 quote/para 锚点,无法定位' });
      } else if (e.op.kind === 'setObjectProps') {
        const p = e.op.props as { imgAction?: 'remove' | 'resize'; width?: number };
        if (p.imgAction !== 'remove' && p.imgAction !== 'resize') { preDropped.push({ editId: e.id, reason: `setObjectProps 仅支持图片操作(imgAction),得到 ${JSON.stringify(e.op.props).slice(0, 60)}` }); continue; }
        if (!quote && paraIdx == null) { preDropped.push({ editId: e.id, reason: '图片操作缺少 quote/para 锚点,无法定位' }); continue; }
        edits.push({ id: e.id, kind: 'img', action: p.imgAction, ...(p.width != null ? { width: p.width } : {}), ...(quote ? { quote } : {}), ...(paraIdx != null ? { paraIdx } : {}) });
      } else if (e.op.kind === 'insertTable') {
        if (e.op.at !== 'end' && !quote && paraIdx == null) {
          preDropped.push({ editId: e.id, reason: '表格段前/段后插入缺少 quote/para 锚点,无法定位' });
          continue;
        }
        edits.push({
          id: e.id,
          kind: 'insertTable',
          rows: e.op.rows,
          headerRows: e.op.headerRows,
          at: e.op.at,
          ...(quote ? { quote } : {}),
          ...(paraIdx != null ? { paraIdx } : {}),
        });
      } else if (e.op.kind === 'setStyle') {
        const st0 = e.op.style;
        // Page-level changes are allowed only with an explicit document scope.
        if (st0.columns != null || st0.margin != null || st0.orient != null) {
          if (e.op.scope !== 'document') {
            preDropped.push({ editId: e.id, reason: `页面格式要求 document scope,得到 ${e.op.scope}` });
            continue;
          }
          if (st0.columns != null) page.columns = st0.columns;
          if (st0.margin != null) page.margin = st0.margin;
          if (st0.orient != null) page.orient = st0.orient;
          pageAppliedIds.push(e.id);
          continue;
        }
        if (!quote && paraIdx == null) {
          preDropped.push({ editId: e.id, reason: '全文字符/段落格式暂不支持外科写回;可改为对具体段落逐条下发' });
          continue;
        }
        const st = e.op.style;
        const char: CharProps = {};
        if (st.bold != null) char.bold = st.bold;
        if (st.italic != null) char.italic = st.italic;
        if (st.underline != null) char.underline = st.underline;
        if (st.font != null) char.font = st.font;
        if (st.size != null) char.size = st.size;
        if (st.color != null) char.color = st.color;
        const para: ParaProps = {};
        if (st.align != null) para.align = st.align;
        if (st.lineSpacing != null) para.lineSpacing = st.lineSpacing;
        if (st.block != null) para.block = st.block;
        if (st.bgColor != null) para.bgColor = st.bgColor;
        const hasChar = Object.keys(char).length > 0;
        const hasPara = Object.keys(para).length > 0;
        if (hasChar || hasPara) { edits.push({ id: e.id, kind: 'fmt', quote, ...(paraIdx != null ? { paraIdx } : {}), ...(hasChar ? { char } : {}), ...(hasPara ? { para } : {}) }); }
      }
    }

    const opts: ParaEditOpts = { date: this.opts.date ?? new Date().toISOString() };
    if (this.opts.author !== undefined) opts.author = this.opts.author;
    const redline = redlineDocumentXml(dec.decode(docXml), edits, opts);
    const sect = patchSectPr(redline.xml, page); // Page-level sectPr patch (columns/margins/orientation)
    const docApplied = redline.appliedEditIds;
    const pageApplied = sect.changed ? pageAppliedIds : [];
    const applied = [...docApplied, ...pageApplied];
    const dropped = [
      ...preDropped,
      ...redline.droppedEdits,
      ...(sect.changed ? [] : pageAppliedIds.map((editId) => ({ editId, reason: 'section properties were unchanged' }))),
    ];
    const totalChanged = redline.changed + (sect.changed ? 1 : 0);
    const bytes = repackOoxml(doc.bytes, { [DOC_PART]: enc.encode(sect.xml) });

    const intendedParts = totalChanged > 0 ? [DOC_PART] : [];
    const semantic: OoxmlSemanticOutcome = { verifiedEdits: [], unverifiableEdits: applied, failedEdits: dropped };
    this.verificationByOutput.set(bytes, {
      intendedParts,
      semantic,
      warnings: [],
      readback: {
        beforeXml: dec.decode(docXml),
        afterXml: sect.xml,
        appliedEdits: edits.filter((edit) => edit.id !== undefined && docApplied.includes(edit.id)),
        pageEdits: pageApplied.map((editId) => ({ editId, patch: { ...page } })),
        droppedEdits: dropped,
      },
    });
    const fidelity = ooxmlFidelityReport(doc.bytes, bytes, intendedParts, semantic);
    return {
      ok: fidelity.verification.packageValid && fidelity.drift.length === 0 && totalChanged > 0 && dropped.length === 0,
      bytes,
      touchedParts: totalChanged > 0 ? [DOC_PART] : [],
      fidelity,
      appliedEditIds: applied,
      ...(dropped.length ? { droppedEdits: dropped } : {}),
    };
  }

  async verify(before: DocHandle, after: DocHandle, cs: ChangeSet): Promise<FidelityReport> {
    if (!before.bytes || !after.bytes) throw new Error('WordRedlineWriteback.verify: before/after bytes required');
    const expected = this.verificationByOutput.get(after.bytes);
    if (expected?.readback) {
      // Deterministic semantic read-back: accept every revision in the written document.xml
      // and verify each applied edit's observable effect (see readback.ts).
      const semantic = verifyWordReadback(expected.readback);
      const completed = completeSemanticPartition(semantic, cs);
      return ooxmlFidelityReport(before.bytes, after.bytes, expected.intendedParts, completed, expected.warnings);
    }
    // Foreign output bytes (not produced by this instance): still run the strongest check we
    // can — simulate the whole ChangeSet against the accepted document. All-or-nothing: the
    // applied/dropped split is unknown, so a mismatch fails the subset rather than guessing.
    const foreign = readbackFromBytes(before.bytes, after.bytes, cs);
    if (foreign) {
      const completed = completeSemanticPartition(foreign.semantic, cs);
      return ooxmlFidelityReport(before.bytes, after.bytes, foreign.intendedParts, completed, foreign.warnings);
    }
    const fallback = expected ?? {
      intendedParts: [DOC_PART],
      semantic: { verifiedEdits: [], unverifiableEdits: cs.edits.map((edit) => edit.id), failedEdits: [] },
      warnings: ['Word redline output was not produced by this backend instance; semantic read-back unavailable'],
    };
    return ooxmlFidelityReport(before.bytes, after.bytes, fallback.intendedParts, fallback.semantic, fallback.warnings);
  }
}

/** Whole-set read-back for outputs this instance did not produce; null when either side is not parseable OOXML. */
function readbackFromBytes(before: Uint8Array, after: Uint8Array, cs: ChangeSet): { intendedParts: string[]; semantic: OoxmlSemanticOutcome; warnings: string[] } | null {
  let beforeXml: string;
  let afterXml: string;
  try {
    beforeXml = dec.decode(readOoxmlParts(before)[DOC_PART]!);
    afterXml = dec.decode(readOoxmlParts(after)[DOC_PART]!);
  } catch {
    return null;
  }
  if (!beforeXml || !afterXml) return null;
  const semantic = verifyWholeSetReadback(beforeXml, afterXml, cs);
  return {
    intendedParts: [DOC_PART],
    semantic,
    warnings: ['output bytes were not produced by this backend instance; read-back is whole-set only'],
  };
}

/** The runtime requires every accepted edit in exactly one bucket; anything the reader missed stays unverifiable. */
function completeSemanticPartition(semantic: OoxmlSemanticOutcome, cs: ChangeSet): OoxmlSemanticOutcome {
  const covered = new Set([
    ...semantic.verifiedEdits,
    ...semantic.unverifiableEdits,
    ...semantic.failedEdits.map((failure) => failure.editId),
  ]);
  const missing = cs.edits.map((edit) => edit.id).filter((editId) => !covered.has(editId));
  return missing.length
    ? { ...semantic, unverifiableEdits: [...semantic.unverifiableEdits, ...missing] }
    : semantic;
}

type ParaEditOpts = { author?: string; date?: string };
