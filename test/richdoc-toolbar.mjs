/**
 * Word 功能区(仿 Office 六选项卡)e2e:验证命令真改 DOM、审查修复的关键行为、
 * 即时 tooltip、图标去重、选区上抛芯片。选择器统一走稳定的 [data-cmd](与语言/图标无关)。
 */
import { openApp, createReporter } from './harness.mjs';

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word' } });
const r = createReporter();

const answers = ['图', '示例', '拼音'];
let ai = 0;
page.on('dialog', async (d) => { await d.accept(d.type() === 'prompt' ? (answers[ai++] ?? '') : undefined); });

await page.waitForSelector('.rd-ribbon');
await page.waitForSelector('.rd-page');

const tab = (name) => page.locator('.rd-ribbon .rtab', { hasText: name }).click();
const cmd = (c) => page.click(`[data-cmd="${c}"]`);
const svgOf = (c) => page.evaluate((x) => { const el = document.querySelector(`[data-cmd="${x}"] svg`); return el ? el.innerHTML.replace(/\s+/g, ' ') : null; }, c);

async function resetDoc(html = '<h2>标题演示段</h2><p>这是一段用于测试的正文文字内容示例。</p>') {
  await page.evaluate((h) => { const el = document.querySelector('.rd-page'); el.innerHTML = h; el.focus(); }, html);
}
async function selectIn(sel, from, to = from) {
  await page.evaluate(({ sel, from, to }) => {
    const el = document.querySelector(sel); const tn = el.firstChild;
    const range = document.createRange();
    range.setStart(tn, Math.min(from, tn.length)); range.setEnd(tn, Math.min(to, tn.length));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { sel, from, to });
}
const selOffset = () => page.evaluate(() => {
  const root = document.querySelector('.rd-page'); const s = window.getSelection();
  if (!root || !s.rangeCount) return -1;
  const pre = document.createRange(); pre.selectNodeContents(root);
  pre.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
  return pre.toString().length;
});

// ───────── 开始:字符/段落命令 ─────────
await tab('开始');
await resetDoc(); await selectIn('.rd-page p', 0, 4); await cmd('上标');
r.ok('上标', await page.evaluate(() => { const p = document.querySelector('.rd-page p'); return !!p.querySelector('sup') || /vertical-align:\s*super/.test(p.innerHTML); }));

await resetDoc(); await selectIn('.rd-page p', 5, 9); await cmd('增大字号');
r.ok('增大字号 → pt', await page.evaluate(() => !!document.querySelector('.rd-page span[style*="pt"]')));

await resetDoc(); await selectIn('.rd-page p', 0, 6); await cmd('两端对齐');
r.ok('两端对齐 → justify', await page.evaluate(() => /justify/.test(document.querySelector('.rd-page p').getAttribute('style') || '')));

await resetDoc(); await selectIn('.rd-page p', 0, 3); await cmd('增加缩进');
r.ok('增加缩进 → margin', await page.evaluate(() => /margin/.test(document.querySelector('.rd-page').innerHTML)));

await resetDoc(); await selectIn('.rd-page h2', 0, 2); await cmd('行距');
await page.locator('.dropdown .drop-item', { hasText: '2.0' }).first().click();
r.ok('行距 2.0', await page.evaluate(() => /line-height:\s*2/.test(document.querySelector('.rd-page h2').getAttribute('style') || '')));

await resetDoc(); await selectIn('.rd-page p', 0, 2); await cmd('标题3');
r.ok('样式 → 标题3(h3)', await page.evaluate(() => !!document.querySelector('.rd-page h3')));

await resetDoc(); await selectIn('.rd-page p', 0, 2); await cmd('引用');
r.ok('样式 → 引用(blockquote)', await page.evaluate(() => !!document.querySelector('.rd-page blockquote')));

// ── 修复回归 ──
await resetDoc(); await selectIn('.rd-page p', 0, 4);
await cmd('字号'); await page.locator('.dropdown .drop-item', { hasText: '36' }).first().click(); await cmd('加粗');
r.ok('改字号后链式排版(同段 36pt 且被 bold 命中)', await page.evaluate(() => { const h = document.querySelector('.rd-page p').innerHTML; return /36pt/.test(h) && /(font-weight|<b>)/i.test(h); }));

await resetDoc('<p>alpha beta alpha gamma alpha</p>'); await selectIn('.rd-page p', 0);
await cmd('查找'); await page.locator('.rd-find-in').fill('alpha'); await page.locator('.rd-find-btn').click();
const o1 = await selOffset(); await page.locator('.rd-find-btn').click(); const o2 = await selOffset();
r.ok(`查找下一个前进 (${o1}→${o2})`, o1 >= 0 && o2 > o1);
await page.keyboard.press('Escape');

// ───────── 插入:表格网格 + 水平线 ─────────
await tab('插入');
await resetDoc(); await selectIn('.rd-page p', 0);
await cmd('表格');
await page.locator('.rd-tgrid i').nth(22).hover(); await page.locator('.rd-tgrid i').nth(22).click();
await page.waitForTimeout(120);
r.ok('表格网格 3×3', await page.evaluate(() => { const t = document.querySelector('.rd-page .rd-tbl'); return !!t && t.querySelectorAll('td').length === 9; }));

await resetDoc(); await selectIn('.rd-page p', 3); await cmd('水平线');
r.ok('水平线 → <hr>', await page.evaluate(() => !!document.querySelector('.rd-page hr')));

await resetDoc('<p><b>加粗词</b>随后的普通正文内容示例。</p>'); await selectIn('.rd-page p', 0);
await cmd('首字下沉'); await page.locator('.dropdown .drop-item', { hasText: '下沉' }).first().click();
r.ok('首字下沉保内联(rd-dropcap 且 <b> 仍在)', await page.evaluate(() => { const h = document.querySelector('.rd-page p').innerHTML; return /rd-dropcap/.test(h) && /<b>|font-weight/i.test(h); }));

// ───────── 视图:缩放(CSS zoom) ─────────
await tab('视图');
await cmd('缩放'); await page.locator('.dropdown .drop-item', { hasText: '150%' }).click();
await page.waitForTimeout(150);
r.ok('缩放 150%(CSS zoom)', await page.evaluate(() => document.querySelector('.rd-page').style.zoom === '1.5'));
await cmd('100%');

// ───────── 即时 tooltip(Office 风格) ─────────
await tab('开始');
await page.locator('[data-cmd="加粗"]').hover();
await page.waitForTimeout(300);
r.ok('悬停即时 tooltip 文案=加粗', await page.evaluate(() => document.querySelector('.rd-tip')?.textContent === '加粗'));
r.ok('按钮无原生 title(单一自绘气泡)', await page.evaluate(() => !document.querySelector('[data-cmd="加粗"]')?.getAttribute('title')));

// ───────── 图标去重 ─────────
const find = await svgOf('查找'), replace = await svgOf('替换'), changeCase = await svgOf('更改大小写');
await tab('插入');
const wordArt = await svgOf('艺术字'), header = await svgOf('页眉'), footer = await svgOf('页脚');
await tab('开始');
const textEffect = await svgOf('文本效果');
r.ok('图标去重:查找≠替换', find && replace && find !== replace);
r.ok('图标去重:页眉≠页脚', header && footer && header !== footer);
r.ok('图标去重:文本效果≠艺术字', textEffect && wordArt && textEffect !== wordArt);
r.ok('更改大小写图标含 Aa', /Aa/.test(changeCase || ''));

// ───────── 选区上抛芯片(与 Excel 对等) ─────────
await resetDoc('<h2>可选标题片段</h2><p>正文内容</p>');
await selectIn('.rd-page h2', 0, 5);
await page.waitForTimeout(150);
r.ok('选区上抛 → 输入区"已选"芯片显示原文', await page.evaluate(() => {
  const q = document.querySelector('.selchip .sel-quote'); return !!q && q.textContent.includes('可选标题');
}));

r.ok('无控制台报错', errors.length === 0, errors.join(' | '));
const fails = r.done();
await teardown();
process.exit(fails);
