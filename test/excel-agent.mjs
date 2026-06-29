/**
 * 真实 Agent 端到端:验证 提问→回答、操作→diff、全局上下文(选区外也能答)。
 * 前置:
 *   1) npm run build -w apps/desktop && npm run build -w apps/mcp-server
 *   2) 起本机服务:node apps/mcp-server/dist/serve.js
 *   3) 设环境变量(BYOK,密钥不入库):
 *        OTTERPATCH_TEST_KEY=sk-...        必填
 *        OTTERPATCH_TEST_PROVIDER=deepseek (默认 deepseek)
 *        OTTERPATCH_TEST_MODEL=deepseek-v4-flash
 * 运行:node test/excel-agent.mjs   (服务未起或无 Key 时自动跳过)
 */
import { openApp, sleep, createReporter } from './harness.mjs';

const KEY = process.env.OTTERPATCH_TEST_KEY;
const PROVIDER = process.env.OTTERPATCH_TEST_PROVIDER || 'deepseek';
const MODEL = process.env.OTTERPATCH_TEST_MODEL || 'deepseek-v4-flash';
const SERVE = 'http://localhost:4319';

if (!KEY) {
  console.log('skip excel-agent: 未设 OTTERPATCH_TEST_KEY');
  process.exit(0);
}
try {
  const h = await fetch(SERVE + '/health').then((r) => r.json());
  if (!h.ok) throw new Error('health not ok');
} catch {
  console.log(`skip excel-agent: 本机服务 ${SERVE} 未运行(先 node apps/mcp-server/dist/serve.js)`);
  process.exit(0);
}

const rep = createReporter();
const { page, teardown } = await openApp({
  storage: { 'oa.server': SERVE, 'oa.apiKey': KEY, 'oa.provider': PROVIDER, 'oa.model': MODEL },
});

const ask = async (text) => {
  await page.locator('textarea').fill(text);
  await page.locator('.send').click();
  // 等回答气泡或 diff 卡
  await Promise.race([
    page.waitForSelector('.answer-bubble', { timeout: 60000 }).catch(() => {}),
    page.waitForSelector('.change', { timeout: 60000 }).catch(() => {}),
    page.waitForSelector('.oplist', { timeout: 60000 }).catch(() => {}),
  ]);
  await sleep(1200);
};
const reset = async () => {
  const back = page.locator('.back-btn');
  if (await back.count()) await back.first().click();
  await sleep(200);
};

try {
  await page.waitForSelector('.univer-host canvas', { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  const host = await page.locator('.univer-host').boundingBox();

  // 1) 提问 → 回答(不改表)
  await page.mouse.click(host.x + 60, host.y + 150); // 选 A2(很小)
  await sleep(400);
  await ask('销量这一列的平均值大概是多少?');
  rep.ok('question -> answer bubble', (await page.locator('.answer-bubble').count()) === 1);
  rep.ok('question did NOT produce a diff', (await page.locator('.change').count()) === 0);
  await reset();

  // 2) 全局上下文:小选区也能回答需要看全表的问题
  await page.mouse.click(host.x + 60, host.y + 150);
  await sleep(300);
  await ask('整张表里金额最大的是哪一行?');
  const ans = ((await page.locator('.answer-bubble').textContent()) || '').replace(/\s+/g, '');
  rep.ok('global question answered using whole sheet (mentions 57000 or 第4行)', /57000|第4行|1500/.test(ans), ans.slice(0, 60));
  await reset();

  // 3) 操作 → diff(改表)
  await page.mouse.move(host.x + 90, host.y + 150);
  await page.mouse.down();
  await page.mouse.move(host.x + 300, host.y + 250, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  await ask('把销量列里的异常值标红');
  rep.ok('operation -> diff/playback', (await page.locator('.change, .oplist').count()) > 0);
} finally {
  await teardown();
}

process.exit(rep.done());
