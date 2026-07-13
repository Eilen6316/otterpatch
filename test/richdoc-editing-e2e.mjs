/** Browser contract for block-level Agent formatting through the extracted edit engine. */
import { openApp, sleep } from './harness.mjs';

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.apiKey': 'test-key', 'oa.server': 'http://localhost:4319' } });
let pass = 0, fail = 0;
const ok = (name, condition) => {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name); }
};

const style = { align: 'center', block: 'h3' };
const response = {
  diff: {
    changeSetId: 'cs-block-format',
    hostId: 'h',
    intent: '调整下周计划标题',
    items: [{ editId: 'e0', ref: '下周计划', badge: 'modify', label: '标题改为三级并居中', after: '标题3 · 居中', style }],
  },
  changeSet: {
    edits: [{ id: 'e0', target: 'a0', op: { family: 'style', kind: 'setStyle', style } }],
    anchors: { a0: { portable: { kind: 'flow', quote: { text: '下周计划' } } } },
  },
};

try {
  await page.route('**/propose-stream', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ type: 'done', kind: 'changeset', ...response })}\n\n`,
  }));
  await page.waitForSelector('.rd-page');
  await sleep(300);
  await page.locator('.composer textarea').fill('把下周计划改成三级标题并居中');
  await page.locator('.composer textarea').press('Enter');
  await page.waitForSelector('.reviewbox', { timeout: 8000 });
  await sleep(350);

  ok('block format changes the tag and alignment', await page.evaluate(() => {
    const heading = [...document.querySelectorAll('.rd-page h3')].find((element) => element.textContent === '下周计划');
    return heading?.getAttribute('data-edit-block') === 'cs-block-format::e0' && heading.style.textAlign === 'center';
  }));
  const toggleState = await page.evaluate(() => ({
    visible: !!document.querySelector('.rd-difftoggle'),
    count: document.querySelector('.rd-dt-count')?.textContent?.trim() ?? null,
    marks: document.querySelectorAll('.rd-page [data-cid]').length,
  }));
  const toggleCounted = toggleState.visible && toggleState.count === '1/1' && toggleState.marks === 1;
  ok('block-only edit refreshes the review toggle and count', toggleCounted);
  if (!toggleCounted) console.log('    toggle state:', JSON.stringify(toggleState));

  await page.locator('.reviewbox .btn.no').click();
  await sleep(350);
  ok('reject restores the original block snapshot', await page.evaluate(() => {
    const heading = [...document.querySelectorAll('.rd-page h2')].find((element) => element.textContent === '下周计划');
    return !!heading && heading.style.textAlign !== 'center' && !document.querySelector('.rd-page [data-cid="cs-block-format::e0"]');
  }));
  ok('reject removes the document diff toggle', await page.evaluate(() => !document.querySelector('.rd-difftoggle')));
  ok('no console errors', errors.length === 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (error) {
  console.log('SCRIPT_ERROR:', error.message);
  fail++;
} finally {
  await teardown();
}

process.exit(fail);
