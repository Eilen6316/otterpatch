/** drawio 持久化 e2e(纯 UI,无需模型):双击建节点 → localStorage 落盘 → 刷新后仍在;id 防撞。 */
import { openApp, sleep, createReporter } from './harness.mjs';

const { page, teardown } = await openApp({ storage: { 'oa.fmt': 'drawio' } });
const r = createReporter();
try {
  await page.waitForSelector('.drawio-board, .canvas.board', { timeout: 20000 });
  await sleep(500);
  // 双击空白建两个节点
  const board = page.locator('.canvas.board');
  await board.dblclick({ position: { x: 300, y: 200 } });
  await sleep(200);
  await page.keyboard.press('Escape');
  await board.dblclick({ position: { x: 500, y: 320 } });
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(600); // 等 300ms 防抖落盘
  const saved = await page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('oa.board') ?? '{}').nodes ?? []).length; } catch { return -1; } });
  r.ok('建 2 节点已落 localStorage', saved === 2, `存了 ${saved}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.drawio-board, .canvas.board', { timeout: 20000 });
  await sleep(600);
  const after = await page.evaluate(() => document.querySelectorAll('.bnode').length);
  r.ok('刷新后节点仍在(持久化生效)', after === 2, `渲染 ${after}`);

  // 刷新后再建一个:id 防撞(freshId 顺移),不覆盖已有节点
  await board.dblclick({ position: { x: 700, y: 200 } });
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(600);
  const final = await page.evaluate(() => ({
    dom: document.querySelectorAll('.bnode').length,
    ids: (() => { try { const ns = JSON.parse(localStorage.getItem('oa.board') ?? '{}').nodes ?? []; return new Set(ns.map((n) => n.id)).size === ns.length ? ns.length : -1; } catch { return -1; } })(),
  }));
  r.ok('刷新后新建不撞 id(3 节点全在且 id 唯一)', final.dom === 3 && final.ids === 3, JSON.stringify(final));
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
