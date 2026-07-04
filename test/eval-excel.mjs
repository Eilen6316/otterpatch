/**
 * Live Excel agent evaluation (real DeepSeek via local serve) — three angles:
 *  1) consulting question → expect an answer bubble, zero grid changes
 *  2) totals row → expect a formula-backed proposal landing in the grid
 *  3) chart request → expect an inline chart image floating over the grid
 * Screenshots after each stage for visual verification.
 */
import { openApp, sleep } from './harness.mjs';
const KEY = process.env.OA_EVAL_KEY ?? '';
if (!KEY) { console.error('缺少 OA_EVAL_KEY 环境变量(DeepSeek API key),live eval 需要真实模型'); process.exit(2); }

const SHOT = process.env.SHOT_DIR || '.';
const { page, errors, teardown } = await openApp({
  storage: {
    'oa.fmt': 'excel',
    'oa.server': 'http://localhost:4319',
    'oa.provider': 'deepseek',
    'oa.model': 'deepseek-v4-pro',
    'oa.apiKey': KEY,
  },
});

async function awaitTurn(timeoutMs = 300000) {
  await sleep(1500);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const done = await page.evaluate(() => {
      const send = document.querySelector('.composer .send');
      return !!send && !send.disabled;
    });
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
async function shot(name) { await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false }); console.log('shot:', name); }
async function acceptAllIfAny() {
  const btn = page.locator('.reviewbox .btn.solid').last();
  if (await btn.count()) { try { await btn.click(); await sleep(1200); } catch {} }
}
async function newConvo() { try { await page.locator('.convo-new').click(); await sleep(600); } catch {} }

try {
  await page.waitForSelector('.univer-host canvas', { timeout: 30000 });
  await sleep(3000);
  await shot('e0-baseline');

  console.log('E1 consulting…', await ask('这张表有什么数据质量问题?简要列出,不要改表'));
  await shot('e1-consult');
  await newConvo();

  console.log('E2 totals…', await ask('在销量列的数据下方加一行合计,必须用公式'));
  await shot('e2-sum-proposed');
  await acceptAllIfAny();
  await shot('e2-sum-accepted');
  await newConvo();

  console.log('E3 chart…', await ask('按产品汇总销量,画一张柱状图'));
  await shot('e3-chart-proposed');
  await acceptAllIfAny();
  await shot('e3-chart-accepted');

  console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  await shot('e-error');
} finally {
  await teardown();
}
