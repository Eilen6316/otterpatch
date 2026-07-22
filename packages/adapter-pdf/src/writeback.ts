/**
 * PdfFormWriteback — PDF form-fill writeback (pdf-lib, MIT).
 * setValue edits in a ChangeSet (object anchor elementId = AcroForm field name, op.value = new value)
 * update only the matching form field values; page content streams are preserved. This is the cleanest,
 * reviewable, reversible "safe commit" capability on PDF (form filling), in line with the OtterPatch philosophy.
 * Arbitrary body-text reflow is out of scope for this backend (PDF has no stable text parts) —
 * deferred to a future model-roundtrip / overlay-annotation approach.
 */
import { assertFormatCapabilities, writebackOperationKindsFor } from '@otterpatch/core';
import type {
  ChangeSet,
  DocHandle,
  EditId,
  EditOpKind,
  FidelityReport,
  OoxmlPart,
  WritebackBackend,
  WritebackId,
  WritebackKind,
  WritebackResult,
} from '@otterpatch/core';
import { PDFDocument, PDFSignature, PDFTextField } from 'pdf-lib';

const SUPPORTED: ReadonlySet<EditOpKind> = new Set(writebackOperationKindsFor('pdf'));
const PDF_LIMITATIONS = [
  'pdf-lib performs a full serialization; byte locality and incremental updates are not guaranteed',
  'digital signature state, appearance streams, non-form objects, and PDF/A conformance are not fully verified',
];

interface PdfFieldState {
  type: string;
  value?: string;
}

function fieldStates(pdf: PDFDocument): Map<string, PdfFieldState> {
  return new Map(pdf.getForm().getFields().map((field) => [
    field.getName(),
    { type: field.constructor.name, ...(field instanceof PDFTextField ? { value: field.getText() ?? '' } : {}) },
  ]));
}

function metadata(pdf: PDFDocument): Record<string, string | undefined> {
  const date = (value: Date | undefined): string | undefined => value?.toISOString();
  return {
    title: pdf.getTitle(),
    author: pdf.getAuthor(),
    subject: pdf.getSubject(),
    keywords: pdf.getKeywords(),
    creator: pdf.getCreator(),
    producer: pdf.getProducer(),
    creationDate: date(pdf.getCreationDate()),
    modificationDate: date(pdf.getModificationDate()),
  };
}

function failedPdfReport(cs: ChangeSet, reason: string): FidelityReport {
  return {
    score: 0,
    drift: [],
    verification: {
      packageValid: false,
      locality: { intendedParts: [], unexpectedParts: [], unchangedPartRatio: 0 },
      semantic: {
        verifiedEdits: [],
        unverifiableEdits: [],
        failedEdits: cs.edits.map((edit) => ({ editId: edit.id, reason })),
      },
      compatibility: { warnings: PDF_LIMITATIONS },
    },
  };
}

export class PdfFormWriteback implements WritebackBackend {
  readonly id = 'pdf-form' as WritebackId;
  readonly strategy: WritebackKind = 'native-command';

