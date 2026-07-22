import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { OtterPatchRuntime } from '@otterpatch/runtime';

const enc = (s) => new TextEncoder().encode(s);
const dec = new TextDecoder();
const rt = new OtterPatchRuntime();
const base = { by: 'human' };

async function reviewedCommit(format, bytes, changeSet) {
  const proposal = rt.createProposal(changeSet, format, `fixture:${changeSet.id}`);
  const reviewed = rt.reviewProposal(proposal, changeSet, changeSet.edits.map((edit) => edit.id), bytes, 'real-writeback-test');
  return rt.commit({ format, bytes, changeSet, currentRev: 0, ...reviewed });
}

function xlsxSample() {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'xl/workbook.xml': enc('<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': enc('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/styles.xml': enc('<?xml version="1.0"?><styleSheet/>'),
    'xl/worksheets/sheet1.xml': enc('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="B1"><v>20</v></c></row></sheetData></worksheet>'),
  });
}

function docxSample() {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'word/document.xml': enc('<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body></w:document>'),
    'word/styles.xml': enc('<?xml version="1.0"?><w:styles xmlns:w="w"/>'),
  });
}

function pptxSample() {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'ppt/presentation.xml': enc('<?xml version="1.0"?><p:presentation/>'),
    'ppt/slides/slide1.xml': enc('<?xml version="1.0"?><p:sld xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'),
  });
}

function drawioSample() {
  return enc('<mxfile><diagram id="d0"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Old" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>');
}

async function pdfSample() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const field = doc.getForm().createTextField('name');
  field.setText('old');
  field.addToPage(page, { x: 20, y: 100, width: 160, height: 24 });
  return doc.save();
}

function gridCs() {
  return {
    id: 'xlsx-cs', hostId: 'h', baseRev: 0, origin: base, meta: { intent: 'set B1' },
    anchors: { a0: { id: 'a0', hostId: 'h', kind: 'grid', ref: null, baseRev: 0, portable: { kind: 'grid', sheet: 'Sheet1', a1: 'Sheet1!B1' } } },
    edits: [{ id: 'e0', target: 'a0', op: { family: 'value', kind: 'setValue', value: 99 } }],
  };
}

function flowCs(format, quote, text, path = [0]) {
  return {
    id: `${format}-cs`, hostId: 'h', baseRev: 0, origin: base, meta: { intent: 'replace text' },
    anchors: { a0: { id: 'a0', hostId: 'h', kind: 'flow', ref: null, baseRev: 0, portable: { kind: 'flow', path, quote: { prefix: '', text: quote, suffix: '' }, bias: 'left' } } },
    edits: [{ id: 'e0', target: 'a0', op: { family: 'text', kind: 'replaceText', text } }],
  };
}

function wordTableCs() {
  return {
    id: 'word-table-cs', hostId: 'h', baseRev: 0, origin: base, meta: { intent: 'insert table' },
    anchors: { a0: { id: 'a0', hostId: 'h', kind: 'flow', ref: null, baseRev: 0, portable: { kind: 'flow', path: [], quote: { prefix: '', text: '', suffix: '' }, bias: 'left' } } },
    edits: [{ id: 'e0', target: 'a0', op: { family: 'structure', kind: 'insertTable', rows: [['Name', 'Value'], ['Alpha', '10']], headerRows: 1, at: 'end' } }],
  };
}

function objectCs(format, elementId, value) {
  return {
    id: `${format}-cs`, hostId: 'h', baseRev: 0, origin: base, meta: { intent: 'set value' },
    anchors: { a0: { id: 'a0', hostId: 'h', kind: 'object', ref: null, baseRev: 0, portable: { kind: 'object', slide: 0, elementId } } },
    edits: [{ id: 'e0', target: 'a0', op: { family: 'value', kind: 'setValue', value } }],
  };
}

async function checkXlsx() {
  const res = await reviewedCommit('excel', xlsxSample(), gridCs());
  assert.equal(res.ok, true);
  assert.match(dec.decode(unzipSync(res.bytes)['xl/worksheets/sheet1.xml']), /<v>99<\/v>/);
}

async function checkDocx() {
  const res = await reviewedCommit('word', docxSample(), flowCs('word', 'hello world', 'hello safe world'));
  assert.equal(res.ok, true);
  assert.match(dec.decode(unzipSync(res.bytes)['word/document.xml']), /w:ins/);
}

async function checkDocxTable() {
  const res = await reviewedCommit('word', docxSample(), wordTableCs());
  assert.equal(res.ok, true);
  const documentXml = dec.decode(unzipSync(res.bytes)['word/document.xml']);
  assert.match(documentXml, /<w:tbl>/);
  assert.equal([...documentXml.matchAll(/<w:tr>/g)].length, 2);
  assert.equal([...documentXml.matchAll(/<w:tc>/g)].length, 4);
}

async function checkPptx() {
  const res = await reviewedCommit('pptx', pptxSample(), flowCs('pptx', 'Hello', 'World'));
  assert.equal(res.ok, true);
  assert.match(dec.decode(unzipSync(res.bytes)['ppt/slides/slide1.xml']), /<a:t>World<\/a:t>/);
}

async function checkDrawio() {
  const cs = objectCs('drawio', '2', 'New');
  const res = await reviewedCommit('drawio', drawioSample(), cs);
  assert.equal(res.ok, true);
  assert.match(dec.decode(res.bytes), /value="New"/);
}

async function checkPdf() {
  const res = await reviewedCommit('pdf', await pdfSample(), objectCs('pdf', 'name', 'Alice'));
  assert.equal(res.ok, true);
  const out = await PDFDocument.load(res.bytes);
  assert.equal(out.getForm().getTextField('name').getText(), 'Alice');
}

for (const [name, fn] of Object.entries({ xlsx: checkXlsx, docx: checkDocx, docxTable: checkDocxTable, pptx: checkPptx, drawio: checkDrawio, pdf: checkPdf })) {
  await fn();
  console.log(`[real-writeback] ${name} ok`);
}
console.log('[real-writeback] all formats ok');
