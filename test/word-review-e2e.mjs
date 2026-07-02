/**
 * Word 行内修订全生命周期(mock /propose-stream):验证 flatten-on-accept 架构 ——
 *  · 悬浮卡 ✓:该条物理定稿(标记消失、文本落地),其余照旧;
 *  · 悬浮卡 ✕:精确回旧文;
 *  · 接受后四态任一视图文字都不消失(旧"orig×accepted 蒸发"回归);
 *  · 刷新中途:标记/审批状态恢复,卡片 ✓/✕ 依旧生效(accepted 持久化 + revert DOM 兜底);
 *  · 第二轮上下文纯净:待定修订的 del 旧文不进 Agent 上下文(清样投影,反污染闭环)。
 */
import { openApp, sleep } from './harness.mjs';

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.apiKey': 'test-key', 'oa.server': 'http://localhost:4319' } });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL', n); } };

const diff = {
  changeSetId: 'csLife', hostId: 'h', intent: '改写 + 加粗',
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
  anchors: { a0: { portable: { kind: 'flow', quote: { text: '整体进度符合预期。' } } }, a1: { portable: { kind: 'flow', quote: { text: '下周计划' } } } },
};
const sse = `data: ${JSON.stringify({ type: 'done', kind: 'changeset', diff, changeSet })}\n\n`;
const bodies = [];

try {
  await page.route('**/propose-stream', (route) => { bodies.push(route.request().postData() || ''); route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse }); });
  await page.waitForSelector('.rd-page');
  await sleep(400);
  await page.locator('.composer textarea').fill('改进度句,标题加粗');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('.reviewbox', { timeout: 8000 });
  await sleep(500);
  ok('两条改动落地(data-cid ×2)', await page.evaluate(() => document.querySelectorAll('.rd-page [data-cid]').length === 2));

  // ① 悬浮卡 ✓ 接受第一条(文本改写)→ 该条物理定稿,另一条照旧
  await page.locator('.rd-page .rd-chg').first().hover();
  await sleep(350);
  await page.locator('.rd-cbtn.ok').click();
  await sleep(400);
  ok('卡片✓ → 该条标记消失、文本落地', await page.evaluate(() => {
    const t = document.querySelector('.rd-page').innerText;
    return document.querySelectorAll('.rd-page [data-cid]').length === 1 && t.includes('整体进度略超预期') && !t.includes('整体进度符合预期');
  }));
  // ② 接受后切"原文":文字不蒸发(旧 bug:ins 被藏 + del 被折叠 → 双双不可见)
  await page.locator('.rd-difftoggle .rd-dt-seg', { hasText: '原文' }).click();
  await sleep(250);
  ok('接受后切"原文"→ 文字仍可见(不蒸发)', await page.evaluate(() => document.querySelector('.rd-page').innerText.includes('整体进度略超预期')));
  await page.locator('.rd-difftoggle .rd-dt-seg', { hasText: '修订' }).click();
  await sleep(200);

  // ③ 第二轮上下文纯净:此刻 e1(加粗)仍待定 → 发第二条消息,请求 context 不得混入任何 del 旧文
  await page.locator('.composer textarea').fill('再看看格式');
  await page.locator('.composer textarea').press('Enter');
  await sleep(800);
  let ctx2 = '';
  try { ctx2 = JSON.parse(bodies[1] ?? '').context || ''; } catch { ctx2 = bodies[1] ?? ''; }
  ok('二轮上下文含改后文本', ctx2.includes('整体进度略超预期'));
  ok('二轮上下文不含已删旧文(清样投影)', !ctx2.includes('整体进度符合预期'));

  // ④ 刷新中途:标记与审批状态从持久层恢复,卡片 ✕ 依旧能精确回退(undoMap 已失 → DOM 兜底)
  await page.reload();
  await page.waitForSelector('.rd-page');
  await sleep(600);
  ok('刷新后待定标记恢复 + 切换条在', await page.evaluate(() => document.querySelectorAll('.rd-page [data-cid]').length >= 1 && !!document.querySelector('.rd-difftoggle')));
  const boldBefore = await page.evaluate(() => { const el = document.querySelector('.rd-page .rd-fmt'); return el ? /bold|700/.test(el.getAttribute('style') || '') : false; });
  ok('刷新后加粗标记仍带样式', boldBefore);
  await page.locator('.rd-page .rd-fmt').hover();
  await sleep(350);
  ok('刷新后悬浮卡照常打开', await page.evaluate(() => !!document.querySelector('.rd-cardwrap')));
  await page.locator('.rd-cbtn.no').click();
  await sleep(400);
  ok('刷新后卡片✕ → 格式改动解包放弃(标记清零,文本保留)', await page.evaluate(() => {
    const t = document.querySelector('.rd-page').innerText;
    return document.querySelectorAll('.rd-page [data-cid]').length === 0 && t.includes('下周计划');
  }));

  ok('无控制台报错', errors.length === 0, errors.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  fail++;
} finally {
  await teardown();
}
process.exit(fail);
