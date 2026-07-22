/**
 * Live drawio eval — 用户实测暴露的三缺陷回归(真实模型):
 *  ① 容器标签压住子节点(渲染层贴顶 + agent 预留标题区)
 *  ② 架构图画一半、0 连线就停下来"满意后继续"(一次成图)
 *  ③ 自检对标签遮挡视而不见(verify 新增标题区检查)
 * 断言:节点数、连线数、容器标签贴顶(.bnode-label.top)、任意两个节点标签矩形零重叠。
 * 需要本地 serve (http://localhost:4319) + OA_EVAL_KEY。
 */
import { acceptNextConfirm, openApp, sleep, createReporter } from './harness.mjs';
const KEY = process.env.OA_EVAL_KEY ?? '';
if (!KEY) { console.error('缺少 OA_EVAL_KEY 环境变量(DeepSeek API key),live eval 需要真实模型'); process.exit(2); }

const { page, errors, teardown } = await openApp({
  storage: { 'oa.fmt': 'drawio', 'oa.server': 'http://localhost:4319', 'oa.provider': 'deepseek', 'oa.model': 'deepseek-v4-pro', 'oa.apiKey': KEY },
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
const boardStat = () => page.evaluate(() => ({
  nodes: document.querySelectorAll('.bnode').length,
  topLabels: document.querySelectorAll('.bnode-label.top').length,
  edges: document.querySelectorAll('svg g > path[style*="pointer-events"]').length, // 每条连线一个命中热区 path
  labelOverlaps: (() => {
    const rects = [...document.querySelectorAll('.bnode-label')].map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0);
    let n = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) n++;
    }
    return n;
  })(),
}));

try {
  await page.waitForSelector('.board, .canvas.board', { timeout: 20000 }).catch(() => {});
  await sleep(800);

  r.ok('回合完成(未超时)', await ask('绘制一个k8s的架构图'));
  // 偶发 clarify:补一句直接画
  let st = await boardStat();
  if (st.nodes === 0) { await ask('标准单 Master 双 Worker 即可,直接画,不用再确认'); st = await boardStat(); }
  const btn = page.locator('.reviewbox .btn.solid').last();
  if (await btn.count()) { acceptNextConfirm(page); await btn.click().catch(() => {}); await sleep(1200); }
  st = await boardStat();
  console.log('画板:', JSON.stringify(st));

  r.ok('一次成图:节点 ≥ 6(Master+Worker 组件)', st.nodes >= 6, `节点 ${st.nodes}`);
  r.ok('一次成图:连线 ≥ 3(不再是 0 连线半成品)', st.edges >= 3, `连线 ${st.edges}`);
  r.ok('容器标签贴顶(.bnode-label.top 存在)', st.topLabels >= 1, `贴顶标签 ${st.topLabels}`);
  r.ok('任意两个节点标签零重叠', st.labelOverlaps === 0, `重叠对数 ${st.labelOverlaps}`);
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/dk1-k8s.png' });

  console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/dk-error.png' }).catch(() => {});
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
