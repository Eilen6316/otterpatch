/**
 * Word × Agent 闭环(mock /propose-stream):验证
 *  · Agent 的 replaceText/setStyle 改动真的落进 Word 工作区(含"宽松定位":quote 带空白仍命中);
 *  · 审阅区出现 diff 卡片;点"全部接受"后写入并显示"已采纳"。
 * 不依赖真实大模型/Key(route 拦截,返回固定 SSE)。
 */
import { openApp, sleep } from './harness.mjs';

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.apiKey': 'test-key', 'oa.server': 'http://localhost:4319' } });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL', n); } };

const diff = {
  changeSetId: 'csMock', hostId: 'h', intent: '演示:改写一句 + 标题加粗',
  items: [
    { editId: 'e0', ref: '正文', badge: 'modify', label: '改写进度句', after: '整体进度略超预期。' },
    { editId: 'e1', ref: '标题', badge: 'modify', label: '标题加粗', after: '加粗', style: { bold: true } },
  ],
};
const changeSet = {
  edits: [
    { id: 'e0', target: 'a0', op: { family: 'text', kind: 'replaceText', text: '整体进度略超预期。' } },
    { id: 'e1', target: 'a1', op: { family: 'style', kind: 'setStyle', style: { bold: true } } },
  ],
  anchors: {
    a0: { portable: { kind: 'flow', quote: { text: '  整体进度符合预期。' } } }, // 前导空格 → 只有宽松定位能命中(验证 #3 修复)
    a1: { portable: { kind: 'flow', quote: { text: '下周计划' } } },
  },
};
const sse = `data: ${JSON.stringify({ type: 'reasoning', delta: '分析文档…' })}\n\n` + `data: ${JSON.stringify({ type: 'done', kind: 'changeset', diff, changeSet })}\n\n`;

let reqBody = '';
try {
  await page.route('**/propose-stream', (route) => { reqBody = route.request().postData() || ''; route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse }); });
  await page.waitForSelector('.rd-ribbon');
  await page.waitForSelector('.rd-page');
  await sleep(400);

  // 选中标题里的文字(验证 #2:选区被感知并喂给 Agent)
  await page.evaluate(() => {
    const h = document.querySelector('.rd-page h1'); const tn = h.firstChild;
    const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, 4);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await sleep(200);
  ok('选区上抛 → 输入区"已选"芯片', await page.evaluate(() => !!document.querySelector('.selchip .sel-quote')));

  await page.locator('.composer textarea').fill('把进度句改一下,标题加粗');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('.reviewbox', { timeout: 8000 });
  await sleep(500);

  ok('审阅区出现 diff 卡片', await page.evaluate(() => !!document.querySelector('.reviewbox')));
  ok('replaceText 已落入文档(宽松定位命中带空白的 quote)', await page.evaluate(() => document.querySelector('.rd-page').innerText.includes('整体进度略超预期')));
  ok('两条改动都打了 data-edit 标记', await page.evaluate(() => document.querySelectorAll('.rd-page [data-edit]').length >= 2));
  ok('setStyle 加粗已落到"下周计划"', await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.rd-page [data-edit]')];
    return spans.some((s) => /下周计划/.test(s.textContent) && /bold|700/.test(s.getAttribute('style') || ''));
  }));
  ok('diff 展示了 新文本', await page.evaluate(() => (document.querySelector('.reviewbox')?.textContent || '').includes('整体进度略超预期')));
  // git 风格统一 diff 始终可见(无需展开),含红减/绿加行
  ok('git-diff 始终可见(.rv-gitdiff)', await page.evaluate(() => !!document.querySelector('.rv-gitdiff')));
  ok('git-diff 有红减行 - 旧文本', await page.evaluate(() => [...document.querySelectorAll('.gd-line.del')].some((e) => /整体进度符合预期/.test(e.textContent))));
  ok('git-diff 有绿加行 + 新文本', await page.evaluate(() => [...document.querySelectorAll('.gd-line.add')].some((e) => /整体进度略超预期/.test(e.textContent))));
  ok('git-diff 有格式改动行(~)', await page.evaluate(() => !!document.querySelector('.gd-line.fmt')));
  await page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/word-gitdiff.png` });

  // 全部接受
  await page.locator('.reviewbox .btn.solid').click();
  await sleep(400);
  ok('全部接受 → 显示"已采纳"', await page.evaluate(() => /已采纳/.test(document.querySelector('.reviewbox')?.textContent || '')));

  // 请求体里的 context 应含【格式细节】(#1)与【选区】(#2)
  let ctx = '';
  try { ctx = JSON.parse(reqBody).context || ''; } catch { ctx = reqBody; }
  ok('#1 上下文含逐段格式(字体/字号/样式)', /格式概览/.test(ctx) && /字体/.test(ctx) && /(正文|标题)/.test(ctx));
  ok('#2 上下文含当前选区', /当前选区|圈选/.test(ctx) && /项目周报/.test(ctx));

  ok('无控制台报错', errors.length === 0, errors.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  fail++;
} finally {
  await teardown();
}
process.exit(fail);
