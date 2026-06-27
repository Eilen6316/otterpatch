/**
 * WordRedlineWriteback —— Word 红线写回后端(外科 OOXML)。
 * ChangeSet 的 replaceText 编辑(flow 锚点的 quote.text = 原文,op.text = 改后)→ 段落级红线
 * (w:ins/w:del)→ 只重写 word/document.xml,其余部件字节级原样透传。
 * 这样 Agent 的正文改动落成 Word 原生可审阅修订,且保真(复用 writeback-surgical 的 repack)。
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
} from '@opal/core';
import { comparePartsIntegrity, readOoxmlParts, repackOoxml } from '@opal/writeback-surgical';
import { redlineDocumentXml, type ParaEdit } from './document.js';

const dec = new TextDecoder();
const enc = new TextEncoder();
const SUPPORTED: ReadonlySet<EditOpKind> = new Set<EditOpKind>(['replaceText']);
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
    if (bad) return { ok: false, reason: `word-redline supports replaceText only (got ${bad.op.kind})` };
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

    const edits: ParaEdit[] = [];
    for (const e of cs.edits) {
      if (e.op.kind !== 'replaceText') continue;
      const anchor = cs.anchors[e.target];
      const old = anchor && anchor.portable.kind === 'flow' ? anchor.portable.quote.text : '';
      if (old) edits.push({ old, new: e.op.text });
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
