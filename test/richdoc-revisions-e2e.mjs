/** Browser contract for accepting, reverting, and closing RichDoc revision undo windows. */
import { openApp, sleep } from './harness.mjs';

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.apiKey': 'test-key', 'oa.server': 'http://localhost:4319' } });
let pass = 0, fail = 0;
const ok = (name, condition) => {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name); }
};

const noteQuote = '备注:本文档为演示数据';
const riskQuote = '风险与问题:大模型在超长输出时偶发截断';
const first = {
  diff: {
    changeSetId: 'cs-revisions', hostId: 'h', intent: '改写、插表并删除备注',
    items: [
      { editId: 'text', ref: '整体进度符合预期。', badge: 'modify', label: '更新进度', after: '整体进度显著提前。' },
      { editId: 'table', ref: '文档末尾', kind: 'insertTable', badge: 'add', label: '插入状态表', after: '2×2 表格' },
      { editId: 'remove', ref: noteQuote, badge: 'remove', label: '删除备注', after: '' },
    ],
  },
  changeSet: {
    edits: [
      { id: 'text', target: 'a0', op: { family: 'text', kind: 'replaceText', text: '整体进度显著提前。' } },
      { id: 'table', target: 'a1', op: { family: 'structure', kind: 'insertTable', rows: [['项目', '状态'], ['进度', '提前']], headerRows: 1, at: 'end' } },
      { id: 'remove', target: 'a2', op: { family: 'structure', kind: 'deleteRange' } },
    ],
    anchors: {
      a0: { portable: { kind: 'flow', quote: { text: '整体进度符合预期。' } } },
      a1: { portable: { kind: 'flow', quote: { text: '' } } },
      a2: { portable: { kind: 'flow', quote: { text: noteQuote } } },
    },
  },
};

const second = {
  diff: {
    changeSetId: 'cs-close-window', hostId: 'h', intent: '更新进度并删除风险段',
    items: [
      { editId: 'text', ref: '整体进度符合预期。', badge: 'modify', label: '稳定进度', after: '整体进度保持稳定。' },
      { editId: 'remove', ref: riskQuote, badge: 'remove', label: '删除风险段', after: '' },
    ],
  },
  changeSet: {
    edits: [
      { id: 'text', target: 'b0', op: { family: 'text', kind: 'replaceText', text: '整体进度保持稳定。' } },
      { id: 'remove', target: 'b1', op: { family: 'structure', kind: 'deleteRange' } },
    ],
    anchors: {
      b0: { portable: { kind: 'flow', quote: { text: '整体进度符合预期。' } } },
      b1: { portable: { kind: 'flow', quote: { text: riskQuote } } },
    },
  },
};

let requestCount = 0;
try {
  await page.route('**/propose-stream', (route) => {
    const proposal = requestCount++ === 0 ? first : second;
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'done', kind: 'changeset', ...proposal })}\n\n`,
    });
  });
  await page.waitForSelector('.rd-page');
  await sleep(300);

  await page.locator('.composer textarea').fill('更新进度、插入状态表并删除备注');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('.reviewbox', { timeout: 8000 });
  await page.locator('.reviewbox .rv-acts .btn.solid').click();
  await sleep(450);
  ok('accept-all flattens text, table, and paragraph deletion', await page.evaluate((note) => {
    const text = document.querySelector('.rd-page')?.textContent ?? '';
    return text.includes('整体进度显著提前。')
      && !text.includes('整体进度符合预期。')
      && !text.includes(note)
      && !!document.querySelector('.rd-page table.rd-tbl:not([data-cid])')
      && !document.querySelector('.rd-page [data-cid]');
  }, noteQuote));

  await page.locator('.reviewbox .rv-final .link-btn').click();
  await sleep(450);
  ok('turn undo restores accepted text and removed paragraph', await page.evaluate((note) => {
    const text = document.querySelector('.rd-page')?.textContent ?? '';
    return text.includes('整体进度符合预期。') && !text.includes('整体进度显著提前。') && text.includes(note);
  }, noteQuote));
  ok('turn undo removes the accepted table and all undo markers', await page.evaluate(() => {
    return !document.querySelector('.rd-page table')
      && !document.querySelector('.rd-page [data-cid], .rd-page [data-undo]')
      && !document.querySelector('.rd-difftoggle');
  }));

  await page.locator('.composer textarea').fill('更新进度并删除风险段');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('.reviewbox .rv-acts .btn.ok', { timeout: 8000 });
  await page.locator('.reviewbox').last().locator('.rv-acts .btn.ok').click();
  await sleep(300);
  ok('partial acceptance keeps one undo entry and one pending deletion', await page.evaluate(() => {
    return !!document.querySelector('.rd-page [data-undo="cs-close-window::text"]')
      && !!document.querySelector('.rd-page [data-cid="cs-close-window::remove"]')
      && !!document.querySelector('.rd-difftoggle');
  }));

  await page.locator('.convo-new').click();
  await sleep(350);
  ok('new conversation closes the undo window and finalizes the pending deletion', await page.evaluate((risk) => {
    const text = document.querySelector('.rd-page')?.textContent ?? '';
    return text.includes('整体进度保持稳定。')
      && !text.includes(risk)
      && !document.querySelector('.rd-page [data-cid], .rd-page [data-undo]');
  }, riskQuote));
  ok('closing the final pending deletion refreshes the diff toggle', await page.evaluate(() => !document.querySelector('.rd-difftoggle')));
  ok('no console errors', errors.length === 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (error) {
  console.log('SCRIPT_ERROR:', error.message);
  fail++;
} finally {
  await teardown();
}

process.exit(fail);
