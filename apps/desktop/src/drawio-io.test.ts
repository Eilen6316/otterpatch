import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync, strToU8 } from 'fflate';
import { parseDrawioFile } from './drawio-io.js';

const MODEL = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="A" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>';

test('drawio import reports whether any source diagram is compressed', () => {
  const plain = parseDrawioFile(`<mxfile><diagram id="d0">${MODEL}</diagram></mxfile>`);
  assert.equal(plain.sourceEncoding, 'uncompressed');
  assert.equal(plain.pages[0]?.nodes[0]?.id, '2');

  const payload = Buffer.from(deflateSync(strToU8(encodeURIComponent(MODEL)))).toString('base64');
  const compressed = parseDrawioFile(`<mxfile><diagram id="d0">${payload}</diagram></mxfile>`);
  assert.equal(compressed.sourceEncoding, 'compressed');
  assert.equal(compressed.pages[0]?.nodes[0]?.id, '2');
});
