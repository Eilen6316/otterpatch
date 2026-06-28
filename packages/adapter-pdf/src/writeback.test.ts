/**
 * PDF 表单填写:setValue(object 锚点 = 字段名)→ AcroForm 字段值更新。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from '@otterpatch/core';
import { PdfFormWriteback } from './writeback.js';

async function makePdfWithField(name: string, initial: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const tf = doc.getForm().createTextField(name);
  tf.setText(initial);
  tf.addToPage(page, { x: 20, y: 100, width: 200, height: 24 });
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

  const out = await PDFDocument.load(res.bytes);
  assert.equal(out.getForm().getTextField('name').getText(), 'Alice');
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
  assert.equal(res.fidelity.drift.length, 1);
});
