/**
 * 专家能力评测(反复验证):把 Excel/Word 的一组真实场景发给【真 Agent】,
 * 抓它的 plan + git-diff(或 answer),并列出"领域专家应有的表现"供逐条对照打分。
 * 目的:验证 Agent 是否像领域专家一样【诊断→给最优方案→讲洞见→主动多做一步】,而非机械照做。
 *
 * 前置(与 excel-agent 相同,BYOK,密钥不入库):
 *   npm run build -w apps/desktop && npm run build -w apps/mcp-server && npm run build -w packages/agent
 *   node apps/mcp-server/dist/serve.js
 *   OTTERPATCH_TEST_KEY=sk-... [OTTERPATCH_TEST_PROVIDER=deepseek OTTERPATCH_TEST_MODEL=deepseek-v4-flash] node test/expert-eval.mjs
 * 未设 Key 或服务未起时自动跳过(退出码 0)。用后可反复跑,眼看质量是否达专家水准。
 */
import { openApp, sleep } from './harness.mjs';

const KEY = process.env.OTTERPATCH_TEST_KEY;
const PROVIDER = process.env.OTTERPATCH_TEST_PROVIDER || 'deepseek';
const MODEL = process.env.OTTERPATCH_TEST_MODEL || 'deepseek-v4-flash';
const SERVE = process.env.OTTERPATCH_SERVE || 'http://localhost:4319';
const ONLY = process.env.EVAL_ONLY; // 'excel' | 'word' 只跑其一

if (!KEY) { console.log('skip expert-eval: 未设 OTTERPATCH_TEST_KEY'); process.exit(0); }
try { const h = await fetch(SERVE + '/health').then((r) => r.json()); if (!h.ok) throw 0; }
catch { console.log(`skip expert-eval: 本机服务 ${SERVE} 未运行(先 node apps/mcp-server/dist/serve.js)`); process.exit(0); }

// 场景:{fmt, sel(选区), ask(指令), expert(专家应有表现), signal(可选:输出里应出现的专家信号正则)}
const SCENARIOS = [
  { fmt: 'excel', sel: 'C1:C6', ask: '在最右边加一列"金额合计"', expert: '用 setFormula 写 =SUM/=C*D 之类公式而非死值、统一数字格式、走右侧空列而非插空列', signal: /=|SUM|公式|合计/i },
  { fmt: 'excel', sel: 'A1:F6', ask: '看看这张表有什么问题吗', expert: '先核查再诊断:金额无货币格式/硬编码/异常/文本冒充数字等,给发现+建议(answer)或落地规范化改动', signal: /格式|公式|异常|货币|规范|建议|诊断/ },
  { fmt: 'excel', sel: 'C1:C6', ask: '把销量里明显偏高的异常值标出来', expert: '用 condFormat 规则化整列高亮 或 setStyle bgColor 标该格;语义化用色、别满屏花色', signal: /标红|bgColor|条件格式|高亮|#|异常/i },
  { fmt: 'word', sel: '整体进度符合预期。', ask: '把这句润色得更专业一点', expert: '整句重构为凝练书面语(非同义词替换),保原意,plan 讲清删了哪些赘词', signal: /./ },
  { fmt: 'word', sel: '下周计划', ask: '把这行设成正式的标题', expert: '用 block=h2/h3 套真标题样式(非手动 size+bold),plan 讲清进导航/支撑目录/层级', signal: /标题|block|h[123]|样式/i },
  { fmt: 'word', sel: '下周计划', ask: '这段排版有没有问题?', expert: '判为咨询→用 answer 给三维诊断(文字/结构/排版),不动文档', signal: /./ },
];

const { page, teardown } = await openApp({ storage: { 'oa.server': SERVE, 'oa.apiKey': KEY, 'oa.provider': PROVIDER, 'oa.model': MODEL, 'oa.fmt': 'excel' } });

const toFmt = async (fmt) => {
  await page.locator('.fmttabs button', { hasText: fmt === 'excel' ? 'Excel' : 'Word' }).click();
  if (fmt === 'excel') await page.waitForSelector('.univer-host canvas', { timeout: 15000 }).catch(() => {});
  else await page.waitForSelector('.rd-page', { timeout: 15000 }).catch(() => {});
  await sleep(1500);
};
const selectExcel = async (a1) => { // 粗略:拖过左上一片区域(演示表就在左上)
  const host = await page.locator('.univer-host').boundingBox(); if (!host) return;
  await page.mouse.move(host.x + 70, host.y + 140); await page.mouse.down();
  await page.mouse.move(host.x + 320, host.y + 250, { steps: 6 }); await page.mouse.up(); await sleep(300);
  void a1;
};
const selectWord = async (quote) => {
  await page.evaluate((q) => {
    const root = document.querySelector('.rd-page'); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) { const i = n.data.indexOf(q); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + q.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); return; } }
  }, quote);
  await sleep(250);
};

const run = async (sc) => {
  await toFmt(sc.fmt);
  if (sc.fmt === 'excel') await selectExcel(sc.sel); else await selectWord(sc.sel);
  const before = await page.locator('.answer-bubble, .reviewbox').count();
  await page.locator('.composer textarea').fill(sc.ask);
  await page.locator('.composer .send').click();
  await page.waitForFunction((n) => document.querySelectorAll('.answer-bubble, .reviewbox').length > n, before, { timeout: 90000 }).catch(() => {});
  await sleep(2500);
  return page.evaluate(() => {
    const rb = [...document.querySelectorAll('.reviewbox')].pop();
    if (rb) {
      const intent = rb.querySelector('.rv-intent')?.textContent?.trim() || '';
      const hunks = [...rb.querySelectorAll('.gd-hunk')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()).slice(0, 8);
      return { kind: 'diff', intent, hunks };
    }
    const ans = [...document.querySelectorAll('.answer-bubble')].pop();
    return { kind: 'answer', text: (ans?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400) };
  });
};

let warns = 0;
console.log(`\n=== 专家能力评测 · provider=${PROVIDER} model=${MODEL} ===\n`);
try {
  for (const sc of SCENARIOS) {
    if (ONLY && sc.fmt !== ONLY) continue;
    const r = await run(sc);
    const out = r.kind === 'diff' ? `plan: ${r.intent}\n     diff:\n       ${r.hunks.join('\n       ')}` : `answer: ${r.text}`;
    const sig = sc.signal.test(JSON.stringify(r)) ? 'PASS' : 'WARN';
    if (sig === 'WARN') warns++;
    console.log(`【${sc.fmt}】${sc.ask}  [信号:${sig}]`);
    console.log(`  专家应:${sc.expert}`);
    console.log(`  实际  ${out}\n`);
  }
} finally { await teardown(); }
console.log(`信号 WARN ${warns} 处(信号仅为廉价启发式;真评判以上面 plan/diff 是否达"专家诊断+最优方案+讲洞见"为准,可反复运行)。`);
process.exit(0);
