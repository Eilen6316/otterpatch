import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redlineDocumentXml } from './document.js';

const DOC =
  '<w:document><w:body>' +
  '<w:p><w:pPr><w:pStyle w:val="a"/></w:pPr><w:r><w:t>利润是 100 元</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>合计 50</w:t></w:r></w:p>' +
  '</w:body></w:document>';

test('redlineDocumentXml: 命中段落改红线,保留 pPr,其它段不动', () => {
  const { xml, changed } = redlineDocumentXml(DOC, [{ old: '100', new: '200' }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  assert.match(xml, /<w:del[^>]*><w:r><w:delText[^>]*>100<\/w:delText>/);
  assert.match(xml, /<w:ins[^>]*><w:r><w:t[^>]*>200<\/w:t>/);
  assert.match(xml, /<w:pPr><w:pStyle w:val="a"\/><\/w:pPr>/); // pPr preserved
  assert.match(xml, /<w:t>合计 50<\/w:t>/); // other paragraph untouched
});

test('redlineDocumentXml: 无命中 → 不改,changed=0', () => {
  const { xml, changed } = redlineDocumentXml(DOC, [{ old: '999', new: '1' }]);
  assert.equal(changed, 0);
  assert.equal(xml, DOC);
});

test('redlineDocumentXml: 多段命中各自红线,w:id 递增不冲突', () => {
  const { xml, changed } = redlineDocumentXml(DOC, [
    { old: '100', new: '200' },
    { old: '50', new: '60' },
  ]);
  assert.equal(changed, 2);
  const ids = [...xml.matchAll(/w:id="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(new Set(ids).size, ids.length); // all unique, no duplicates
});

// ── 新修订形态:删段(delPara)/ 图片(img)/ 段号锚(paraIdx)──

const DOC2 =
  '<w:document><w:body>' +
  '<w:p><w:r><w:t>标题段</w:t></w:r></w:p>' +
  '<w:p/>' + // 空自闭合段(Word 常见)
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>' + // 空段带 pPr
  '<w:p><w:r><w:t>残留文字</w:t></w:r></w:p>' +
  '<w:p><w:r><w:drawing><wp:extent cx="1143000" cy="857250"/><a:ext cx="1143000" cy="857250"/></w:drawing></w:r><w:r><w:t>含图段文字</w:t></w:r></w:p>' +
  '</w:body></w:document>';

test('delPara: quote 锚定 → 全部 run 包 w:del(w:t→w:delText)+ 段落符删除标记', () => {
  const { xml, changed } = redlineDocumentXml(DOC2, [{ kind: 'delPara', quote: '残留文字' }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  assert.match(xml, /<w:del[^>]*><w:r><w:delText[^>]*>残留文字<\/w:delText><\/w:r><\/w:del>/);
  assert.match(xml, /<w:pPr><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr><w:del/); // 段落符删除在 pPr 里
  assert.match(xml, /<w:t>标题段<\/w:t>/); // 其它段不动
});

test('delPara: 段号锚定空自闭合段(paraIdx=1)→ 只落段落符删除', () => {
  const { xml, changed } = redlineDocumentXml(DOC2, [{ kind: 'delPara', paraIdx: 1 }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  assert.match(xml, /<w:p><w:pPr><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr><\/w:p>/);
  assert.match(xml, /<w:t>标题段<\/w:t>/);
  assert.match(xml, /<w:jc w:val="center"\/>/); // 相邻空段(带 pPr)未被误删
});

test('delPara: 段号锚定带 pPr 的空段(paraIdx=2)→ 段落符删除并保留原 pPr 内容', () => {
  const { xml, changed } = redlineDocumentXml(DOC2, [{ kind: 'delPara', paraIdx: 2 }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  assert.match(xml, /<w:pPr><w:jc w:val="center"\/><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr>/);
});

test('img resize: wp:extent/a:ext 按 EMU 重写且保持纵横比,文字 run 不动', () => {
  const { xml, changed } = redlineDocumentXml(DOC2, [{ kind: 'img', action: 'resize', width: 60, quote: '含图段文字' }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  const cx = 60 * 9525; // 571500
  const cy = Math.round(cx * (857250 / 1143000)); // 428625
  assert.match(xml, new RegExp(`<wp:extent cx="${cx}" cy="${cy}"/>`));
  assert.match(xml, new RegExp(`<a:ext cx="${cx}" cy="${cy}"/>`));
  assert.match(xml, /<w:t>含图段文字<\/w:t>/); // 文字原样
});

test('img remove: 含 drawing 的 run 包 w:del,同段文字 run 保留', () => {
  const { xml, changed } = redlineDocumentXml(DOC2, [{ kind: 'img', action: 'remove', paraIdx: 4 }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  assert.match(xml, /<w:del[^>]*><w:r><w:drawing>[\s\S]*?<\/w:drawing><\/w:r><\/w:del>/);
  assert.match(xml, /<w:t>含图段文字<\/w:t>/); // 文字 run 不在 w:del 里
  assert.doesNotMatch(xml, /<w:del[^>]*><w:r><w:t[^>]*>含图段文字/);
});

test('paraIdx 计块与导入器镜像:顶层 w:tbl 算一个块,表内 w:p 不计数', () => {
  const DOC3 =
    '<w:document><w:body>' +
    '<w:p><w:r><w:t>第一段</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表内段</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:t>表后段</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  // 块序:0=第一段,1=表格(整体),2=表后段 —— paraIdx=2 必须落在"表后段"
  const { xml, changed } = redlineDocumentXml(DOC3, [{ kind: 'delPara', paraIdx: 2 }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  assert.match(xml, /<w:delText[^>]*>表后段<\/w:delText>/);
  assert.doesNotMatch(xml, /<w:delText[^>]*>表内段/);
});

test('fmt + 段号锚:空段落也能套段落格式(quote 为空)', () => {
  const { xml, changed } = redlineDocumentXml(DOC2, [{ kind: 'fmt', quote: '', paraIdx: 2, para: { align: 'right' } }], { author: 'A', date: 'D' });
  assert.equal(changed, 1);
  assert.match(xml, /<w:jc w:val="right"\/>/);
  assert.match(xml, /<w:pPrChange/); // 段落格式修订可审
});
