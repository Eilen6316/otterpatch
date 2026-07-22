/**
 * Live Word eval — 新能力验证(真实模型):
 *  1) 空段落清理 → 期待 deletePara+para 锚定,DOM 出现 .rd-chg-blkdel,接受后段落物理消失
 *  2) 图片感知 → 上下文含 [图片],问"文档里有没有图片"应答得出来
 * 需要本地 serve (http://localhost:4319)。
 */
import { acceptNextConfirm, openApp, sleep, createReporter } from './harness.mjs';
const KEY = process.env.OA_EVAL_KEY ?? '';
if (!KEY) { console.error('缺少 OA_EVAL_KEY 环境变量(DeepSeek API key),live eval 需要真实模型'); process.exit(2); }

const SHOT = process.env.SHOT_DIR || '.';
const DOC = [
  '<h1>产品验收报告</h1>',
  '<p>本报告总结了第一阶段的验收情况。</p>',
  '<p></p>',
  '<p></p>',
  '<p>验收范围包括表格、文档与画板三个模块。<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR4nGP8z8Dwn4EIwESMolGF9FEIAJ9kAgYPWLf1AAAAAElFTkSuQmCC" alt="验收流程图" width="120" height="90"></p>',
  '<p>阿斯顿撒 deSSD 测试残留文字</p>',
  '<p>结论:三个模块均达到验收标准。</p>',
].join('');

const { page, errors, teardown } = await openApp({
  storage: {
    'oa.fmt': 'word',
    'oa.richdoc': DOC,
    'oa.server': 'http://localhost:4319',
    'oa.provider': 'deepseek',
    'oa.model': 'deepseek-v4-pro',
    'oa.apiKey': KEY,
  },
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
async function ask(text) {
  await page.locator('.composer textarea').fill(text);
  await page.locator('.composer textarea').press('Enter');
  const ok = await awaitTurn();
  await sleep(1200);
  return ok;
}
async function shot(name) { await page.screenshot({ path: `${SHOT}/${name}.png` }); console.log('shot:', name); }

try {
  await page.waitForSelector('.rd-page');
  await sleep(600);

  // ── 1) 空段清理 + 删冗余段(deletePara / para 锚定) ──
  const okTurn = await ask('清理文档:删掉所有空段落,并删除"阿斯顿撒 deSSD 测试残留文字"这个无意义的段落');
  r.ok('回合完成(未超时)', okTurn);
  await shot('ws1-proposed');
  const marks = await page.evaluate(() => document.querySelectorAll('.rd-chg-blkdel').length);
  r.ok('出现整段删除修订标记(.rd-chg-blkdel ≥ 2,含空段)', marks >= 2, `实际 ${marks}`);
  // 全部接受
  const btn = page.locator('.reviewbox .btn.solid').last();
  if (await btn.count()) { acceptNextConfirm(page); await btn.click(); await sleep(1500); }
  const after = await page.evaluate(() => ({
    blkdel: document.querySelectorAll('.rd-chg-blkdel').length,
    emptyP: Array.from(document.querySelectorAll('.rd-page > p')).filter((p) => !p.textContent.trim() && !p.querySelector('img')).length,
    junk: (document.querySelector('.rd-page')?.innerText ?? '').includes('阿斯顿撒'),
    img: !!document.querySelector('.rd-page img'),
  }));
  r.ok('接受后删段标记清零(物理移除)', after.blkdel === 0, `残留 ${after.blkdel}`);
  r.ok('空段落已清理', after.emptyP === 0, `残留空段 ${after.emptyP}`);
  r.ok('垃圾段已删除', !after.junk);
  r.ok('图片未被误删', after.img);
  await shot('ws1-accepted');

  // ── 2) 图片感知(上下文 [图片] 标注) ──
  await page.locator('.convo-new').click().catch(() => {});
  await sleep(600);
  const ok2 = await ask('文档里有没有图片?在第几段?');
  r.ok('图片问答回合完成', ok2);
  const said = await page.evaluate(() => { const els = document.querySelectorAll('.chat-thread .bubble, .chat-thread [class*="answer"], .chat-thread'); return els.length ? (els[els.length - 1].textContent ?? '') : document.body.innerText; });
  r.ok('Agent 感知到图片(回答提到图片/流程图)', /图片|流程图/.test(said), said.slice(0, 120));
  await shot('ws2-image-aware');

  // ── 3) 图片操作:缩放(img=resize) ──
  await page.locator('.convo-new').click().catch(() => {});
  await sleep(600);
  const ok3 = await ask('文档里那张验收流程图太大了,缩小到 60 像素宽');
  r.ok('图片缩放回合完成', ok3);
  let btn2 = page.locator('.reviewbox .btn.solid').last();
  if (await btn2.count()) { acceptNextConfirm(page); await btn2.click().catch(() => {}); await sleep(1200); }
  const w = await page.evaluate(() => { const im = document.querySelector('.rd-page img'); return im ? im.style.width : null; });
  r.ok('图片已缩放到 60px', w === '60px', `实际 ${w}`);
  await shot('ws3-img-resized');

  // ── 4) 图片操作:删除(img=remove,段内文字保留) ──
  await page.locator('.convo-new').click().catch(() => {});
  await sleep(600);
  const ok4 = await ask('把这张图删掉');
  r.ok('图片删除回合完成', ok4);
  btn2 = page.locator('.reviewbox .btn.solid').last();
  if (await btn2.count()) { acceptNextConfirm(page); await btn2.click().catch(() => {}); await sleep(1200); }
  const after4 = await page.evaluate(() => ({
    imgs: document.querySelectorAll('.rd-page img').length,
    text: (document.querySelector('.rd-page')?.innerText ?? '').includes('验收范围包括表格'),
  }));
  r.ok('图片已删除', after4.imgs === 0, `残留 ${after4.imgs}`);
  r.ok('段内文字保留', after4.text);
  await shot('ws4-img-removed');

  console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  await shot('ws-error');
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
