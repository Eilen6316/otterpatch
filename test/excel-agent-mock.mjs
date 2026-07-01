/**
 * Excel × Agent 闭环(mock /propose-stream):验证同一套 git 风格统一 diff 在【Excel】也生效——
 * setValue(C2 120→200)出红减/绿加行、setStyle(标红)出格式 ~ 行,改动乐观落进网格。
 * 不依赖真实大模型/Key(route 拦截固定 SSE)。
 */
import { openApp, sleep } from './harness.mjs';

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'excel', 'oa.apiKey': 'test-key', 'oa.server': 'http://localhost:4319' } });
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL', n); } };

const diff = {
  changeSetId: 'csX', hostId: 'h', intent: '把 A 型销量 120 改为 200 并标红',
  items: [
    { editId: 'e0', ref: 'Sheet1!C2', badge: 'modify', after: '200', label: '改销量' },
    { editId: 'e1', ref: 'Sheet1!C2', badge: 'modify', after: '标红', label: '标红异常值', style: { bgColor: '#ffd6d6' } },
  ],
};
const changeSet = {
  edits: [
    { id: 'e0', target: 'a0', op: { family: 'value', kind: 'setValue', value: 200 } },
    { id: 'e1', target: 'a1', op: { family: 'style', kind: 'setStyle', style: { bgColor: '#ffd6d6' } } },
  ],
  anchors: { a0: { portable: { kind: 'grid', ref: 'Sheet1!C2' } }, a1: { portable: { kind: 'grid', ref: 'Sheet1!C2' } } },
};
const sse = `data: ${JSON.stringify({ type: 'reasoning', delta: '定位异常…' })}\n\n` + `data: ${JSON.stringify({ type: 'done', kind: 'changeset', diff, changeSet })}\n\n`;

try {
  await page.route('**/propose-stream', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse }));
  await page.waitForSelector('.univer-host canvas', { timeout: 20000 });
  await sleep(2500);

  await page.locator('.composer textarea').fill('把 A 型销量改成 200 并标红');
  await page.locator('.composer .send').click();
  await page.waitForSelector('.reviewbox', { timeout: 8000 });
  await sleep(600);

  ok('审阅区出现 git-diff(.rv-gitdiff)', await page.evaluate(() => !!document.querySelector('.rv-gitdiff')));
  ok('红减行 - 旧值 120(从网格取的 before)', await page.evaluate(() => [...document.querySelectorAll('.gd-line.del')].some((e) => /\b120\b/.test(e.textContent))));
  ok('绿加行 + 新值 200', await page.evaluate(() => [...document.querySelectorAll('.gd-line.add')].some((e) => /\b200\b/.test(e.textContent))));
  ok('格式改动行(~ 标红)', await page.evaluate(() => [...document.querySelectorAll('.gd-line.fmt')].some((e) => /标红/.test(e.textContent))));
  ok('hunk 头含单元格引用 C2', await page.evaluate(() => [...document.querySelectorAll('.gd-ref')].some((e) => /C2/.test(e.textContent))));

  await page.locator('.reviewbox .btn.solid').click();
  await sleep(400);
  ok('全部接受 → 显示"已采纳"', await page.evaluate(() => /已采纳/.test(document.querySelector('.reviewbox')?.textContent || '')));

  ok('无控制台报错', errors.length === 0, errors.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  fail++;
} finally {
  await teardown();
}
process.exit(fail);
