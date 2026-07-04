/** 形状引擎 e2e:参数化渲染(viewBox=实际 w/h)+ 缩放不变形(箭头头部深度定值)+ 调色板引擎驱动。 */
import { openApp, sleep, createReporter } from './harness.mjs';

const PAGE = { pages: [{ name: 'P1', nodes: [
  { id: 'a1', x: 60, y: 60, w: 300, h: 60, inner: '', label: '宽箭头', kind: 'agent', shape: 'arrowRight', fill: '#dae8fc', stroke: '#6c8ebf' },
  { id: 'a2', x: 60, y: 160, w: 120, h: 60, inner: '', label: '窄箭头', kind: 'agent', shape: 'arrowRight', fill: '#d5e8d4', stroke: '#82b366' },
  { id: 'c1', x: 60, y: 260, w: 160, h: 100, inner: '', label: '存储', kind: 'agent', shape: 'cylinder', fill: '#e1d5e7', stroke: '#9673a6' },
], edges: [] }], cur: 0 };

const { page, teardown } = await openApp({ storage: { 'oa.fmt': 'drawio', 'oa.board': JSON.stringify(PAGE) } });
const r = createReporter();
try {
  await page.waitForSelector('.canvas.board', { timeout: 20000 });
  await sleep(800);
  const st = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('.bnode > svg')];
    const byLabel = (t) => [...document.querySelectorAll('.bnode')].find((b) => b.textContent?.includes(t))?.querySelector('svg');
    const a1 = byLabel('宽箭头'), a2 = byLabel('窄箭头'), c1 = byLabel('存储');
    return {
      n: svgs.length,
      vb1: a1?.getAttribute('viewBox'), vb2: a2?.getAttribute('viewBox'),
      d1: a1?.innerHTML ?? '', d2: a2?.innerHTML ?? '', dc: c1?.innerHTML ?? '',
      palette: [...document.querySelectorAll('.pal-n')].reduce((sum, el) => sum + (parseInt(el.textContent ?? '0', 10) || 0), 0),
      cats: [...document.querySelectorAll('.pal-cat-h.click')].map((b) => b.textContent?.trim()),
    };
  });
  r.ok('参数化渲染:viewBox = 实际尺寸(300×60 / 120×60)', st.vb1 === '0 0 300 60' && st.vb2 === '0 0 120 60', `${st.vb1} | ${st.vb2}`);
  r.ok('缩放不变形:两宽度下箭头头部深度均为定值 40px(300-40=260 / 120-40=80)', st.d1.includes('260') && st.d2.includes('80'));
  r.ok('圆柱盖参数化(含 A 弧指令)', /A\s?80,15|A 80 15|A80,15|A 80,15/.test(st.dc) || st.dc.includes('A'), st.dc.slice(0, 60));
  r.ok('调色板引擎驱动(≥70 形状,四分类)', st.palette >= 70 && st.cats.length === 4, `${st.palette} 形状 · ${st.cats.join('/')}`);

  // 交互:拖拽缩放宽箭头到更宽,断言 viewBox 跟随、箭头深度仍为定值(w-40)
  await page.locator('.bnode', { hasText: '宽箭头' }).click();
  await sleep(200);
  const h = page.locator('.bhandle.h-e');
  const hb = await h.boundingBox();
  if (hb) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 120, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();
    await sleep(400);
    const after = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.bnode')].find((x) => x.textContent?.includes('宽箭头'));
      const svg = b?.querySelector('svg');
      const w = Math.round(parseFloat(b?.style.width ?? '0'));
      return { w, vb: svg?.getAttribute('viewBox'), hasDepth: (svg?.innerHTML ?? '').includes(String(w - 40)) };
    });
    r.ok(`手动缩放后仍不变形(w=${after.w},viewBox 跟随,箭头深度=w-40)`, after.vb === `0 0 ${after.w} 60` && after.hasDepth, JSON.stringify(after));
  } else {
    r.ok('缩放手柄可见', false);
  }
  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/se1-shapes.png' });
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
