/**
 * Unit tests for the core surgical-patch invariant — codifies the key conclusion of
 * experiments/exp1_surgical_test.py as a regression test:
 * "patch one part; all other parts stay byte-identical".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { ResourceLimitError } from '@otterpatch/core';
import { comparePartsIntegrity, readOoxmlParts, repackOoxml } from './ooxml.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('外科补丁:只改目标部件,其余字节级不变', () => {
  // Build a minimal synthetic OOXML (mimics a real .docx's multiple parts: body/styles/image)
  const original = zipSync({
    '[Content_Types].xml': enc('<Types/>'),
    'word/document.xml': enc('<w:document><w:t>hello</w:t></w:document>'),
    'word/styles.xml': enc('<styles/>'),
    'word/media/image1.png': new Uint8Array([1, 2, 3, 4, 5]),
  });

  // Surgical patch: modify only document.xml
  const patched = repackOoxml(original, {
    'word/document.xml': enc('<w:document><w:t>hello[PATCH]</w:t></w:document>'),
  });

  const integrity = comparePartsIntegrity(original, patched);
  assert.equal(integrity.total, 4);
  assert.equal(integrity.identical, 3, '样式/图片/Content_Types 必须字节级不变');
  assert.deepEqual(integrity.changed, ['~word/document.xml']);
});

test('无补丁重打包:每个部件字节稳定', () => {
  const original = zipSync({ 'a.xml': enc('<a/>'), 'b.bin': new Uint8Array([9, 9, 9]) });
  const integrity = comparePartsIntegrity(original, repackOoxml(original, {}));
  assert.equal(integrity.identical, 2);
  assert.equal(integrity.changed.length, 0);
});

test('新增部件被纳入', () => {
  const original = zipSync({ 'a.xml': enc('<a/>') });
  const patched = repackOoxml(original, { 'b.xml': enc('<b/>') });
  const integrity = comparePartsIntegrity(original, patched);
  assert.deepEqual(integrity.changed, ['+b.xml']);
  assert.equal(integrity.identical, 1);
});

test('explicit part removal is reported and unrelated parts stay identical', () => {
  const original = zipSync({ 'a.xml': enc('<a/>'), 'stale.xml': enc('<stale/>') });
  const patched = repackOoxml(original, {}, {}, ['stale.xml']);
  const integrity = comparePartsIntegrity(original, patched);

  assert.deepEqual(integrity.changed, ['-stale.xml']);
  assert.equal(integrity.identical, 1);
  assert.equal(readOoxmlParts(patched)['stale.xml'], undefined);
});

test('part removal rejects missing, duplicate, overlapping, and unsafe paths', () => {
  const original = zipSync({ 'a.xml': enc('<a/>') });
  assert.throws(() => repackOoxml(original, {}, {}, ['missing.xml']), /cannot remove missing OOXML part/);
  assert.throws(() => repackOoxml(original, {}, {}, ['a.xml', 'a.xml']), /duplicate removed OOXML part path/);
  assert.throws(() => repackOoxml(original, { 'a.xml': enc('<changed/>') }, {}, ['a.xml']), /cannot be patched and removed/);
  assert.throws(() => repackOoxml(original, {}, {}, ['../a.xml']), /unsafe OOXML part path/);
});

test('OOXML preflight rejects excessive entries, expansion, ratio, and XML depth', () => {
  const entries = zipSync({ 'a.xml': enc('<a/>'), 'b.xml': enc('<b/>'), 'c.xml': enc('<c/>') });
  assert.throws(
    () => readOoxmlParts(entries, { maxEntries: 2 }),
    (error) => error instanceof ResourceLimitError && error.resource === 'zip_entries',
  );

  const expanded = zipSync({ 'a.bin': new Uint8Array(32) });
  assert.throws(
    () => readOoxmlParts(expanded, { maxDecompressedEntryBytes: 16 }),
    (error) => error instanceof ResourceLimitError && error.resource === 'zip_decompressed_entry_bytes',
  );
  assert.throws(
    () => readOoxmlParts(expanded, { maxCompressionRatio: 2 }),
    (error) => error instanceof ResourceLimitError && error.resource === 'zip_compression_ratio',
  );

  const deep = zipSync({ 'a.xml': enc('<a><b><c><d/></c></b></a>') });
  assert.throws(
    () => readOoxmlParts(deep, { maxXmlNestingDepth: 2 }),
    (error) => error instanceof ResourceLimitError && error.resource === 'xml_nesting_depth',
  );
});

test('OOXML preflight rejects oversized archives and unsafe input paths', () => {
  const archive = zipSync({ 'a.xml': enc('<a/>') });
  assert.throws(
    () => readOoxmlParts(archive, { maxArchiveBytes: archive.byteLength - 1 }),
    (error) => error instanceof ResourceLimitError && error.resource === 'document_bytes',
  );
  assert.throws(() => readOoxmlParts(zipSync({ '../escape.xml': enc('<a/>') })), /unsafe OOXML part path/);
});

test('OOXML XML preflight rejects a deterministic malformed-input corpus', () => {
  const malformed = [
    '<root><child></root></child>',
    '<root></other>',
    '<root><child></root>',
    '<root attr="unterminated></root>',
    '<root><!-- unterminated</root>',
    '<root><![CDATA[unterminated</root>',
    '<root><?unterminated</root>',
    '<!DOCTYPE root [<!ENTITY x "boom">]><root>&x;</root>',
    '<root></root extra>',
    '<root><1invalid/></root>',
  ];

  for (const [index, xml] of malformed.entries()) {
    assert.throws(
      () => readOoxmlParts(zipSync({ [`fuzz-${index}.xml`]: enc(xml) })),
      `malformed XML corpus case ${index} was accepted`,
    );
  }
});

test('OOXML XML preflight accepts seeded valid nesting and rejects its mismatched mutation', () => {
  let state = 0x5eed1234;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  for (let sample = 0; sample < 100; sample++) {
    const depth = 1 + (next() % 12);
    const names = Array.from({ length: depth }, (_, index) => `n${sample}_${index}_${next() % 97}`);
    const open = names.map((name, index) => `<${name} data-v="${next() % 1000}">${index % 3 === 0 ? '<!--safe-->' : ''}`).join('');
    const close = [...names].reverse().map((name) => `</${name}>`).join('');
    const valid = `<?xml version="1.0"?>${open}payload${close}`;
    assert.doesNotThrow(() => readOoxmlParts(zipSync({ [`valid-${sample}.xml`]: enc(valid) })));

    const wrongClose = close.replace(`</${names.at(-1)}>`, '</mismatched>');
    assert.throws(() => readOoxmlParts(zipSync({ [`invalid-${sample}.xml`]: enc(open + wrongClose) })), /mismatched XML closing tag/);
  }
});
