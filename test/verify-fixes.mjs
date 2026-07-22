/** Visual re-verification of the two live-eval findings (mock SSE, no model needed):
 *  1) excel-difftoggle must be a compact pill (height < 60px), not a full-height overlay
 *  2) word justify must NOT stretch last lines / headings (textAlignLast stays auto)
 */
import { openApp, sleep } from './harness.mjs';
const SHOT = process.env.SHOT_DIR || '.';
let fail = 0;
const ok = (n, c) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + n); if (!c) fail++; };

// ── Excel toggle geometry ──
{
  const { page, teardown } = await openApp({ storage: { 'oa.fmt': 'excel', 'oa.apiKey': 'k', 'oa.server': 'http://localhost:4319' } });
  const diff = { changeSetId: 'csv', hostId: 'h', intent: 'x', items: [{ editId: 'e0', ref: 'Sheet1!C2', badge: 'modify', after: '200', label: 'v' }] };
  const changeSet = { edits: [{ id: 'e0', target: 'a0', op: { family: 'value', kind: 'setValue', value: 200 } }], anchors: { a0: { portable: { kind: 'grid', ref: 'Sheet1!C2' } } } };
  await page.route('**/propose-stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'done', kind: 'changeset', diff, changeSet })}\n\n` }));
  await page.waitForSelector('.univer-host canvas', { timeout: 30000 });
  await sleep(2500);
  await page.locator('.composer textarea').fill('改值');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('.excel-difftoggle', { timeout: 10000 });
  await sleep(400);
  const box = await page.locator('.excel-difftoggle').boundingBox();
  ok(`excel 速览条为紧凑胶囊(h=${Math.round(box?.height ?? 0)}px < 60,贴底部)`, !!box && box.height < 60 && box.y > 400);
  await page.screenshot({ path: `${SHOT}/fix1-excel-toggle.png` });
  await teardown();
}

// ── Word justify last-line ──
{
  const { page, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.apiKey': 'k', 'oa.server': 'http://localhost:4319' } });
  const diff = { changeSetId: 'csj', hostId: 'h', intent: 'x', items: [{ editId: 'e0', ref: '全文', badge: 'modify', after: '两端对齐', label: 'fmt', style: { align: 'justify' } }] };
  const changeSet = { edits: [{ id: 'e0', target: 'a0', op: { family: 'style', kind: 'setStyle', scope: 'document', style: { align: 'justify', font: '宋体', size: 12 } } }], anchors: { a0: { portable: { kind: 'flow', quote: { text: '' } } } } };
  await page.route('**/propose-stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'done', kind: 'changeset', diff, changeSet })}\n\n` }));
  await page.waitForSelector('.rd-page');
  await sleep(400);
  await page.locator('.composer textarea').fill('全文两端对齐');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('.reviewbox', { timeout: 10000 });
  await sleep(500);
  const tal = await page.evaluate(() => getComputedStyle(document.querySelector('.rd-page')).textAlignLast);
  ok(`justify 不再拉伸末行(textAlignLast=${tal},应为 auto)`, tal === 'auto');
  await page.screenshot({ path: `${SHOT}/fix2-word-justify.png` });
  await teardown();
}
console.log(fail ? `\n${fail} FAILED` : '\nALL FIXES VERIFIED');
process.exit(fail);
