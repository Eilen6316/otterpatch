import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { docxToHtml } from './docximport.js';

test('docxToHtml preserves top-level table structure and block order', () => {
  const documentXml =
    '<w:document><w:body>' +
    '<w:p><w:r><w:t>表前段</w:t></w:r></w:p>' +
    '<w:tbl>' +
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    '<w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>字段</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>说明 &amp; 范围</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并内容</w:t></w:r></w:p></w:tc></w:tr>' +
    '</w:tbl>' +
    '<w:p><w:r><w:t>表后段</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml) });

  const result = docxToHtml(bytes);

  assert.deepEqual(result.skipped, []);
  assert.match(result.html, /<table class="rd-tbl">/);
  assert.match(result.html, /<th><p><b>字段<\/b><\/p><\/th>/);
  assert.match(result.html, /说明 &amp; 范围/);
  assert.doesNotMatch(result.html, /&amp;amp;/);
  assert.match(result.html, /<td colspan="2"><p>合并内容<\/p><\/td>/);
  assert.ok(result.html.indexOf('表前段') < result.html.indexOf('<table'));
  assert.ok(result.html.indexOf('</table>') < result.html.indexOf('表后段'));
  assert.doesNotMatch(result.html, /暂以占位显示/);
});
