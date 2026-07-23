/**
 * Word structured-table lifecycle (mock /propose-stream): native table rendering,
 * structured context, diff modes, refresh-safe rejection, and acceptance flattening.
 */
import { openApp, sleep } from './harness.mjs';

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.apiKey': 'test-key', 'oa.server': 'http://localhost:4319' } });
let pass = 0, fail = 0;
const ok = (name, condition, extra = '') => {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name, extra); }
};

const proposal = (changeSetId, rows) => ({
  diff: {
    changeSetId,
    hostId: 'h',
    intent: '插入真实对照表',
    items: [{ editId: 'e0', ref: '文档末尾', kind: 'insertTable', badge: 'add', label: `插入 ${rows.length}×${rows[0].length} 表格`, after: `${rows.length}×${rows[0].length} 表格` }],
  },
  changeSet: {
    edits: [{ id: 'e0', target: 'a0', op: { family: 'structure', kind: 'insertTable', rows, headerRows: 1, at: 'end' } }],
    anchors: { a0: { portable: { kind: 'flow', path: [], quote: { text: '' } } } },
  },
});

const first = proposal('csTable1', [
  ['字段', '说明', '状态'],
  ['目标', '形成真实表格', '完成'],
  ['审阅', '逐条接受或拒绝', '待确认'],
]);
const second = proposal('csTable2', [
  ['方案', '负责人'],
  ['结构化表格', 'OtterPatch'],
]);
const requests = [];
let hit = 0;

try {
  await page.route('**/propose-stream', (route) => {
    requests.push(route.request().postData() || '');
    hit++;
    const event = hit === 1
      ? { type: 'done', kind: 'changeset', diff: first.diff, changeSet: first.changeSet }
      : hit === 2
        ? { type: 'done', kind: 'answer', text: '上下文已读取。' }
        : { type: 'done', kind: 'changeset', diff: second.diff, changeSet: second.changeSet };
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify(event)}\n\n` });
  });

  await page.waitForSelector('.rd-page');
  await sleep(350);
  await page.locator('.composer textarea').fill('插入字段对照表');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('table.rd-tbl.rd-chg-blkins[data-cid="csTable1::e0"]', { timeout: 8000 });
  await sleep(350);

  ok('Agent 产物是原生 table,不是竖线文本', await page.evaluate(() => {
    const table = document.querySelector('table.rd-tbl[data-cid="csTable1::e0"]');
    const pseudo = [...document.querySelectorAll('.rd-page p')].some((p) => /^\s*\|.+\|\s*$/.test(p.textContent || ''));
    return !!table && !pseudo;
  }));
  ok('表头与二维单元格完整渲染', await page.evaluate(() => {
    const table = document.querySelector('table[data-cid="csTable1::e0"]');
    return table?.querySelectorAll('th').length === 3 && table.querySelectorAll('tr').length === 3 && table.querySelectorAll('td').length === 6;
  }));
  ok('表格作为单一结构修订计数', await page.evaluate(() => document.querySelectorAll('.rd-page [data-cid="csTable1::e0"]').length === 1));
  ok('审阅区显示尺寸与二维预览', await page.evaluate(() => {
    const preview = document.querySelector('.gd-table-preview');
    return !!preview && /3\s*×\s*3/.test(preview.textContent || '') && preview.querySelectorAll('th').length === 3;
  }));

  await page.locator('.rd-difftoggle .rd-dt-seg', { hasText: '原文' }).click();
  await sleep(180);
  ok('原文视图隐藏整张插入表格', await page.evaluate(() => getComputedStyle(document.querySelector('table[data-cid="csTable1::e0"]')).display === 'none'));
  await page.locator('.rd-difftoggle .rd-dt-seg', { hasText: '修订' }).click();
  await sleep(180);
  ok('修订视图恢复整张表格', await page.evaluate(() => getComputedStyle(document.querySelector('table[data-cid="csTable1::e0"]')).display === 'table'));

  // A second request captures the table through the real RichDoc context/snapshot path.
  await page.locator('.composer textarea').fill('读取当前表格结构');
  await page.locator('.composer textarea').press('Enter');
  await sleep(550);
  let request = {};
  try { request = JSON.parse(requests[1] || '{}'); } catch { request = {}; }
  const tableBlocks = request.doc?.blocks?.filter((block) => block.style === '表格') || [];
  ok('模型上下文把顶层表格计为一个块', tableBlocks.length === 1);
  ok('模型上下文保留 rows 二维边界', /\[表格 3×3,rows=\[\["字段","说明","状态"\]/.test(request.context || '') && /rows=\[\["字段","说明","状态"\]/.test(tableBlocks[0]?.text || ''));
  ok('上下文没有把单元格无分隔拼接', !(request.context || '').includes('字段说明状态'));

  // Persist unresolved markup, reload (undoMap is gone), then reject through the inline card.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('table[data-cid="csTable1::e0"]');
  await sleep(450);
  ok('刷新后结构修订元数据仍在', await page.evaluate(() => {
    const table = document.querySelector('table[data-cid="csTable1::e0"]');
    return table?.hasAttribute('data-edit-block') && table.classList.contains('rd-chg-blkins');
  }));
  await page.locator('table[data-cid="csTable1::e0"]').hover();
  await sleep(320);
  await page.locator('.rd-cbtn.no').click();
  await sleep(350);
  ok('刷新后拒绝会物理移除插入表格', await page.evaluate(() => !document.querySelector('table[data-cid="csTable1::e0"]') && !document.querySelector('.rd-page table')));

  // Propose again and accept: the revision shell disappears while the real table remains editable.
  // API keys intentionally live in memory only, so a reload requires re-entry.
  await page.locator('.composer .model').click();
  await page.locator('[data-role="provider-api-key"]').fill('test-key');
  await page.locator('.composer .model').click();
  await page.locator('.composer textarea').fill('重新插入精简对照表');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('table[data-cid="csTable2::e0"]', { timeout: 8000 });
  await page.locator('.reviewbox').last().locator('.rv-acts .btn.ok').click();
  await sleep(350);
  ok('接受后保留真实表格并剥净修订壳', await page.evaluate(() => {
    const table = document.querySelector('.rd-page table.rd-tbl');
    return !!table && !table.hasAttribute('data-cid') && !table.hasAttribute('contenteditable') && !table.classList.contains('rd-chg-blkins') && /结构化表格/.test(table.textContent || '');
  }));
  ok('结构修订接受/拒绝均归入 structure telemetry', await page.evaluate(() => {
    const telemetry = JSON.parse(localStorage.getItem('oa.telemetry') || '{}');
    return telemetry.word?.structure?.accept >= 1 && telemetry.word?.structure?.reject >= 1;
  }));

  ok('无控制台报错', errors.length === 0, errors.join(' | '));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (error) {
  console.log('SCRIPT_ERROR:', error.message);
  fail++;
} finally {
  await teardown();
}

process.exit(fail);
