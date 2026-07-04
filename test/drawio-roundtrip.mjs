/** .drawio 导入/导出闭环 e2e(纯 UI):真实 mxGraphModel(容器相对坐标/航点/虚线/形状)→ 上传渲染 → 导出下载 → 再解析比对。 */
import { openApp, sleep, createReporter } from './harness.mjs';

const DRAWIO = `<mxfile host="app.diagrams.net"><diagram id="x" name="P1"><mxGraphModel dx="1" dy="1" grid="1" gridSize="10"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="box" value="服务集群" style="rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;fillColor=#f5f5f5;" vertex="1" parent="1"><mxGeometry x="80" y="60" width="320" height="200" as="geometry"/></mxCell>
<mxCell id="api" value="API 网关" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="box"><mxGeometry x="20" y="50" width="130" height="50" as="geometry"/></mxCell>
<mxCell id="db" value="订单库" style="shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#e1d5e7;" vertex="1" parent="box"><mxGeometry x="170" y="120" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="u" value="用户" style="ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;" vertex="1" parent="1"><mxGeometry x="480" y="90" width="110" height="60" as="geometry"/></mxCell>
<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;dashed=1;strokeColor=#dc2626;endArrow=open;" edge="1" parent="1" source="u" target="api"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="460" y="200"/></Array></mxGeometry></mxCell>
<mxCell id="e2" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="api" target="db"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`;

const { page, teardown } = await openApp({ storage: { 'oa.fmt': 'drawio' } });
const r = createReporter();
try {
  await page.waitForSelector('.canvas.board', { timeout: 20000 });
  await sleep(500);
  await page.setInputFiles('input[data-role="attach"]', { name: '架构.drawio', mimeType: 'application/xml', buffer: Buffer.from(DRAWIO, 'utf8') });
  await sleep(1200);

  const st = await page.evaluate(() => ({
    nodes: document.querySelectorAll('.bnode').length,
    labels: [...document.querySelectorAll('.bnode-label')].map((el) => el.textContent),
    tops: document.querySelectorAll('.bnode-label.top').length,
    saved: (() => { try { return JSON.parse(localStorage.getItem('oa.board') ?? '{}'); } catch { return {}; } })(),
  }));
  r.ok('导入渲染 4 节点', st.nodes === 4, `实际 ${st.nodes}`);
  r.ok('容器标签贴顶(verticalAlign=top 保真)', st.tops >= 1);
  r.ok('标签齐全', ['服务集群', 'API 网关', '订单库', '用户'].every((w) => st.labels.some((l) => l?.includes(w))), st.labels.join('|'));
  const api = (st.saved.nodes ?? []).find((n) => n.id === 'api');
  r.ok('容器相对坐标已换算为绝对(api: 80+20=100, 60+50=110)', api && api.x === 100 && api.y === 110, JSON.stringify(api && { x: api.x, y: api.y }));
  const e1 = (st.saved.edges ?? []).find((e) => e.id === 'e1');
  r.ok('边样式保真(虚线/红色/open 箭头/航点)', e1 && e1.dash === true && e1.color === '#dc2626' && e1.arrow === 'open' && e1.points?.length === 1, JSON.stringify(e1));

  // 导出 → 捕获下载 → 再解析比对
  const dlP = page.waitForEvent('download', { timeout: 15000 });
  dlP.catch(() => {});
  await page.locator('.board-export').click();
  const dl = await dlP;
  r.ok('导出文件名 .otterpatch.drawio', /\.otterpatch\.drawio$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const { readFileSync } = await import('node:fs');
  const xml = readFileSync(await dl.path(), 'utf8');
  r.ok('导出为标准 mxfile/mxGraphModel', /<mxfile[\s\S]*<mxGraphModel[\s\S]*<\/mxfile>/.test(xml));
  r.ok('节点 id/value/style 保真(cylinder3 仍在)', xml.includes('id="db"') && xml.includes('cylinder3') && xml.includes('订单库'));
  r.ok('边保真(dashed=1 + strokeColor + 航点)', /id="e1"[^>]*style="[^"]*dashed=1/.test(xml) && xml.includes('strokeColor=#dc2626') && /<mxPoint x="460" y="200"\/>/.test(xml));
  r.ok('连线端点保真(source/target)', /source="u" target="api"/.test(xml) && /source="api" target="db"/.test(xml));
} catch (e) {
  console.log('SCRIPT_ERROR:', e.message);
} finally {
  const fails = r.done();
  await teardown();
  process.exit(fails ? 1 : 0);
}
