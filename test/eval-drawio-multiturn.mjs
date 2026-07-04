/**
 * Live drawio eval — 多轮拆解连贯性(真实模型):
 *  第 1 轮画 A/B 并连线;第 2 轮"在 B 下面加 C,从 B 连到 C"。
 *  此前 Agent 的 cellId 会被改名成 g{seq}_k,第 2 轮引用不了上一轮的节点(verify 报不存在→断裂)。
 *  断言:第 2 轮不重画 A/B(节点恰 3 个)、新连线真的挂在 B 上(连线 ≥2)。
 * 需要本地 serve + OA_EVAL_KEY。
 */
import { openApp, sleep, createReporter } from './harness.mjs';
const KEY = process.env.OA_EVAL_KEY ?? '';
if (!KEY) { console.error('缺少 OA_EVAL_KEY 环境变量'); process.exit(2); }

const { page, errors, teardown } = await openApp({
  storage: { 'oa.fmt': 'drawio', 'oa.server': 'http://localhost:4319', 'oa.provider': 'deepseek', 'oa.model': 'deepseek-v4-pro', 'oa.apiKey': KEY },
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
async function ask(text) {
  await page.locator('.composer textarea').fill(text);
  await page.locator('.composer textarea').press('Enter');
  const ok = await awaitTurn();
  await sleep(1000);
  return ok;
}
async function acceptAll() { const b = page.locator('.reviewbox .btn.solid').last(); if (await b.count()) { await b.click().catch(() => {}); await sleep(1000); } }
const stat = () => page.evaluate(() => ({
  nodes: document.querySelectorAll('.bnode').length,
  edges: document.querySelectorAll('svg g > path[style*="pointer-events"]').length,
  labels: [...document.querySelectorAll('.bnode-label')].map((el) => el.textContent),
}));

try {
  await page.waitForSelector('.canvas.board', { timeout: 20000 }).catch(() => {});
  await sleep(600);
  r.ok('第 1 轮完成', await ask('画两个节点:「登录服务」和「用户数据库」,登录服务连到用户数据库'));
  await acceptAll();
  const s1 = await stat();
  r.ok('第 1 轮:2 节点 1 连线', s1.nodes === 2 && s1.edges >= 1, JSON.stringify(s1));

  r.ok('第 2 轮完成', await ask('在用户数据库下面加一个「审计日志」节点,并从用户数据库连一条线到它'));
  await acceptAll();
  const s2 = await stat();
  console.log('第 2 轮画板:', JSON.stringify(s2));
  r.ok('多轮连贯:不重画旧节点(恰 3 个)', s2.nodes === 3, `节点 ${s2.nodes}`);
  r.ok('新连线挂上了上一轮的节点(连线 ≥2)', s2.edges >= 2, `连线 ${s2.edges}`);
  r.ok('三个业务节点齐全', ['登录服务', '用户数据库', '审计日志'].every((w) => s2.labels.some((l) => l?.includes(w))), s2.labels.join('|'));
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/dm1-multiturn.png' });
  console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
