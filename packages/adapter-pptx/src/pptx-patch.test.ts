/**
 * pptx 外科写回:replaceText(flow 锚点 path[0]=slide、quote=原文)→ slide <a:t> 文本替换,仅 slideN.xml 变。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from '@otterpatch/core';
import { SurgicalOoxmlWriteback } from '@otterpatch/writeback-surgical';
import { buildPptxCompiler } from './pptx-patch.js';

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
