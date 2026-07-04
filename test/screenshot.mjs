/** 临时:用项目自带 Playwright harness 截图驾驶舱(Excel/选区/drawio)。SHOT_DIR 指定输出目录。 */
import { openApp, sleep } from './harness.mjs';

const OUT = process.env.SHOT_DIR || '.';
const { page, errors, teardown } = await openApp();

try {
  await page.waitForSelector('.univer-host canvas', { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  await page.screenshot({ path: OUT + '/01-excel-cockpit.png' });
  console.log('shot 01 excel cockpit');

  // 框选一块区域 → 选区上抛到 Agent 区(composer chip)
  const host = await page.locator('.univer-host').boundingBox();
  if (host) {
    await page.mouse.move(host.x + 150, host.y + 150);
    await page.mouse.down();
    await page.mouse.move(host.x + 360, host.y + 260, { steps: 10 });
    await page.mouse.up();
    await sleep(800);
  }
  await page.screenshot({ path: OUT + '/02-excel-selection.png' });
  console.log('shot 02 excel selection');

  // 切到 drawio:三栏 + 拖入一个形状
  const tab = page.locator('.fmttabs button', { hasText: '流程图' });
  if (await tab.count()) {
    await tab.click();
    await page.waitForSelector('.drawio-board', { timeout: 8000 }).catch(() => {});
    await sleep(900);
    try {
      await page.locator('.pal-shape').nth(0).dragTo(page.locator('.drawio-board'), { targetPosition: { x: 300, y: 220 } });
    } catch {}
    await sleep(500);
    await page.screenshot({ path: OUT + '/03-drawio.png' });
    console.log('shot 03 drawio');
  }

  console.log('CONSOLE_ERRORS:', errors.length);
  if (errors.length) console.log(errors.slice(0, 6).join('\n'));
} finally {
  await teardown();
}
