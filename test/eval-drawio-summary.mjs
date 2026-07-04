/**
 * Live drawio eval — 摘要图完整性 + 构图(真实模型):
 *  用户实测:18 处提案只画出 8 节点 0 连线(流式截断,done 复用了不完整的流式结果)。
 *  断言:画布对象数 == 提案 addObject 数(一个不丢)、有连线或分区卡、标签零重叠。
 * 需要本地 serve (http://localhost:4319) + OA_EVAL_KEY。
 */
import { openApp, sleep, createReporter } from './harness.mjs';
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

const INTENT = '把这篇论文总结成一张图:Chain-of-Thought Prompting——背景(LLM 逻辑推理弱、微调昂贵、标准 few-shot 缺中间步骤);方法(标准 Prompt Q→A vs CoT Prompt Q→推理步骤→A,无需参数更新);关键发现(GSM8K 17.9%→56.9% 超越微调SOTA、涌现能力需≥100B参数、消融证明推理内容+顺序缺一不可、OOD可泛化到更长序列);结论(简单强大/规模涌现/免训练)。做成杂志感的分区卡片图。';

try {
  await page.waitForSelector('.canvas.board', { timeout: 20000 }).catch(() => {});
  await sleep(800);
  await page.locator('.composer textarea').fill(INTENT);
  await page.locator('.composer textarea').press('Enter');
  r.ok('回合完成(未超时)', await awaitTurn());
  await sleep(1500);

  const st = await page.evaluate(() => {
    let addCount = -1, boardObjs = -1;
    try {
      const th = JSON.parse(localStorage.getItem('oa.thread') ?? '[]');
      for (let i = th.length - 1; i >= 0; i--) if (th[i]?.kind === 'diff' && th[i].board) { addCount = th[i].diff.items.length; boardObjs = th[i].board.objs.length; break; }
    } catch {}
    const rects = [...document.querySelectorAll('.bnode-label')].map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0);
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) overlaps++;
    }
    const wide = [...document.querySelectorAll('.bnode')].filter((el) => el.getBoundingClientRect().width >= 420).length; // 标题横幅/分区条
    return { addCount, boardObjs, nodes: document.querySelectorAll('.bnode').length, edges: document.querySelectorAll('svg g > path[style*="pointer-events"]').length, topLabels: document.querySelectorAll('.bnode-label.top').length, wide, overlaps };
  });
  console.log('画板:', JSON.stringify(st));
  r.ok('提案有相当规模(≥10 处)', st.addCount >= 10, `提案 ${st.addCount}`);
  r.ok('完整落地:画布对象数 = 提案对象数(不再画一半)', st.boardObjs === st.addCount, `画布 ${st.boardObjs} / 提案 ${st.addCount}`);
  r.ok('有构图结构(容器/连线/分区条任一)', st.topLabels >= 2 || st.edges >= 2 || st.wide >= 3, `容器 ${st.topLabels} 连线 ${st.edges} 分区条 ${st.wide}`);
  r.ok('标签零重叠', st.overlaps === 0, `重叠 ${st.overlaps}`);
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/ds1-summary.png' });

  console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/ds-error.png' }).catch(() => {});
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
