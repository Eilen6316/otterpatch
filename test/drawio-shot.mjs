/** 临时:注入一个 drawio 绘图回合(OSI 七层),验证"已绘制图表"工具卡 + 绘制代码视图。 */
import { openApp, sleep } from './harness.mjs';

const layers = ['应用层 (Application)', '表示层 (Presentation)', '会话层 (Session)', '传输层 (Transport)', '网络层 (Network)', '数据链路层 (Data Link)', '物理层 (Physical)'];
const items = layers.map((v, i) => ({ editId: 'e' + i, ref: 'n' + (i + 1), badge: 'add', label: `新增节点「${v}」`, after: v }));
items.push({ editId: 'x1', ref: 'e_link', badge: 'add', label: '连线 n1 → n2' });
const thread = [
  { role: 'user', text: '绘制一个 OSI 七层模型的架构图,在左边' },
  { role: 'assistant', kind: 'diff', ops: [], board: { byEdit: {}, objs: [] }, diff: { changeSetId: 'cs', hostId: 'h', intent: 'OSI 七层模型架构图(从上到下,彩色分层)', items } },
];
const OUT = process.env.SHOT_DIR || '.';
const { page, teardown } = await openApp({ storage: { 'oa.thread': JSON.stringify(thread), 'oa.fmt': 'drawio' } });
try {
  await sleep(900);
  await page.locator('.fmttab', { hasText: '流程图' }).click().catch(() => {});
  await sleep(900);
  // 展开"查看绘制代码"
  await page.locator('.rv-code > summary').click().catch(() => {});
  await sleep(400);
  await page.screenshot({ path: OUT + '/05-drawio-review.png' });
  console.log('shot 05 drawio review');
} finally {
  await teardown();
}
