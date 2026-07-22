/**
 * WordRedlineWriteback — surgical OOXML writeback backend for Word.
 * Locates source text via the flow anchor's quote.text, then lands each op as a native Word reviewable revision, rewriting only word/document.xml and passing all other parts through byte-for-byte:
 *  · replaceText → run-level, word-level redlines <w:ins>/<w:del> (untouched runs preserved);
 *  · setStyle    → character formatting <w:rPr>+<w:rPrChange> and paragraph formatting <w:pPr>+<w:pPrChange> (format revisions that can be accepted/rejected individually).
 * Fidelity comes from reusing writeback-surgical's repack; this is OtterPatch's moat.
 */
import { assertFormatCapabilities, writebackOperationKindsFor } from '@otterpatch/core';
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
import { comparePartsIntegrity, readOoxmlParts, repackOoxml } from '@otterpatch/writeback-surgical';
import { redlineDocumentXml, type DocEdit } from './document.js';
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

export class WordRedlineWriteback implements WritebackBackend {
  readonly id = 'word-redline' as WritebackId;
  readonly strategy: WritebackKind = 'surgical-ooxml';

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
    const parts = readOoxmlParts(doc.bytes);
    const docXml = parts[DOC_PART];
    if (!docXml) throw new Error(`WordRedlineWriteback: ${DOC_PART} not found`);

    const edits: DocEdit[] = [];
    const page: PagePatch = {};
    const dropped: Array<{ editId: EditId; reason: string }> = [];
    const pageApplied: EditId[] = [];
    for (const e of cs.edits) {
      const anchor = cs.anchors[e.target];
      const quote = anchor && anchor.portable.kind === 'flow' ? anchor.portable.quote.text : '';
      const paraIdx = anchor && anchor.portable.kind === 'flow' ? anchor.portable.path[0] : undefined; // 段号锚(0-based):空段/重复文本的定位通道
      if (e.op.kind === 'replaceText') {
        if (quote) { edits.push({ id: e.id, old: quote, new: e.op.text, ...(paraIdx != null ? { paraIdx } : {}) }); }
        else dropped.push({ editId: e.id, reason: '文本改写缺少 quote 锚点,无法定位' });
      } else if (e.op.kind === 'deleteRange') {
        if (quote || paraIdx != null) { edits.push({ id: e.id, kind: 'delPara', ...(quote ? { quote } : {}), ...(paraIdx != null ? { paraIdx } : {}) }); }
        else dropped.push({ editId: e.id, reason: '删段缺少 quote/para 锚点,无法定位' });
      } else if (e.op.kind === 'setObjectProps') {
        const p = e.op.props as { imgAction?: 'remove' | 'resize'; width?: number };
        if (p.imgAction !== 'remove' && p.imgAction !== 'resize') { dropped.push({ editId: e.id, reason: `setObjectProps 仅支持图片操作(imgAction),得到 ${JSON.stringify(e.op.props).slice(0, 60)}` }); continue; }
        if (!quote && paraIdx == null) { dropped.push({ editId: e.id, reason: '图片操作缺少 quote/para 锚点,无法定位' }); continue; }
        edits.push({ id: e.id, kind: 'img', action: p.imgAction, ...(p.width != null ? { width: p.width } : {}), ...(quote ? { quote } : {}), ...(paraIdx != null ? { paraIdx } : {}) });
      } else if (e.op.kind === 'insertTable') {
        if (e.op.at !== 'end' && !quote && paraIdx == null) {
          dropped.push({ editId: e.id, reason: '表格段前/段后插入缺少 quote/para 锚点,无法定位' });
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
        // Page-level (columns/margins/orientation): inherently document-wide, handled via surgical sectPr patch
        if (st0.columns != null || st0.margin != null || st0.orient != null) {
          if (st0.columns != null) page.columns = st0.columns;
          if (st0.margin != null) page.margin = st0.margin;
          if (st0.orient != null) page.orient = st0.orient;
          pageApplied.push(e.id);
          // If the same edit also carries character/paragraph fields and has a quote, fall through to the format-revision path below; purely page-level edits stop here
          if (!quote && st0.font == null && st0.size == null && st0.bold == null && st0.align == null && st0.lineSpacing == null) continue;
        }
        if (!quote && paraIdx == null) {
          // Document-wide character/paragraph formatting (all=true): v1 surgical writeback does not support per-run rewriting — report explicitly, never fail silently (workspace preview already applied)
          dropped.push({ editId: e.id, reason: '全文字符/段落格式(all=true)暂不支持外科写回,仅工作区预览生效;可改为对具体段落逐条下发' });
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

    const opts: ParaEditOpts = {};
    if (this.opts.author !== undefined) opts.author = this.opts.author;
    if (this.opts.date !== undefined) opts.date = this.opts.date;
    const redline = redlineDocumentXml(dec.decode(docXml), edits, opts);
    const sect = patchSectPr(redline.xml, page); // Page-level sectPr patch (columns/margins/orientation)
    const applied = [...redline.appliedEditIds, ...(sect.changed ? pageApplied : [])];
    const pageDropped = sect.changed ? [] : pageApplied.map((editId) => ({ editId, reason: 'section properties were unchanged' }));
    dropped.push(...redline.droppedEdits, ...pageDropped);
    const totalChanged = redline.changed + (sect.changed ? 1 : 0);
    const bytes = repackOoxml(doc.bytes, { [DOC_PART]: enc.encode(sect.xml) });

    const integrity = comparePartsIntegrity(doc.bytes, bytes);
    return {
      ok: totalChanged > 0 && dropped.length === 0,
      bytes,
      touchedParts: totalChanged > 0 ? [DOC_PART] : [],
      fidelity: { score: integrity.total === 0 ? 1 : integrity.identical / integrity.total, drift: [] },
      appliedEditIds: applied,
      ...(dropped.length ? { droppedEdits: dropped } : {}),
    };
  }

  async verify(before: DocHandle, after: DocHandle, _cs: ChangeSet): Promise<FidelityReport> {
    if (!before.bytes || !after.bytes) throw new Error('WordRedlineWriteback.verify: before/after bytes required');
    const integrity = comparePartsIntegrity(before.bytes, after.bytes);
    const drift = integrity.changed
      .filter((change) => change.slice(1) !== 'word/document.xml')
      .map((change) => ({ part: change.slice(1), kind: 'content' as const, note: `unexpected: ${change}` }));
    return { score: integrity.total === 0 ? 1 : integrity.identical / integrity.total, drift };
  }
}

type ParaEditOpts = { author?: string; date?: string };
