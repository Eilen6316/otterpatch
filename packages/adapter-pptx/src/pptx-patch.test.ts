/**
 * pptx surgical writeback: replaceText (flow anchor with path[0]=slide, quote=original text) replaces slide <a:t> text; only slideN.xml changes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from '@otterpatch/core';
import { SurgicalOoxmlWriteback } from '@otterpatch/writeback-surgical';
import { buildPptxCompiler } from './pptx-patch.js';
import { buildPptxVerifier, pptxTextSnapshotFromBytes } from './pptx-text.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();

function makePptx(text: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'ppt/presentation.xml': enc('<?xml version="1.0"?><p:presentation/>'),
    'ppt/slides/slide1.xml': enc(
      `<?xml version="1.0"?><p:sld xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ),
  });
}

function makePptxRuns(paragraphs: string[][]): Uint8Array {
  const body = paragraphs
    .map((runs) => `<a:p>${runs.map((text) => `<a:r><a:t>${text}</a:t></a:r>`).join('')}</a:p>`)
    .join('');
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'ppt/presentation.xml': enc('<?xml version="1.0"?><p:presentation/>'),
    'ppt/slides/slide1.xml': enc(
      `<?xml version="1.0"?><p:sld xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ),
  });
}

function textChangeSet(quote: string, replacement = 'World'): ChangeSet {
  const anchorId = 'a0' as AnchorId;
  return {
    id: 'ppt-text',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: {
      [anchorId]: {
        id: anchorId,
        hostId: 'h' as HostId,
        kind: 'flow',
        ref: null,
        portable: { kind: 'flow', path: [0], quote: { prefix: '', text: quote, suffix: '' }, bias: 'left' },
        baseRev: 0 as DocRev,
      },
    },
    origin: { by: 'human' },
    meta: { intent: 'retitle' },
    edits: [{ id: 'e0', target: anchorId, op: { family: 'text', kind: 'replaceText', text: replacement } }],
  };
}

test('pptx 外科写回:Hello → World,仅 slide1.xml 变', async () => {
  const a0 = 'a0' as AnchorId;
  const anchor: LogicalAnchor = {
    id: a0,
    hostId: 'h' as unknown as HostId,
    kind: 'flow',
    ref: {},
    portable: { kind: 'flow', path: [0], quote: { prefix: '', text: 'Hello', suffix: '' }, bias: 'left' },
    baseRev: 0 as DocRev,
  };
  const cs: ChangeSet = {
    id: 'c',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: { [a0]: anchor },
    origin: { by: 'human' },
    meta: { intent: 'retitle' },
    edits: [{ id: 'e0', target: a0, op: { family: 'text', kind: 'replaceText', text: 'World' } }],
  };

  const original = makePptx('Hello');
  const res = await new SurgicalOoxmlWriteback(buildPptxCompiler()).commit(cs, { hostId: 'h', bytes: original, rev: 0 as DocRev });

  assert.equal(res.ok, true);
  assert.deepEqual(res.touchedParts, ['ppt/slides/slide1.xml']);
  const slide = dec.decode(unzipSync(res.bytes)['ppt/slides/slide1.xml']!);
  assert.match(slide, /<a:t>World<\/a:t>/);

  const a = unzipSync(original);
  const b = unzipSync(res.bytes);
  assert.equal(Buffer.compare(Buffer.from(a['ppt/presentation.xml']!), Buffer.from(b['ppt/presentation.xml']!)), 0);
});

test('pptx writeback: missing quote reports dropped edit and ok=false', async () => {
  const a0 = 'a0' as AnchorId;
  const anchor: LogicalAnchor = {
    id: a0,
    hostId: 'h' as unknown as HostId,
    kind: 'flow',
    ref: {},
    portable: { kind: 'flow', path: [0], quote: { prefix: '', text: 'Missing', suffix: '' }, bias: 'left' },
    baseRev: 0 as DocRev,
  };
  const cs: ChangeSet = {
    id: 'c-missing',
    hostId: 'h',
    baseRev: 0 as DocRev,
    anchors: { [a0]: anchor },
    origin: { by: 'human' },
    meta: { intent: 'retitle' },
    edits: [{ id: 'e0', target: a0, op: { family: 'text', kind: 'replaceText', text: 'World' } }],
  };
  const res = await new SurgicalOoxmlWriteback(buildPptxCompiler()).commit(cs, { hostId: 'h', bytes: makePptx('Hello'), rev: 0 as DocRev });
  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedEditIds, []);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /not found/);
});

test('pptx writeback rejects a quote that occurs more than once on the slide', async () => {
  const original = makePptxRuns([['Hello'], ['Hello']]);
  const res = await new SurgicalOoxmlWriteback(buildPptxCompiler()).commit(
    textChangeSet('Hello'),
    { hostId: 'h', bytes: original, rev: 0 as DocRev },
  );

  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedEditIds, []);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /ambiguous.*2 matches/);
  assert.deepEqual(res.touchedParts, []);
});

test('pptx writeback rejects text that only exists across multiple runs', async () => {
  const original = makePptxRuns([['Hel', 'lo']]);
  const res = await new SurgicalOoxmlWriteback(buildPptxCompiler()).commit(
    textChangeSet('Hello'),
    { hostId: 'h', bytes: original, rev: 0 as DocRev },
  );

  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedEditIds, []);
  assert.match(res.droppedEdits?.[0]?.reason ?? '', /spans multiple <a:t> runs/);
  assert.deepEqual(res.touchedParts, []);
});

test('pptx proposal verifier uses exact slide, paragraph, and run boundaries', () => {
  const unique = makePptxRuns([['Hello'], ['Other']]);
  const snapshot = pptxTextSnapshotFromBytes(unique);
  assert.deepEqual(snapshot, { slides: [{ paragraphs: [{ runs: ['Hello'] }, { runs: ['Other'] }] }] });
  assert.equal(buildPptxVerifier(snapshot)(textChangeSet('Hello')).ok, true);

  const duplicate = { slides: [{ paragraphs: [{ runs: ['Hello'] }, { runs: ['Hello'] }] }] };
  const ambiguous = buildPptxVerifier(duplicate)(textChangeSet('Hello'));
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, 'PPTX_AMBIGUOUS_QUOTE');

  const split = { slides: [{ paragraphs: [{ runs: ['Hel', 'lo'] }] }] };
  const crossRun = buildPptxVerifier(split)(textChangeSet('Hello'));
  assert.equal(crossRun.ok, false);
  assert.equal(crossRun.code, 'PPTX_CROSS_RUN_QUOTE');
});
