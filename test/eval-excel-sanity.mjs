/**
 * Live Excel eval — 数据合理性自检(真实模型):
 *  让 agent 往销售表续写 mock 数据并规范毛利率格式,断言(读提案 ops,不依赖 canvas):
 *   1) 值×格式耦合:配了百分比格式的格,写入值必须是小数(≤2),不得出现 120 → 12000% 口径事故
 *   2) mock 真实感:同列不得全同值
 *   3) 派生列(金额)优先公式
 * 需要本地 serve (http://localhost:4319) + OA_EVAL_KEY。
 */
import { openApp, sleep, createReporter } from './harness.mjs';
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

try {
  await page.waitForSelector('.univer-host canvas', { timeout: 30000 });
  await sleep(3000);

  const ok = await ask('在数据下方续写 5 行 2 月的 mock 销售数据(口径与上面一致),并把毛利率列规范成百分比格式');
  r.ok('回合完成(未超时)', ok);
  await page.screenshot({ path: `${SHOT}/es1-proposed.png` });

  // 读最后一条 diff 回合的 ops(提案结构化断言,canvas 之外的真相源)
  const ops = await page.evaluate(() => {
    try {
      const th = JSON.parse(localStorage.getItem('oa.thread') ?? '[]');
      for (let i = th.length - 1; i >= 0; i--) if (th[i]?.kind === 'diff' && th[i].ops?.length) return th[i].ops;
    } catch {}
    return [];
  });
  r.ok('提案里有网格改动', ops.length > 0, `ops=${ops.length}`);

  // 1) 值×格式耦合:任何 numFmt 含 % 的 op,同格(本条或同 a1 其它条)写入的数值必须 ≤ 2
  const pctCells = new Set(ops.filter((o) => /%/.test(o.numFmt ?? '')).map((o) => o.a1));
  const badPct = ops.filter((o) => {
    if (o.value == null) return false;
    const n = typeof o.value === 'number' ? o.value : parseFloat(String(o.value));
    return Number.isFinite(n) && n > 2 && (pctCells.has(o.a1) || /^F/i.test(o.a1)); // F 列=毛利率
  });
  r.ok('百分比格无口径事故(值≤2,不会显示成 12000%)', badPct.length === 0, badPct.map((o) => `${o.a1}=${o.value}`).join(' '));

  // 2) mock 真实感:销量列(C)新写的值不得全同
  const cVals = ops.filter((o) => /^C\d+$/i.test(o.a1) && o.value != null).map((o) => String(o.value));
  r.ok('mock 销量有波动(非全同值)', cVals.length < 2 || new Set(cVals).size > 1, `C 列写入 ${cVals.join(',')}`);

  // 3) 金额列(E)优先公式
  const eOps = ops.filter((o) => /^E\d+$/i.test(o.a1) && o.value != null);
  const eFormula = eOps.filter((o) => String(o.value).trim().startsWith('='));
  r.ok('金额列用公式(销量×单价)', eOps.length === 0 || eFormula.length >= Math.ceil(eOps.length / 2), `${eFormula.length}/${eOps.length} 为公式`);

  console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  await page.screenshot({ path: `${SHOT}/es-error.png` });
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
