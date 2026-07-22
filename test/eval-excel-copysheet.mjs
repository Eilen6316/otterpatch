/** Live Excel eval — 复制到不存在的表(真实模型):期待【一轮】addSheet+copy 闭环,不追问不分批不手抄。 */
import { acceptNextConfirm, openApp, sleep, createReporter } from './harness.mjs';
const KEY = process.env.OA_EVAL_KEY ?? '';
if (!KEY) { console.error('缺少 OA_EVAL_KEY'); process.exit(2); }
const { page, teardown } = await openApp({
  storage: { 'oa.fmt': 'excel', 'oa.server': 'http://localhost:4319', 'oa.provider': 'deepseek', 'oa.model': 'deepseek-v4-pro', 'oa.apiKey': KEY },
});
const r = createReporter();
async function awaitTurn(timeoutMs = 300000) {
  await sleep(1500);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(() => { const s = document.querySelector('.composer .send'); return !!s && !s.disabled; })) return true;
    await sleep(2000);
  }
  return false;
}
try {
  await page.waitForSelector('.univer-host canvas', { timeout: 30000 });
  await sleep(3000);
  await page.locator('.composer textarea').fill('把当前这部分内容复制到 Sheet2 一份');
  await page.locator('.composer textarea').press('Enter');
  r.ok('回合完成', await awaitTurn());
  await sleep(1200);
  const st = await page.evaluate(() => {
    try {
      const th = JSON.parse(localStorage.getItem('oa.thread') ?? '[]');
      const last = th[th.length - 1];
      for (let i = th.length - 1; i >= 0; i--) if (th[i]?.kind === 'diff') {
        const kinds = th[i].diff.items.map((x) => x.kind);
        return { kinds, n: kinds.length, clarify: last?.kind === 'clarify' };
      }
      return { kinds: [], n: 0, clarify: last?.kind === 'clarify' };
    } catch (e) { return { err: String(e) }; }
  });
  console.log('提案:', JSON.stringify(st));
  r.ok('一轮出提案(不追问澄清)', st.n > 0 && !st.clarify);
  r.ok('用 addSheet 建表(不让用户手动建)', st.kinds?.includes('addSheet'), st.kinds?.join(','));
  r.ok('用 copyRange 整块复制(不逐格手抄)', st.kinds?.includes('copyRange'));
  r.ok('提案精炼(≤4 条,非 36 条 setValue)', st.n <= 4, `${st.n} 条`);
  // 接受并确认 Sheet2 真出现
  const btn = page.locator('.reviewbox .btn.solid').last();
  if (await btn.count()) { acceptNextConfirm(page); await btn.click().catch(() => {}); await sleep(2000); }
  const sheet2 = await page.evaluate(() => document.body.textContent?.includes('Sheet2'));
  r.ok('接受后 Sheet2 页签出现', !!sheet2);
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/ec1-copysheet.png' });
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
