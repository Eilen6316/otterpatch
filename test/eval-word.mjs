/**
 * Live Word agent evaluation (real DeepSeek via local serve) — three angles:
 *  1) targeted rewrite → expect inline tracked-change marks
 *  2) whole-document format (all=true) → expect doc-level chip + true preview
 *  3) vague request → expect a clarify card, no document changes
 * Screenshots after each stage for visual verification.
 */
import { openApp, sleep } from './harness.mjs';
const KEY = process.env.OA_EVAL_KEY ?? '';
if (!KEY) { console.error('缺少 OA_EVAL_KEY 环境变量(DeepSeek API key),live eval 需要真实模型'); process.exit(2); }

const SHOT = process.env.SHOT_DIR || '.';
const { page, errors, teardown } = await openApp({
  storage: {
    'oa.fmt': 'word',
    'oa.server': 'http://localhost:4319',
    'oa.provider': 'deepseek',
    'oa.model': 'deepseek-v4-pro',
    'oa.apiKey': KEY,
  },
});

async function awaitTurn(timeoutMs = 300000) {
  await sleep(1500); // let busy latch on
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
  await page.waitForSelector('.rd-page');
  await sleep(500);
  await shot('w0-baseline');

  console.log('W1 targeted rewrite…', await ask('把"整体进度符合预期。"这句话改得更自信有力'));
  await shot('w1-rewrite-proposed');
  await acceptAllIfAny();
  await shot('w1-rewrite-accepted');
  await newConvo();

  console.log('W2 all-doc format…', await ask('全文统一为宋体小四、1.5 倍行距'));
  await shot('w2-alldoc-proposed');
  await acceptAllIfAny();
  await shot('w2-alldoc-accepted');
  await newConvo();

  console.log('W3 vague request…', await ask('帮我弄一下这个文档'));
  await shot('w3-vague');

  console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  await shot('w-error');
} finally {
  await teardown();
}
