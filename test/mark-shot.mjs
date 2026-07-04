/** 验证 Excel 对照视图:注入合成 diff,点击「对照」段,截图看改动格着色 + 步进。 */
import { openApp, sleep } from './harness.mjs';

const items = [
  { editId: 'e0', ref: 'Sheet1!C4', badge: 'modify', after: '150', label: '销量 1500 疑似异常,修正为 150' },
  { editId: 'e1', ref: 'Sheet1!E2', badge: 'modify', after: '=C2*D2', label: '金额改为公式' },
  { editId: 'e2', ref: 'Sheet1!G1', badge: 'add', after: '备注', label: '新增"备注"表头' },
];
const ops = [
  { a1: 'C4', value: '150', before: '1500', editId: 'e0', note: '' },
  { a1: 'E2', value: '=C2*D2', before: '4560', editId: 'e1', note: '' },
  { a1: 'G1', value: '备注', editId: 'e2', note: '' },
];
const thread = [
  { role: 'user', text: '修正异常销量、把金额改成公式,并加一列备注表头' },
  { role: 'assistant', kind: 'diff', ops, diff: { changeSetId: 'cs', hostId: 'h', intent: '修正 + 公式 + 新增表头', items } },
];
const OUT = process.env.SHOT_DIR || '.';
// accepted 预置为全接受(还原真实提案到达时的乐观状态)
const acc = JSON.stringify(items.map((it) => `cs::${it.editId}`));
const { page, teardown } = await openApp({ storage: { 'oa.thread': JSON.stringify(thread), 'oa.accepted': acc } });
try {
  await page.waitForSelector('.univer-host canvas', { timeout: 20000 }).catch(() => {});
  await sleep(2500);
  // 点「对照」
  await page.locator('.excel-difftoggle .rd-dt-seg', { hasText: '对照' }).click();
  await sleep(800);
  await page.screenshot({ path: OUT + '/07-mark-view.png' });
  console.log('shot 07 mark view');
  // 点「原文」看回改前
  await page.locator('.excel-difftoggle .rd-dt-seg', { hasText: '原文' }).click();
  await sleep(800);
  await page.screenshot({ path: OUT + '/08-orig-view.png' });
  console.log('shot 08 orig view');
  // 回「改后」,验证着色被清掉
  await page.locator('.excel-difftoggle .rd-dt-seg', { hasText: '改后' }).click();
  await sleep(800);
  await page.screenshot({ path: OUT + '/09-final-view.png' });
  console.log('shot 09 final view');
} finally {
  await teardown();
}
