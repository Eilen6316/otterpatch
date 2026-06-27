/**
 * 外科补丁核心性质的单元测试 —— 把 experiments/exp1_surgical_test.py 的关键结论固化为回归测试:
 * "改一处部件,其余部件字节级不变"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { comparePartsIntegrity, repackOoxml } from './ooxml.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('外科补丁:只改目标部件,其余字节级不变', () => {
  // 合成一个迷你 OOXML(模拟真实 .docx 的多部件:正文/样式/图片)
  const original = zipSync({
    '[Content_Types].xml': enc('<Types/>'),
    'word/document.xml': enc('<w:document><w:t>hello</w:t></w:document>'),
    'word/styles.xml': enc('<styles/>'),
    'word/media/image1.png': new Uint8Array([1, 2, 3, 4, 5]),
  });

  // 外科补丁:只改 document.xml
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
