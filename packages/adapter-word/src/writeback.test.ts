/**
 * Word redline writeback: replaceText (flow anchor) → w:ins/w:del; only word/document.xml is modified, all other parts stay byte-identical.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from '@otterpatch/core';
import { WordRedlineWriteback } from './writeback.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();

function makeDocx(text: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'word/document.xml': enc(
      `<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ),
    'word/styles.xml': enc('<?xml version="1.0"?><w:styles xmlns:w="w"/>'),
  });
}

test('Word 红线写回:replaceText → w:ins,保留 w:pPr,仅 document.xml 变', async () => {
  const a0 = 'a0' as AnchorId;
  const anchor: LogicalAnchor = {
    id: a0,
    hostId: 'h' as unknown as HostId,
    kind: 'flow',
    ref: {},
    portable: { kind: 'flow', path: [0], quote: { prefix: '', text: 'hello world', suffix: '' }, bias: 'left' },
    baseRev: 0 as DocRev,
  };
  const cs: ChangeSet = {
    id: 'c',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: { [a0]: anchor },
    origin: { by: 'human' },
    meta: { intent: 'rephrase' },
    edits: [{ id: 'e0', target: a0, op: { family: 'text', kind: 'replaceText', text: 'hello brave world' } }],
  };

  const original = makeDocx('hello world');
  const wb = new WordRedlineWriteback({ author: 'OtterPatch', date: '2026-01-01T00:00:00Z' });
  const res = await wb.commit(cs, { hostId: 'h', bytes: original, rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(res.touchedParts, ['word/document.xml']);
  const docXml = dec.decode(unzipSync(res.bytes)['word/document.xml']!);
  assert.match(docXml, /<w:ins\b/);
  assert.match(docXml, /<w:pPr>/);

  const a = unzipSync(original);
  const b = unzipSync(res.bytes);
  assert.equal(Buffer.compare(Buffer.from(a['word/styles.xml']!), Buffer.from(b['word/styles.xml']!)), 0);
});

test('Word 红线写回:insertTable → 原生 w:tbl,仍只修改 document.xml', async () => {
  const a0 = 'a-table' as AnchorId;
  const anchor: LogicalAnchor = {
    id: a0,
    hostId: 'h' as unknown as HostId,
    kind: 'flow',
    ref: {},
    portable: { kind: 'flow', path: [], quote: { prefix: '', text: '', suffix: '' }, bias: 'left' },
    baseRev: 0 as DocRev,
  };
  const cs: ChangeSet = {
    id: 'c-table',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: { [a0]: anchor },
    origin: { by: 'agent', sessionId: 'table-test' },
    meta: { intent: 'insert a comparison table' },
    edits: [{
      id: 'e-table',
      target: a0,
      op: { family: 'structure', kind: 'insertTable', rows: [['Name', 'Value'], ['Alpha', '10']], headerRows: 1, at: 'end' },
    }],
  };

  const original = makeDocx('before table');
  const wb = new WordRedlineWriteback({ author: 'OtterPatch', date: '2026-07-12T00:00:00Z' });
  const res = await wb.commit(cs, { hostId: 'h', bytes: original, rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(res.appliedEditIds, ['e-table']);
  assert.deepEqual(res.touchedParts, ['word/document.xml']);
  const before = unzipSync(original);
  const after = unzipSync(res.bytes);
  const docXml = dec.decode(after['word/document.xml']!);
  assert.match(docXml, /<w:tbl>/);
  assert.equal([...docXml.matchAll(/<w:tr>/g)].length, 2);
  assert.equal([...docXml.matchAll(/<w:tc>/g)].length, 4);
  assert.equal(Buffer.compare(Buffer.from(before['word/styles.xml']!), Buffer.from(after['word/styles.xml']!)), 0);
  assert.equal(Buffer.compare(Buffer.from(before['[Content_Types].xml']!), Buffer.from(after['[Content_Types].xml']!)), 0);
});
