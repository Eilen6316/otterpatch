/**
 * Post-write-back semantic read-back: accept-all-revisions transform + ChangeSet simulation.
 * This is the deterministic verification the runtime requires instead of trusting the
 * backend's commit-time estimate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from '@otterpatch/core';
import { acceptRevisions, extractTextBlocks, splitTopLevelBlocks } from './accept.js';
import { verifyWordReadback } from './readback.js';
import { WordRedlineWriteback } from './writeback.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docxFromBlocks(blocks: readonly string[]): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'word/document.xml': enc(
      `<?xml version="1.0"?><w:document ${NS}><w:body>${blocks.join('')}</w:body></w:document>`,
    ),
    'word/styles.xml': enc('<?xml version="1.0"?><w:styles xmlns:w="w"/>'),
  });
}

function readDocXml(bytes: Uint8Array): string {
  return dec.decode(unzipSync(bytes)['word/document.xml']!);
}

function flowAnchor(id: string, quote: string, path: readonly number[] = [0]): LogicalAnchor {
  return {
    id: id as AnchorId,
    hostId: 'h' as HostId,
    kind: 'flow',
    ref: null,
    portable: { kind: 'flow', path: [...path], quote: { prefix: '', text: quote, suffix: '' }, bias: 'left' },
    baseRev: 0 as DocRev,
  };
}

function changeSet(anchors: Record<string, LogicalAnchor>, edits: ChangeSet['edits']): ChangeSet {
  return {
    id: 'cs-readback',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: anchors as ChangeSet['anchors'],
    origin: { by: 'human' },
    meta: { intent: 'readback test' },
    edits,
  };
}

// ── accept.ts ────────────────────────────────────────────────────────────────

test('acceptRevisions: unwraps w:ins, drops w:del and delText', () => {
  const xml = '<w:body><w:p><w:del w:id="1" w:author="a" w:date="d"><w:r><w:delText>gone</w:delText></w:r></w:del>'
    + '<w:ins w:id="2" w:author="a" w:date="d"><w:r><w:t>new</w:t></w:r></w:ins>'
    + '<w:r><w:t> kept</w:t></w:r></w:p></w:body>';
  assert.deepEqual(extractTextBlocks(acceptRevisions(xml)).map((b) => b.text), ['new kept']);
});

test('acceptRevisions: paragraph-mark deletion removes the whole paragraph', () => {
  const xml = '<w:body><w:p><w:pPr><w:rPr><w:del w:id="1" w:author="a" w:date="d"/></w:rPr></w:pPr>'
    + '<w:del w:id="2" w:author="a" w:date="d"><w:r><w:delText>old para</w:delText></w:r></w:del></w:p>'
    + '<w:p><w:r><w:t>survivor</w:t></w:r></w:p></w:body>';
  assert.deepEqual(extractTextBlocks(acceptRevisions(xml)).map((b) => b.text), ['survivor']);
});

test('acceptRevisions: drops rPrChange/pPrChange original snapshots', () => {
  const xml = '<w:body><w:p><w:pPr><w:pPrChange w:id="1" w:author="a" w:date="d"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr>'
    + '<w:r><w:rPr><w:rPrChange w:id="2" w:author="a" w:date="d"><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrChange><w:sz w:val="28"/></w:rPr><w:t>x</w:t></w:r></w:p></w:body>';
  const accepted = acceptRevisions(xml);
  assert.equal(accepted.includes('rPrChange'), false);
  assert.equal(accepted.includes('pPrChange'), false);
  assert.equal(accepted.includes('<w:sz w:val="28"/>'), true);
});

test('splitTopLevelBlocks: a table counts as one block', () => {
  const xml = '<w:body><w:p><w:r><w:t>p1</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>c1</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>p2</w:t></w:r></w:p></w:body>';
  const blocks = splitTopLevelBlocks(xml);
  assert.equal(blocks.length, 3);
  assert.deepEqual(extractTextBlocks(xml).map((b) => b.kind), ['paragraph', 'table', 'paragraph']);
});

// ── verifyWordReadback direct ────────────────────────────────────────────────

const beforeXml = '<w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body>';
const appliedReplace = { id: 'e0', old: 'hello world', new: 'hello brave world' };

test('verifyWordReadback: exact accepted text verifies every applied edit', () => {
  const afterXml = '<w:body><w:p><w:del w:id="1" w:author="a" w:date="d"><w:r><w:delText>hello</w:delText></w:r></w:del>'
    + '<w:ins w:id="2" w:author="a" w:date="d"><w:r><w:t>hello</w:t></w:r></w:ins>'
    + '<w:ins w:id="3" w:author="a" w:date="d"><w:r><w:t> brave</w:t></w:r></w:ins>'
    + '<w:r><w:t> world</w:t></w:r></w:p></w:body>';
  const outcome = verifyWordReadback({ beforeXml, afterXml, appliedEdits: [appliedReplace], pageEdits: [], droppedEdits: [] });
  assert.deepEqual(outcome.verifiedEdits, ['e0']);
  assert.deepEqual(outcome.failedEdits, []);
});

test('verifyWordReadback: missing replacement text fails the edit', () => {
  const afterXml = '<w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body>';
  const outcome = verifyWordReadback({ beforeXml, afterXml, appliedEdits: [appliedReplace], pageEdits: [], droppedEdits: [] });
  assert.deepEqual(outcome.verifiedEdits, []);
  assert.equal(outcome.failedEdits[0]?.editId, 'e0');
  assert.match(outcome.failedEdits[0]?.reason ?? '', /replacement text/);
});

test('verifyWordReadback: dropped edits stay failed with their reasons', () => {
  const outcome = verifyWordReadback({
    beforeXml,
    afterXml: beforeXml,
    appliedEdits: [],
    pageEdits: [],
    droppedEdits: [{ editId: 'e1', reason: 'ambiguous anchor' }],
  });
  assert.deepEqual(outcome.verifiedEdits, []);
  assert.deepEqual(outcome.failedEdits, [{ editId: 'e1', reason: 'ambiguous anchor' }]);
});

test('verifyWordReadback: interaction failure fails the whole subset even when each edit is individually visible', () => {
  // Both edits' new texts are individually present, yet the composed document differs from
  // the sequential simulation (the writer applied them to the swapped paragraphs).
  const twoParas = '<w:body><w:p><w:r><w:t>alpha</w:t></w:r></w:p><w:p><w:r><w:t>gamma</w:t></w:r></w:p></w:body>';
  const swapped = '<w:body><w:p><w:r><w:t>Y</w:t></w:r></w:p><w:p><w:r><w:t>X</w:t></w:r></w:p></w:body>';
  const outcome = verifyWordReadback({
    beforeXml: twoParas,
    afterXml: swapped,
    appliedEdits: [
      { id: 'e0', old: 'alpha', new: 'X' },
      { id: 'e1', old: 'gamma', new: 'Y' },
    ],
    pageEdits: [],
    droppedEdits: [],
  });
  assert.deepEqual(outcome.verifiedEdits, []);
  assert.deepEqual(outcome.failedEdits.map((f) => f.editId), ['e0', 'e1']);
  assert.match(outcome.failedEdits[0]?.reason ?? '', /interaction failure/);
});

// ── end-to-end through the real writer ───────────────────────────────────────

async function commitAndVerify(blocks: readonly string[], cs: ChangeSet): Promise<{ res: Awaited<ReturnType<WordRedlineWriteback['commit']>>; verify: Awaited<ReturnType<WordRedlineWriteback['verify']>>; original: Uint8Array }> {
  const original = docxFromBlocks(blocks);
  const wb = new WordRedlineWriteback({ author: 'OtterPatch', date: '2026-01-01T00:00:00Z' });
  const res = await wb.commit(cs, { hostId: 'h', bytes: original, rev: 0 as DocRev });
  const verify = await wb.verify({ hostId: 'h', bytes: original, rev: 0 as DocRev }, { hostId: 'h', bytes: res.bytes, rev: 1 as DocRev }, cs);
  return { res, verify, original };
}

test('writeback+verify: replaceText verifies semantically', async () => {
  const cs = changeSet({ a0: flowAnchor('a0', 'hello world') }, [
    { id: 'e0', target: 'a0' as AnchorId, op: { family: 'text', kind: 'replaceText', text: 'hello brave world' } },
  ]);
  const { verify } = await commitAndVerify(['<w:p><w:r><w:t>hello world</w:t></w:r></w:p>'], cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0']);
  assert.deepEqual(verify.verification.semantic.failedEdits, []);
});

test('writeback+verify: deleteRange verifies that the paragraph disappears', async () => {
  const blocks = ['<w:p><w:r><w:t>keep</w:t></w:r></w:p>', '<w:p><w:r><w:t>remove me</w:t></w:r></w:p>'];
  const cs = changeSet({ a0: flowAnchor('a0', 'remove me', [1]) }, [
    { id: 'e0', target: 'a0' as AnchorId, op: { family: 'value', kind: 'deleteRange' } },
  ]);
  const { verify } = await commitAndVerify(blocks, cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0']);
  assert.equal(verify.verification.packageValid, true);
});

test('writeback+verify: insertTable verifies the table lands with its cell texts', async () => {
  const blocks = ['<w:p><w:r><w:t>intro</w:t></w:r></w:p>'];
  const cs = changeSet({ a0: flowAnchor('a0', '', []) }, [
    { id: 'e0', target: 'a0' as AnchorId, op: { family: 'structure', kind: 'insertTable', rows: [['h1', 'h2'], ['v1', 'v2']], headerRows: 1, at: 'end' } },
  ]);
  const { verify } = await commitAndVerify(blocks, cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0']);
});

test('writeback+verify: character and paragraph style edits verify', async () => {
  const blocks = ['<w:p><w:r><w:t>style me</w:t></w:r></w:p>'];
  const cs = changeSet(
    { a0: flowAnchor('a0', 'style me', [0]) },
    [
      { id: 'e0', target: 'a0' as AnchorId, op: { family: 'style', kind: 'setStyle', scope: 'selection', style: { bold: true } } },
      { id: 'e1', target: 'a0' as AnchorId, op: { family: 'style', kind: 'setStyle', scope: 'paragraph', style: { align: 'center' } } },
    ],
  );
  const { verify } = await commitAndVerify(blocks, cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0', 'e1']);
});

test('writeback+verify: page-level style edits verify against sectPr', async () => {
  const blocks = ['<w:p><w:r><w:t>page</w:t></w:r></w:p>', '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'];
  const cs = changeSet({ a0: flowAnchor('a0', '', []) }, [
    { id: 'e0', target: 'a0' as AnchorId, op: { family: 'style', kind: 'setStyle', scope: 'document', style: { columns: 2, margin: 'narrow', orient: 'landscape' } } },
  ]);
  const { verify } = await commitAndVerify(blocks, cs);
  assert.deepEqual(verify.verification.semantic.verifiedEdits, ['e0']);
});

test('writeback+verify: a tampered output (insertion text stripped) fails the edit', async () => {
  const blocks = ['<w:p><w:r><w:t>hello world</w:t></w:r></w:p>'];
  const cs = changeSet({ a0: flowAnchor('a0', 'hello world') }, [
    { id: 'e0', target: 'a0' as AnchorId, op: { family: 'text', kind: 'replaceText', text: 'hello brave world' } },
  ]);
  const original = docxFromBlocks(blocks);
  const wb = new WordRedlineWriteback({ author: 'OtterPatch', date: '2026-01-01T00:00:00Z' });
  const res = await wb.commit(cs, { hostId: 'h', bytes: original, rev: 0 as DocRev });

  // Simulate a corrupted writer: strip the inserted text while keeping the deletion revision.
  const parts = unzipSync(res.bytes);
  const tampered = readDocXml(res.bytes).replace(/<w:ins\b[^>]*>[\s\S]*?<\/w:ins>/g, '');
  const tamperedBytes = zipSync({ ...parts, 'word/document.xml': enc(tampered) });

  // Foreign bytes miss the backend's expectation cache; verify() still runs the whole-set
  // read-back from the actual before/after bytes when both parse as OOXML.
  const verify = await wb.verify(
    { hostId: 'h', bytes: original, rev: 0 as DocRev },
    { hostId: 'h', bytes: tamperedBytes, rev: 1 as DocRev },
    cs,
  );
  assert.deepEqual(verify.verification.semantic.verifiedEdits, []);
  assert.equal(verify.verification.semantic.failedEdits[0]?.editId, 'e0');
  assert.match(verify.verification.semantic.failedEdits[0]?.reason ?? '', /whole-set read-back/);
});

test('writeback+verify: ambiguous anchors stay dropped and failed', async () => {
  const blocks = ['<w:p><w:r><w:t>same same</w:t></w:r></w:p>'];
  const cs = changeSet({ a0: flowAnchor('a0', 'same') }, [
    { id: 'e0', target: 'a0' as AnchorId, op: { family: 'text', kind: 'replaceText', text: 'changed' } },
  ]);
  const { res, verify } = await commitAndVerify(blocks, cs);
  assert.equal(res.ok, false);
  assert.deepEqual(verify.verification.semantic.failedEdits.map((f) => f.editId), ['e0']);
});