  canHandle(cs: ChangeSet): { ok: boolean; reason?: string } {
    try {
      assertFormatCapabilities('pdf', cs, 'writeback');
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const bad = cs.edits.find((e) => !SUPPORTED.has(e.op.kind));
    if (bad) return { ok: false, reason: `pdf-form supports setValue (AcroForm fields) only (got ${bad.op.kind})` };
    return { ok: true };
  }

  supports(op: EditOpKind, _part: OoxmlPart): boolean {
    return SUPPORTED.has(op);
  }

  async commit(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult> {
    if (!doc.bytes) throw new Error('PdfFormWriteback.commit: DocHandle.bytes required');
    const pdf = await PDFDocument.load(doc.bytes, { updateMetadata: false });
    const form = pdf.getForm();
    if (form.getFields().some((field) => field instanceof PDFSignature)) {
      throw new Error('PdfFormWriteback: signed PDFs are not supported because incremental signature-preserving updates are unavailable');
    }

    const touched: string[] = [];
    const appliedEditIds: EditId[] = [];
    const droppedEdits: Array<{ editId: EditId; reason: string }> = [];
    for (const e of cs.edits) {
      if (e.op.kind !== 'setValue') {
        droppedEdits.push({ editId: e.id, reason: `unsupported op ${e.op.kind}` });
        continue;
      }
      const anchor = cs.anchors[e.target];
      const field = anchor && anchor.portable.kind === 'object' ? anchor.portable.elementId : '';
      if (!field) {
        droppedEdits.push({ editId: e.id, reason: 'missing PDF form field anchor' });
        continue;
      }
      try {
        form.getTextField(field).setText(e.op.value == null ? '' : String(e.op.value));
        touched.push(field);
        appliedEditIds.push(e.id);
      } catch {
        droppedEdits.push({ editId: e.id, reason: 'field not found or not a text field' });
      }
    }

    const bytes = appliedEditIds.length ? await pdf.save() : doc.bytes;
    const fidelity = await this.verify(doc, { hostId: doc.hostId, bytes, rev: doc.rev }, cs);
    return {
      ok: appliedEditIds.length === cs.edits.length && droppedEdits.length === 0,
      bytes,
      touchedParts: touched,
      fidelity,
      appliedEditIds,
      ...(droppedEdits.length ? { droppedEdits } : {}),
    };
  }

  async verify(before: DocHandle, after: DocHandle, cs: ChangeSet): Promise<FidelityReport> {
    if (!before.bytes || !after.bytes) throw new Error('PdfFormWriteback.verify: before/after bytes required');
    let source: PDFDocument;
    let output: PDFDocument;
    try {
      [source, output] = await Promise.all([
        PDFDocument.load(before.bytes, { updateMetadata: false }),
        PDFDocument.load(after.bytes, { updateMetadata: false }),
      ]);
    } catch (error) {
      return failedPdfReport(cs, `PDF parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const intendedParts: string[] = [];
    const targetFields = new Set<string>();
    const verifiedEdits: EditId[] = [];
    const failedEdits: Array<{ editId: EditId; reason: string }> = [];
    for (const edit of cs.edits) {
      const anchor = cs.anchors[edit.target];
      const fieldName = anchor?.portable.kind === 'object' ? anchor.portable.elementId : '';
      if (edit.op.kind !== 'setValue' || !fieldName) {
        failedEdits.push({ editId: edit.id, reason: 'setValue with a PDF form field anchor is required' });
        continue;
      }
      intendedParts.push(fieldName);
      targetFields.add(fieldName);
      try {
        const actual = output.getForm().getTextField(fieldName).getText() ?? '';
        const expected = edit.op.value == null ? '' : String(edit.op.value);
        if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
        verifiedEdits.push(edit.id);
      } catch (error) {
        failedEdits.push({ editId: edit.id, reason: `field "${fieldName}" verification failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    }

    const drift: FidelityReport['drift'] = [];
    if (source.getPageCount() !== output.getPageCount()) {
      drift.push({ part: 'pdf/pages', kind: 'layout', note: `page count changed from ${source.getPageCount()} to ${output.getPageCount()}` });
    }
    if (JSON.stringify(metadata(source)) !== JSON.stringify(metadata(output))) {
      drift.push({ part: 'pdf/metadata', kind: 'content', note: 'document metadata changed' });
    }
    const sourceFields = fieldStates(source);
    const outputFields = fieldStates(output);
    for (const name of new Set([...sourceFields.keys(), ...outputFields.keys()])) {
      if (targetFields.has(name)) continue;
      if (JSON.stringify(sourceFields.get(name)) !== JSON.stringify(outputFields.get(name))) {
        drift.push({ part: `pdf/field/${name}`, kind: 'content', note: 'non-target form field changed' });
      }
    }

    return {
      score: 0,
      drift,
      verification: {
        packageValid: true,
        locality: {
          intendedParts: [...new Set(intendedParts)],
          unexpectedParts: drift.map((item) => item.part),
          unchangedPartRatio: 0,
        },
        semantic: { verifiedEdits, unverifiableEdits: [], failedEdits },
        compatibility: { warnings: PDF_LIMITATIONS },
      },
    };
  }
}
