/**
 * Live Word eval — 感知层修复验证(真实模型):
 *  文档带「分散对齐事故」(text-align-last:justify 拉稀字距)且正文未显式设字号(页面基线渲染 ≈11.3pt)。
 *  期待:① agent 上下文里看得见"分散对齐"并主动修(提案含 align);② 接受后 text-align-last 不再是 justify;
 *       ③ 不再产出"修正 11.3pt 怪字号"式幻影改动(字号改动若有,理由应是统一基线——这里只硬断言①②)。
 * 需要本地 serve (http://localhost:4319) + OA_EVAL_KEY。
 */
import { openApp, sleep, createReporter } from './harness.mjs';
const KEY = process.env.OA_EVAL_KEY ?? '';
if (!KEY) { console.error('缺少 OA_EVAL_KEY 环境变量(DeepSeek API key),live eval 需要真实模型'); process.exit(2); }

const DOC = [
  '<h1>项目周报 · 2026 年第 26 周</h1>',
  '<p style="text-align:justify;text-align-last:justify">用顶部工具栏手动排版,或让右侧 Agent 帮你改写选择表。整体进度符合预期,工具栏的字体、字号、加粗、对齐、列表都真生效。</p>',
  '<h2>下周计划</h2>',
  '<p style="text-align:justify;text-align-last:justify">一、让 Agent 既能改写文字、也能改字体字号等格式;二、补齐行为回归测试;三、用真实模型校准澄清的边界。</p>',
  '<p style="text-align:justify;text-align-last:justify">备注:本文档为演示数据,你可以圈选任意文字。</p>',
].join('');

const { page, errors, teardown } = await openApp({
  storage: { 'oa.fmt': 'word', 'oa.richdoc': DOC, 'oa.server': 'http://localhost:4319', 'oa.provider': 'deepseek', 'oa.model': 'deepseek-v4-pro', 'oa.apiKey': KEY },
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
  await sleep(600);
  const stretched0 = await page.evaluate(() => [...document.querySelectorAll('.rd-page p')].filter((p) => getComputedStyle(p).textAlignLast === 'justify').length);
  r.ok('基线:3 段处于分散对齐事故态', stretched0 === 3, `实际 ${stretched0}`);

  await page.locator('.composer textarea').fill('优化一下这篇文档的格式');
  await page.locator('.composer textarea').press('Enter');
  r.ok('回合完成(未超时)', await awaitTurn());
  await sleep(1000);

  const plan = await page.evaluate(() => {
    try {
      const th = JSON.parse(localStorage.getItem('oa.thread') ?? '[]');
      for (let i = th.length - 1; i >= 0; i--) if (th[i]?.kind === 'diff') return JSON.stringify({ intent: th[i].diff.intent, items: th[i].diff.items.map((x) => x.label), word: th[i].word?.map((w) => w.style) });
    } catch {}
    return '';
  });
  console.log('提案:', plan.slice(0, 500));
  r.ok('提案感知到对齐问题(plan/items/style 提及对齐)', /对齐|align/.test(plan));

  const btn = page.locator('.reviewbox .btn.solid').last();
  if (await btn.count()) { await btn.click().catch(() => {}); await sleep(1500); }
  const stretched1 = await page.evaluate(() => [...document.querySelectorAll('.rd-page p')].filter((p) => getComputedStyle(p).textAlignLast === 'justify').length);
  r.ok('接受后分散对齐事故清零(末行不再撑满)', stretched1 === 0, `残留 ${stretched1}`);
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/wa1-fixed.png' });

  console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/wa-error.png' }).catch(() => {});
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
