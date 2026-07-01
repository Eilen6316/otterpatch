/**
 * WordRedlineWriteback —— Word 外科手术级 OOXML 写回后端。
 * flow 锚点的 quote.text 定位原文,按 op 落成 Word 原生可审阅修订,只重写 word/document.xml,其余部件字节级透传:
 *  · replaceText → run 级词级红线 <w:ins>/<w:del>(保留未触及 run);
 *  · setStyle    → 字符格式 <w:rPr>+<w:rPrChange>、段落格式 <w:pPr>+<w:pPrChange>(可逐条接受/拒绝的格式修订)。
 * 保真复用 writeback-surgical 的 repack;这就是 OtterPatch 的护城河所在。
 */
import type {
  ChangeSet,
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
import type { CharProps, ParaProps } from './style.js';

const dec = new TextDecoder();
const enc = new TextEncoder();
// replaceText → 词级红线;setStyle → 字符(rPr/rPrChange)+ 段落(pPr/pPrChange)格式修订
const SUPPORTED: ReadonlySet<EditOpKind> = new Set<EditOpKind>(['replaceText', 'setStyle']);
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
    const bad = cs.edits.find((e) => !SUPPORTED.has(e.op.kind));
    if (bad) return { ok: false, reason: `word-redline supports replaceText / setStyle (got ${bad.op.kind})` };
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
    for (const e of cs.edits) {
      const anchor = cs.anchors[e.target];
      const quote = anchor && anchor.portable.kind === 'flow' ? anchor.portable.quote.text : '';
      if (e.op.kind === 'replaceText') {
        if (quote) edits.push({ old: quote, new: e.op.text });
      } else if (e.op.kind === 'setStyle') {
        if (!quote) continue; // 全文(all=true)空锚点:外科写回暂不处理
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
        if (hasChar || hasPara) edits.push({ kind: 'fmt', quote, ...(hasChar ? { char } : {}), ...(hasPara ? { para } : {}) });
      }
    }

    const opts: ParaEditOpts = {};
    if (this.opts.author !== undefined) opts.author = this.opts.author;
    if (this.opts.date !== undefined) opts.date = this.opts.date;
    const { xml, changed } = redlineDocumentXml(dec.decode(docXml), edits, opts);
    const bytes = repackOoxml(doc.bytes, { [DOC_PART]: enc.encode(xml) });

    const integrity = comparePartsIntegrity(doc.bytes, bytes);
    return {
      ok: changed > 0,
      bytes,
      touchedParts: changed > 0 ? [DOC_PART] : [],
      fidelity: { score: integrity.total === 0 ? 1 : integrity.identical / integrity.total, drift: [] },
    };
  }

  async verify(before: DocHandle, after: DocHandle, _cs: ChangeSet): Promise<FidelityReport> {
    if (!before.bytes || !after.bytes) throw new Error('WordRedlineWriteback.verify: before/after bytes required');
    const integrity = comparePartsIntegrity(before.bytes, after.bytes);
    return { score: integrity.total === 0 ? 1 : integrity.identical / integrity.total, drift: [] };
  }
}

type ParaEditOpts = { author?: string; date?: string };
