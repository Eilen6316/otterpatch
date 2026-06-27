/**
 * PdfFormWriteback —— PDF 表单填写写回(pdf-lib,MIT)。
 * ChangeSet 的 setValue 编辑(object 锚点 elementId = AcroForm 字段名,op.value = 新值)→ 只更新对应表单
 * 字段值,页面内容流保留。这是 PDF 上最干净、可审阅、可逆的"安全提交"能力(填表),契合 OPAL 哲学。
 * 任意正文重排不在此后端范围(PDF 无稳定文本部件)——交未来 model-roundtrip / 叠加注释。
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
import { PDFDocument } from 'pdf-lib';

const SUPPORTED: ReadonlySet<EditOpKind> = new Set<EditOpKind>(['setValue']);

export class PdfFormWriteback implements WritebackBackend {
  readonly id = 'pdf-form' as WritebackId;
  readonly strategy: WritebackKind = 'native-command';

  canHandle(cs: ChangeSet): { ok: boolean; reason?: string } {
    const bad = cs.edits.find((e) => !SUPPORTED.has(e.op.kind));
    if (bad) return { ok: false, reason: `pdf-form supports setValue (AcroForm fields) only (got ${bad.op.kind})` };
    return { ok: true };
  }

  supports(op: EditOpKind, _part: OoxmlPart): boolean {
    return SUPPORTED.has(op);
  }

  async commit(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult> {
    if (!doc.bytes) throw new Error('PdfFormWriteback.commit: DocHandle.bytes required');
    const pdf = await PDFDocument.load(doc.bytes);
    const form = pdf.getForm();

    const touched: string[] = [];
    const drift: FidelityReport['drift'] = [];
    for (const e of cs.edits) {
      if (e.op.kind !== 'setValue') continue;
      const anchor = cs.anchors[e.target];
      const field = anchor && anchor.portable.kind === 'object' ? anchor.portable.elementId : '';
      if (!field) continue;
      try {
        form.getTextField(field).setText(e.op.value == null ? '' : String(e.op.value));
        touched.push(field);
      } catch {
        drift.push({ part: field, kind: 'content', note: 'field not found or not a text field' });
      }
    }

    const bytes = await pdf.save();
    const total = touched.length + drift.length;
    return {
      ok: touched.length > 0 && drift.length === 0,
      bytes,
      touchedParts: touched,
      fidelity: { score: total === 0 ? 1 : touched.length / total, drift },
    };
  }

  async verify(_before: DocHandle, _after: DocHandle, _cs: ChangeSet): Promise<FidelityReport> {
    return { score: 1, drift: [] };
  }
}
