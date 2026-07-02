/**
 * 自动续批(mock):plan 声明分批 + 开关开启(oa.autobatch=1)→ 全部接受后【自动】续发"下一批",
 * 不需要人工点击;审阅操作行出现 ⚡自动续批 开关。串行续批:每批都是独立 propose→审阅回合。
 */
import { openApp, sleep } from './harness.mjs';

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.apiKey': 'test-key', 'oa.server': 'http://localhost:4319', 'oa.autobatch': '1' } });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL', n); } };

const mk = (csId, quote, repl, intent) => ({
  diff: { changeSetId: csId, hostId: 'h', intent, items: [{ editId: 'e0', ref: '正文', badge: 'modify', label: '改写', after: repl }] },
  changeSet: { edits: [{ id: 'e0', target: 'a0', op: { family: 'text', kind: 'replaceText', text: repl } }], anchors: { a0: { portable: { kind: 'flow', quote: { text: quote } } } } },
});
const R1 = mk('csB1', '整体进度符合预期。', '整体进度略超预期。', '先做第一批:改写进度句(其余下一批继续)');
const R2 = mk('csB2', '下周计划', '下周安排', '第二批完成,全部改完');
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
  await page.locator('.composer textarea').fill('把整篇报告润色一遍');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('.reviewbox', { timeout: 8000 });
  await sleep(500);

  ok('审阅操作行出现 ⚡自动续批 开关且已勾选', await page.evaluate(() => { const c = document.querySelector('.rv-auto input'); return !!c && c.checked; }));
  // 全部接受 → 不点任何续发按钮,等待自动续批
  await page.locator('.reviewbox .btn.solid').first().click();
  await sleep(2200);
  ok('接受后【自动】续发了"下一批"(无人工点击)', (() => { try { return JSON.parse(bodies[1] ?? '{}').intent === '下一批'; } catch { return false; } })());
  ok('第二批提案已到达(第二个审阅回合)', await page.evaluate(() => document.querySelectorAll('.reviewbox').length >= 2));
  // 第二批 plan 不再含分批意图 → 接受后不再自动续发
  const n = bodies.length;
  await page.locator('.reviewbox .btn.solid').last().click();
  await sleep(2200);
  ok('第二批 plan 无分批意图 → 接受后停止续发', bodies.length === n);

  ok('无控制台报错', errors.length === 0, errors.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  fail++;
} finally {
  await teardown();
}
process.exit(fail);
