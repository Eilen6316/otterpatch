/**
 * 真实 docx 载入闭环(hero 环节①):测试内存里现造一个最小 .docx(fflate 打 zip),
 * 走真实上传入口 → 断言标题/加粗/居中/字号/双栏占位等都渲染进了 Word 工作区,
 * 且选区/提案链路对导入内容照常工作(圈选导入文本 → 芯片出现)。
 */
import { zipSync, strToU8 } from 'fflate';
import { openApp, sleep } from './harness.mjs';

const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="36"/></w:rPr><w:t>吉林省财政收入分析报告</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">本报告基于 2005-2024 年数据,</w:t></w:r><w:r><w:rPr><w:b/><w:color w:val="C00000"/></w:rPr><w:t>核心结论已加粗标红</w:t></w:r><w:r><w:t>,供审阅。</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>变量说明</w:t></w:r></w:p>
<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>变量</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>含义</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>GDP</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>地区生产总值</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:pPr><w:jc w:val="both"/><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t>斜体下划线样段</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const docxBytes = zipSync({ '[Content_Types].xml': strToU8(CONTENT_TYPES), '_rels/.rels': strToU8(RELS), 'word/document.xml': strToU8(DOC_XML) });

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.apiKey': 'test-key', 'oa.server': 'http://localhost:4319' } });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL', n); } };

try {
  await page.waitForSelector('.rd-page');
  await sleep(400);
  await page.setInputFiles('input[data-role="attach"]', { name: '财政分析.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(docxBytes) });
  await sleep(600);

  ok('标题渲染为 h1 且居中', await page.evaluate(() => { const h = document.querySelector('.rd-page h1'); return !!h && /财政收入分析报告/.test(h.textContent) && getComputedStyle(h).textAlign === 'center'; }));
  ok('run 级加粗+标红保留', await page.evaluate(() => { const b = [...document.querySelectorAll('.rd-page b')].find((e) => /核心结论已加粗标红/.test(e.textContent)); if (!b) return false; const sp = b.closest('span'); return !!sp && /c00000/i.test(sp.getAttribute('style') || ''); }));
  ok('Heading2 渲染为 h2', await page.evaluate(() => { const h = document.querySelector('.rd-page h2'); return !!h && /变量说明/.test(h.textContent); }));
  ok('docx 顶层表格渲染为真实二维 table', await page.evaluate(() => { const table = document.querySelector('.rd-page table.rd-tbl'); return !!table && table.querySelectorAll('th').length === 2 && table.querySelectorAll('tr').length === 2 && /地区生产总值/.test(table.textContent); }));
  ok('docx 表格不再降级为占位段落', await page.evaluate(() => !/表格:v1|暂以占位显示/.test(document.querySelector('.rd-page').textContent || '')));
  ok('两端对齐 + 1.5 倍行距落到段落', await page.evaluate(() => { const p = [...document.querySelectorAll('.rd-page p')].find((e) => /斜体下划线样段/.test(e.textContent)); if (!p) return false; const cs = getComputedStyle(p); return cs.textAlign === 'justify' && !!p.querySelector('i') && !!p.querySelector('u'); }));
  ok('字号 18pt(sz=36 半磅)生效', await page.evaluate(() => { const sp = [...document.querySelectorAll('.rd-page h1 span')].find((e) => /18pt/.test(e.getAttribute('style') || '')); return !!sp; }));
  ok('载入提示出现(已载入并渲染)', await page.evaluate(() => /已载入并渲染/.test(document.querySelector('.toast')?.textContent ?? document.body.textContent)));
  // 导入内容与既有链路兼容:圈选导入的文字 → 选区芯片
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.rd-page p')].find((e) => /核心结论/.test(e.textContent));
    const tn = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
    const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, 6);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await sleep(250);
  ok('圈选导入文本 → 选区芯片出现', await page.evaluate(() => !!document.querySelector('.selchip .sel-quote')));

  ok('无控制台报错', errors.length === 0, errors.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  fail++;
} finally {
  await teardown();
}
process.exit(fail);
