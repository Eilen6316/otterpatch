/**
 * PDF form filling: setValue (object anchor = field name) → updates the AcroForm field value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from '@otterpatch/core';
import { PdfFormWriteback } from './writeback.js';

async function makePdfWithField(name: string, initial: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Form fixture');
  doc.setAuthor('OtterPatch tests');
  const page = doc.addPage([300, 200]);
  const tf = doc.getForm().createTextField(name);
  tf.setText(initial);
  tf.addToPage(page, { x: 20, y: 100, width: 200, height: 24 });
  const untouched = doc.getForm().createTextField('untouched');
  untouched.setText('keep');
  untouched.addToPage(page, { x: 20, y: 60, width: 200, height: 24 });
  return doc.save();
}

test('PDF 表单填写:setValue → 字段值更新,且仍是合法 PDF', async () => {
  const original = await makePdfWithField('name', 'old');
  const a0 = 'a0' as AnchorId;
  const anchor: LogicalAnchor = {
    id: a0,
    hostId: 'h' as unknown as HostId,
    kind: 'object',
    ref: {},
    portable: { kind: 'object', slide: 0, elementId: 'name' },
    baseRev: 0 as DocRev,
  };
  const cs: ChangeSet = {
    id: 'c',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: { [a0]: anchor },
    origin: { by: 'human' },
    meta: { intent: 'fill name' },
    edits: [{ id: 'e0', target: a0, op: { family: 'value', kind: 'setValue', value: 'Alice' } }],
  };

  const res = await new PdfFormWriteback().commit(cs, { hostId: 'h', bytes: original, rev: 0 as DocRev });
  assert.equal(res.ok, true);
  assert.deepEqual(res.touchedParts, ['name']);
  assert.equal(res.fidelity.score, 0);
  assert.equal(res.fidelity.verification?.packageValid, true);
  assert.deepEqual(res.fidelity.verification?.semantic.verifiedEdits, ['e0']);
  assert.match(res.fidelity.verification?.compatibility.warnings[0] ?? '', /byte locality/);

  const out = await PDFDocument.load(res.bytes);
  assert.equal(out.getForm().getTextField('name').getText(), 'Alice');
  assert.equal(out.getForm().getTextField('untouched').getText(), 'keep');
  assert.equal(out.getTitle(), 'Form fixture');
  assert.equal(out.getAuthor(), 'OtterPatch tests');
});

test('PDF 表单填写:未知字段 → drift,不 ok', async () => {
  const original = await makePdfWithField('name', 'old');
  const a0 = 'a0' as AnchorId;
  const anchor: LogicalAnchor = {
    id: a0,
    hostId: 'h' as unknown as HostId,
    kind: 'object',
    ref: {},
    portable: { kind: 'object', slide: 0, elementId: 'nope' },
    baseRev: 0 as DocRev,
  };
  const cs: ChangeSet = {
    id: 'c',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: { [a0]: anchor },
    origin: { by: 'human' },
    meta: { intent: 'fill' },
    edits: [{ id: 'e0', target: a0, op: { family: 'value', kind: 'setValue', value: 'x' } }],
  };
  const res = await new PdfFormWriteback().commit(cs, { hostId: 'h', bytes: original, rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.deepEqual(res.bytes, original, 'a fully dropped proposal must not reserialize the PDF');
  assert.deepEqual(res.fidelity.verification?.semantic.failedEdits.map((failure) => failure.editId), ['e0']);
});

test('PDF form fill: missing anchor reports dropped edit', async () => {
  const original = await makePdfWithField('name', 'old');
  const cs: ChangeSet = {
    id: 'c-missing-anchor',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: {},
    origin: { by: 'human' },
    meta: { intent: 'fill' },
    edits: [{ id: 'e0', target: 'missing' as AnchorId, op: { family: 'value', kind: 'setValue', value: 'x' } }],
  };
  const res = await new PdfFormWriteback().commit(cs, { hostId: 'h', bytes: original, rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedEditIds, []);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /anchor/);
});

test('PDF verification detects target mismatch and unrelated field drift', async () => {
  const original = await makePdfWithField('name', 'old');
  const a0 = 'a0' as AnchorId;
  const cs: ChangeSet = {
    id: 'c-verify',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: {
      [a0]: {
        id: a0,
        hostId: 'h' as HostId,
        kind: 'object',
        ref: null,
        portable: { kind: 'object', slide: 0, elementId: 'name' },
        baseRev: 0 as DocRev,
      },
    },
    origin: { by: 'human' },
    meta: { intent: 'fill name' },
    edits: [{ id: 'e0', target: a0, op: { family: 'value', kind: 'setValue', value: 'Alice' } }],
  };
  const tampered = await PDFDocument.load(original, { updateMetadata: false });
  tampered.getForm().getTextField('name').setText('Mallory');
  tampered.getForm().getTextField('untouched').setText('changed');
  const report = await new PdfFormWriteback().verify(
    { hostId: 'h', bytes: original, rev: 0 as DocRev },
    { hostId: 'h', bytes: await tampered.save(), rev: 1 as DocRev },
    cs,
  );
  assert.deepEqual(report.verification?.semantic.failedEdits.map((failure) => failure.editId), ['e0']);
  assert.ok(report.drift.some((item) => item.part === 'pdf/field/untouched'));
});
