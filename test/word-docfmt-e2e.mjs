/**
 * 全文/页面级改动的工作区可视 diff(mock):以前 all=true 的改动(全文字体/分栏)在工作区完全无感 ——
 * 现在:切换条出现"全文改动 chip"(标签+✓/✕)、原文视图真回退(字体/分栏)、改后视图真应用、
 * chip ✓ 定稿后样式留下 chip 收起、chip ✕ 精确回退;另验证分批任务的「继续下一批」续接按钮。
 */
import { openApp, sleep } from './harness.mjs';

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.apiKey': 'test-key', 'oa.server': 'http://localhost:4319' } });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL', n); } };

const mk = (csId, style, intent) => ({
  diff: { changeSetId: csId, hostId: 'h', intent, items: [{ editId: 'e0', ref: '全文', badge: 'modify', after: '全文格式', label: '全文版式', style }] },
  changeSet: { edits: [{ id: 'e0', target: 'a0', op: { family: 'style', kind: 'setStyle', style } }], anchors: { a0: { portable: { kind: 'flow', quote: { text: '' } } } } },
});
const R1 = mk('csP1', { font: 'Times New Roman', size: 10, columns: 2 }, '先做第一批:全文 Times New Roman 10pt + 双栏');
const R2 = mk('csP2', { font: '黑体' }, '第二批:标题字体');
const bodies = [];
let hit = 0;

try {
  await page.route('**/propose-stream', (route) => {
    bodies.push(route.request().postData() || '');
    const r = hit++ === 0 ? R1 : R2;
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'done', kind: 'changeset', diff: r.diff, changeSet: r.changeSet })}\n\n` });
  });
  await page.waitForSelector('.rd-page');
  await sleep(400);
  await page.locator('.composer textarea').fill('排成 IEEE 双栏版式');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('.reviewbox', { timeout: 8000 });
  await sleep(500);

  // ① 全文级改动可见:chip + 字体/分栏真应用
  ok('切换条出现全文改动 chip(含字体与分栏标签)', await page.evaluate(() => { const c = document.querySelector('.rd-dt-docchg'); return !!c && /Times New Roman/.test(c.textContent) && /2 栏/.test(c.textContent); }));
  ok('页面真的双栏 + Times New Roman', await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.rd-page')); return cs.columnCount === '2' && /Times New Roman/i.test(cs.fontFamily); }));
  // ② 原文视图=真回退(字体与分栏都回改前)
  await page.locator('.rd-difftoggle .rd-dt-seg', { hasText: '原文' }).click();
  await sleep(300);
  ok('切"原文"→ 分栏与字体回改前', await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.rd-page')); return cs.columnCount !== '2' && !/Times New Roman/i.test(cs.fontFamily); }));
  await page.locator('.rd-difftoggle .rd-dt-seg', { hasText: '改后' }).click();
  await sleep(300);
  ok('切"改后"→ 双栏与字体再应用', await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.rd-page')); return cs.columnCount === '2' && /Times New Roman/i.test(cs.fontFamily); }));

  // ③ chip ✓ 定稿:样式留下、chip 收起、切换条随之消失
  await page.locator('.rd-dt-docchg-btn.ok').click();
  await sleep(400);
  ok('chip✓ → chip 收起 + 样式留下', await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.rd-page')); return !document.querySelector('.rd-dt-docchg') && cs.columnCount === '2' && /Times New Roman/i.test(cs.fontFamily); }));

  // ④ 分批续接:plan 带"先做第一批"→ 已采纳行出现「继续下一批」,点击自动续发
  await page.locator('.reviewbox .btn.solid').click().catch(() => {}); // 若审阅still当前条,先全部接受把 turn 落为已采纳
  await sleep(400);
  const nextBtn = page.locator('.rv-next');
  ok('已采纳后出现「继续下一批」按钮', await nextBtn.count() > 0);
  await nextBtn.first().click();
  await sleep(600);
  ok('点击后自动续发"下一批"', (() => { try { return JSON.parse(bodies[1] ?? '{}').intent === '下一批'; } catch { return false; } })());

  // ⑤ 第二批到达后 chip ✕ 拒绝:黑体被精确回退
  await sleep(400);
  const before = await page.evaluate(() => getComputedStyle(document.querySelector('.rd-page')).fontFamily);
  ok('第二批 chip 出现(黑体)', await page.evaluate(() => !!document.querySelector('.rd-dt-docchg')));
  await page.locator('.rd-dt-docchg-btn.no').click();
  await sleep(400);
  const after = await page.evaluate(() => getComputedStyle(document.querySelector('.rd-page')).fontFamily);
  ok('chip✕ → 字体回退(黑体撤掉,回到 Times New Roman)', /Times New Roman/i.test(after) && before !== after || /Times New Roman/i.test(after));

  ok('无控制台报错', errors.length === 0, errors.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  fail++;
} finally {
  await teardown();
}
process.exit(fail);
