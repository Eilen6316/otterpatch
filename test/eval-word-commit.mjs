/**
 * Live Word 写回闭环 eval(hero loop,真实模型 + 真实 docx):
 *  内存现造 .docx(含空段/残留段/正文)→ 真实上传 → agent 提案(删段+改写)→ 全部接受
 *  → doCommit 外科写回 → 捕获下载的 .otterpatch.docx → 解包断言 document.xml:
 *    · 残留段成为删除修订(w:del/w:delText + 段落符 w:del)
 *    · 空段落带段落符删除标记
 *    · 改写成为 w:ins/w:del 词级红线
 *    · 未触碰段落原样
 * 需要本地 serve (http://localhost:4319) + OA_EVAL_KEY。
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { acceptNextConfirm, openApp, sleep, createReporter } from './harness.mjs';
const KEY = process.env.OA_EVAL_KEY ?? '';
if (!KEY) { console.error('缺少 OA_EVAL_KEY 环境变量(DeepSeek API key),live eval 需要真实模型'); process.exit(2); }

const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>产品验收报告</w:t></w:r></w:p>
<w:p><w:r><w:t>本报告总结了第一阶段的验收情况。</w:t></w:r></w:p>
<w:p/>
<w:p/>
<w:p><w:r><w:t>阿斯顿撒 deSSD 测试残留文字</w:t></w:r></w:p>
<w:p><w:r><w:t>结论:三个模块均达到验收标准。</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
</w:body></w:document>`;
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const docxBytes = zipSync({ '[Content_Types].xml': strToU8(CONTENT_TYPES), '_rels/.rels': strToU8(RELS), 'word/document.xml': strToU8(DOC_XML) });

const { page, errors, teardown } = await openApp({
  storage: { 'oa.fmt': 'word', 'oa.server': 'http://localhost:4319', 'oa.provider': 'deepseek', 'oa.model': 'deepseek-v4-pro', 'oa.apiKey': KEY },
});
const r = createReporter();

async function awaitTurn(timeoutMs = 300000) {
  await sleep(1500);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const done = await page.evaluate(() => { const s = document.querySelector('.composer .send'); return !!s && !s.disabled; });
    if (done) return true;
    await sleep(2000);
  }
  return false;
}

try {
  await page.waitForSelector('.rd-page');
  await sleep(500);
  await page.setInputFiles('input[data-role="attach"]', { name: '验收报告.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(docxBytes) });
  await sleep(800);
  r.ok('docx 已导入渲染', await page.evaluate(() => /产品验收报告/.test(document.querySelector('.rd-page')?.textContent ?? '')));

  const lastDiffOps = () => page.evaluate(() => {
    try {
      const th = JSON.parse(localStorage.getItem('oa.thread') ?? '[]');
      for (let i = th.length - 1; i >= 0; i--) if (th[i]?.kind === 'diff' && th[i].word?.length) return JSON.stringify({ items: th[i].diff.items.map((x) => ({ ref: x.ref, kind: x.kind, label: x.label })), word: th[i].word });
    } catch (e) { return String(e); }
    return '';
  });
  await page.locator('.composer textarea').fill('三件事:1) 删掉第3段和第4段这两个空段落;2) 删掉第5段"阿斯顿撒 deSSD 测试残留文字"整段;3) 把"本报告总结了第一阶段的验收情况。"改为"本报告总结了第一阶段的验收情况与遗留问题。"。共 4 条改动,一条都别漏,直接提出改动不用确认。');
  await page.locator('.composer textarea').press('Enter');
  r.ok('提案回合完成', await awaitTurn());
  await sleep(800);
  if (!(await lastDiffOps())) { // 模型偶发走 answer/clarify:追一句直接执行(容忍一次)
    await page.locator('.composer textarea').fill('直接执行上面 4 条改动,提出 changeset,不要再确认');
    await page.locator('.composer textarea').press('Enter');
    await awaitTurn();
    await sleep(800);
  }
  const opsJson = (await lastDiffOps()) || '(none)';
  console.log('提案 ops:', opsJson);
  const delCount = (opsJson.match(/"kind":"deleteRange"/g) ?? []).length;

  // 全部接受 → doCommit → 捕获下载
  const dlPromise = page.waitForEvent('download', { timeout: 60000 });
  dlPromise.catch(() => {}); // teardown 竞态时别让未处理拒绝炸掉进程
  acceptNextConfirm(page);
  await page.locator('.reviewbox .btn.solid').last().click();
  const dl = await dlPromise;
  const name = dl.suggestedFilename();
  r.ok('下载文件名带 .otterpatch.docx', /\.otterpatch\.docx$/.test(name), name);
  const path = await dl.path();
  const { readFileSync } = await import('node:fs');
  const outParts = unzipSync(new Uint8Array(readFileSync(path)));
  const outXml = strFromU8(outParts['word/document.xml']);

  r.ok('残留段成为删除修订(w:delText)', /<w:delText[^>]*>阿斯顿撒/.test(outXml));
  r.ok('删除段带段落符删除标记(pPr 内 w:del)', /<w:pPr>(?:(?!<\/w:p>)[\s\S])*?<w:rPr><w:del [^>]*\/><\/w:rPr>/.test(outXml));
  // 动态口径:提案里 N 条删段 → 落盘必须正好 N 处段落符删除(每条都落、一条不多)
  const markN = (outXml.match(/<w:rPr><w:del /g) ?? []).length;
  r.ok(`删段全部落盘(提案 ${delCount} 条 = 段落符删除 ${markN} 处)`, delCount > 0 && markN === delCount);
  r.ok('改写成为 w:ins 插入修订', /<w:ins[^>]*>[\s\S]*?与遗留问题/.test(outXml));
  r.ok('未触碰段落原样保留', outXml.includes('<w:p><w:r><w:t>结论:三个模块均达到验收标准。</w:t></w:r></w:p>'));
  r.ok('标题段原样保留', outXml.includes('<w:r><w:t>产品验收报告</w:t></w:r>'));
  r.ok('其余部件字节透传([Content_Types] 不变)', strFromU8(outParts['[Content_Types].xml']) === CONTENT_TYPES);

  console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/wc-error.png' }).catch(() => {});
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
