/**
 * 外科手术级格式写回:字符格式(rPr/rPrChange)、段落格式(pPr/pPrChange)、
 * 以及文本改写的 run 级保真(未触及 run 逐字节保留)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
import type { AnchorId, ChangeSet, DocRev, HostId, LogicalAnchor } from '@otterpatch/core';
import { redlineDocumentXml } from './document.js';
import { WordRedlineWriteback } from './writeback.js';

const doc = (inner: string, pPr = ''): string => `<w:document><w:body><w:p>${pPr}${inner}</w:p></w:body></w:document>`;

test('字符格式:加粗命中片段 → rPr+rPrChange,前后文各自成 run 保留', () => {
  const { xml, changed } = redlineDocumentXml(doc('<w:r><w:t>今天天气很好</w:t></w:r>'), [{ kind: 'fmt', quote: '天气', char: { bold: true } }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  assert.match(xml, /<w:r><w:rPr><w:b\/><w:rPrChange w:id="\d+" w:author="A" w:date="D"><w:rPr\/><\/w:rPrChange><\/w:rPr><w:t xml:space="preserve">天气<\/w:t><\/w:r>/);
  assert.match(xml, /<w:t xml:space="preserve">今天<\/w:t>/);
  assert.match(xml, /<w:t xml:space="preserve">很好<\/w:t>/);
});

test('字符格式:合并已有 rPr,原属性入 rPrChange', () => {
  const { xml } = redlineDocumentXml(doc('<w:r><w:rPr><w:i/></w:rPr><w:t>斜体字</w:t></w:r>'), [{ kind: 'fmt', quote: '斜体字', char: { bold: true, size: 14 } }]);
  assert.match(xml, /<w:rPr><w:i\/><w:b\/><w:sz w:val="28"\/><w:szCs w:val="28"\/><w:rPrChange[^>]*><w:rPr><w:i\/><\/w:rPr><\/w:rPrChange><\/w:rPr>/);
});

test('字符格式:字体 + 颜色', () => {
  const { xml } = redlineDocumentXml(doc('<w:r><w:t>ABC</w:t></w:r>'), [{ kind: 'fmt', quote: 'ABC', char: { font: '黑体', color: '#C00000' } }]);
  assert.match(xml, /<w:rFonts w:ascii="黑体" w:hAnsi="黑体" w:eastAsia="黑体" w:cs="黑体"\/>/);
  assert.match(xml, /<w:color w:val="C00000"\/>/);
});

test('段落格式:居中 + 标题2 → pStyle/jc + pPrChange 存原 pPr', () => {
  const { xml, changed } = redlineDocumentXml(doc('<w:r><w:t>小标题</w:t></w:r>', '<w:pPr><w:jc w:val="left"/></w:pPr>'), [{ kind: 'fmt', quote: '小标题', para: { align: 'center', block: 'h2' } }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  assert.match(xml, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(xml, /<w:jc w:val="center"\/>/);
  assert.doesNotMatch(xml.split('<w:pPrChange')[0]!, /w:val="left"/); // 旧 left 仅存于修订内
  assert.match(xml, /<w:pPrChange w:id="\d+" w:author="A" w:date="D"><w:pPr><w:jc w:val="left"\/><\/w:pPr><\/w:pPrChange>/);
});

test('段落格式:行距 1.5 + 底纹', () => {
  const { xml } = redlineDocumentXml(doc('<w:r><w:t>正文段</w:t></w:r>'), [{ kind: 'fmt', quote: '正文段', para: { lineSpacing: 1.5, bgColor: '#FFF3CD' } }]);
  assert.match(xml, /<w:spacing w:line="360" w:lineRule="auto"\/>/);
  assert.match(xml, /<w:shd w:val="clear" w:color="auto" w:fill="FFF3CD"\/>/);
});

test('保真:文本改写只碰命中 run,加粗 run 逐字节保留', () => {
  const { xml } = redlineDocumentXml(doc('<w:r><w:rPr><w:b/></w:rPr><w:t>重要:</w:t></w:r><w:r><w:t>利润 100</w:t></w:r>'), [{ old: '100', new: '200' }], { author: 'A', date: 'D' });
  assert.match(xml, /<w:r><w:rPr><w:b\/><\/w:rPr><w:t>重要:<\/w:t><\/w:r>/); // 未触及 run 原样
  assert.match(xml, /<w:delText xml:space="preserve">100<\/w:delText>/);
  assert.match(xml, /<w:t xml:space="preserve">200<\/w:t>/);
});

// ── 端到端:setStyle 写回 .docx,只有 document.xml 变,含 rPrChange ──
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = new TextDecoder();
function makeDocx(text: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    'word/document.xml': enc(`<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
    'word/styles.xml': enc('<?xml version="1.0"?><w:styles xmlns:w="w"/>'),
  });
}

test('写回:setStyle(加粗)→ rPrChange,仅 document.xml 变', async () => {
  const a0 = 'a0' as AnchorId;
  const anchor: LogicalAnchor = { id: a0, hostId: 'h' as unknown as HostId, kind: 'flow', ref: {}, portable: { kind: 'flow', path: [0], quote: { prefix: '', text: 'brave', suffix: '' }, bias: 'left' }, baseRev: 0 as DocRev };
  const cs: ChangeSet = {
    id: 'c', hostId: 'h', baseRev: 0 as DocRev, anchors: { [a0]: anchor }, origin: { by: 'human' }, meta: { intent: 'emphasize' },
    edits: [{ id: 'e0', target: a0, op: { family: 'style', kind: 'setStyle', style: { bold: true } } }],
  };
  const original = makeDocx('be brave now');
  const wb = new WordRedlineWriteback({ author: 'OtterPatch', date: '2026-01-01T00:00:00Z' });
  const res = await wb.commit(cs, { hostId: 'h', bytes: original, rev: 0 as DocRev });
  assert.equal(res.ok, true);
  assert.deepEqual(res.touchedParts, ['word/document.xml']);
  const docXml = dec.decode(unzipSync(res.bytes)['word/document.xml']!);
  assert.match(docXml, /<w:b\/>/);
  assert.match(docXml, /<w:rPrChange\b/);
  const a = unzipSync(original); const b = unzipSync(res.bytes);
  assert.equal(Buffer.compare(Buffer.from(a['word/styles.xml']!), Buffer.from(b['word/styles.xml']!)), 0);
});

// ── 审查修复的回归 ──
test('回归#1:命中含 <w:br/> 的复杂 run → 整段回退,不重复正文', () => {
  const { xml } = redlineDocumentXml(doc('<w:r><w:t>A</w:t></w:r><w:r><w:t>B</w:t><w:br/><w:t>C</w:t></w:r>'), [{ old: 'ABC', new: 'X' }]);
  assert.match(xml, /<w:delText xml:space="preserve">ABC<\/w:delText>/);
  assert.match(xml, /<w:t xml:space="preserve">X<\/w:t>/);
  assert.doesNotMatch(xml, /<w:t[^>]*>B<\/w:t>/); // 旧 bug 会把复杂 run 的 B 原样留下 → 重复
});

test('回归#4:自闭合空段 <w:p/> 不吞并下一段;块格式落到真实段', () => {
  const d = '<w:document><w:body><w:p w14:paraId="1"/><w:p><w:r><w:t>标题行</w:t></w:r></w:p></w:body></w:document>';
  const { xml, changed } = redlineDocumentXml(d, [{ kind: 'fmt', quote: '标题行', para: { block: 'h1' } }]);
  assert.equal(changed, 1);
  assert.match(xml, /<w:p w14:paraId="1"\/>/); // 空段原样保留
  assert.match(xml, /<w:pStyle w:val="Heading1"\/>/);
});

test('回归#2:三位简写色 #f00 展开为 FF0000', () => {
  const { xml } = redlineDocumentXml(doc('<w:r><w:t>红</w:t></w:r>'), [{ kind: 'fmt', quote: '红', char: { color: '#f00' } }]);
  assert.match(xml, /<w:color w:val="FF0000"\/>/);
});

test('回归#3:多格式 quote 改一词,未改词保留原 run 格式', () => {
  // run1 斜体 "Hello " + run2 加粗 "World";把 Hello→Hi,未改的加粗 "World" 应仍带 <w:b/>(旧 bug 会被改成斜体)
  const { xml } = redlineDocumentXml(doc('<w:r><w:rPr><w:i/></w:rPr><w:t>Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r>'), [{ old: 'Hello World', new: 'Hi World' }]);
  assert.match(xml, /<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">World<\/w:t><\/w:r>/); // 未改的 World 仍加粗
  assert.match(xml, /<w:delText xml:space="preserve">Hello<\/w:delText>/);
});
