/**
 * UI 冒烟:不需要 Agent / API Key,验证应用能渲染、核心交互在。
 * 前置:npm run build -w apps/desktop(需要 apps/desktop/dist)。
 * 运行:node test/ui-smoke.mjs
 */
import { openApp, sleep, createReporter } from './harness.mjs';

const rep = createReporter();
const { page, errors, teardown } = await openApp();

try {
  // Excel(默认格式):Univer 渲染
  await page.waitForSelector('.univer-host canvas', { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  rep.ok('brand logo in header', (await page.locator('.brand-logo').count()) === 1);
  rep.ok('page title is OtterPatch', (await page.title()).includes('OtterPatch'));
  rep.ok('Univer grid renders', (await page.locator('.univer-host canvas').count()) > 0);

  // 框选 → 选区上抛 Agent 区
  const host = await page.locator('.univer-host').boundingBox();
  await page.mouse.move(host.x + 150, host.y + 150);
  await page.mouse.down();
  await page.mouse.move(host.x + 340, host.y + 250, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
  rep.ok('selection reflected in composer chip', /已选/.test((await page.locator('.selchip').textContent()) || ''));

  // drawio:三栏 + 拖入形状 + 形状无中文名标签
  await page.locator('.fmttabs button', { hasText: '流程图' }).click();
  await page.waitForSelector('.drawio-board');
  await page.locator('.pal-shape').nth(0).dragTo(page.locator('.drawio-board'), { targetPosition: { x: 280, y: 200 } });
  await sleep(150);
  rep.ok('drawio drop creates a node', (await page.locator('.bnode').count()) === 1);
  rep.ok('dropped shape has no label text', ((await page.locator('.bnode-label').first().textContent()) || '') === '');

  rep.ok('no console/page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await teardown();
}

process.exit(rep.done());
