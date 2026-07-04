/** 临时:注入一个带 before 的合成 diff 回合,截图 git-diff 风格审阅卡(无需 BYOK key)。 */
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
const { page, teardown } = await openApp({ storage: { 'oa.thread': JSON.stringify(thread) } });
try {
  await page.waitForSelector('.univer-host canvas', { timeout: 20000 }).catch(() => {});
  await sleep(2500);
  await page.locator('.rv-code > summary').click().catch(() => {}); // 展开 git-diff 明细表
  await sleep(400);
  await page.screenshot({ path: OUT + '/06-review-gitdiff.png' });
  console.log('shot 06 review git-diff');
} finally {
  await teardown();
}
