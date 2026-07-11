/** Browser-level contract for the extracted RichDoc projection/sanitizer module. */
import { openApp, sleep } from './harness.mjs';

const maliciousHtml = `
  <p id="kept">Safe text</p>
  <unknown-wrapper>
    <img id="nested-image" src="x" onerror="window.__richdocXss = 1">
    <a id="nested-link" href="javascript:window.__richdocXss = 2">bad link</a>
  </unknown-wrapper>
  <script>window.__richdocXss = 3</script>
  <p id="bad-style" style="background:url(javascript:window.__richdocXss=4)">styled</p>
  <span id="revision" class="rd-chg" data-cid="cs::e0" data-edit="cs::e0" data-kind="replace" tabindex="0" contenteditable="false" aria-label="replace"><del>old</del><ins>new</ins></span>
  <a id="https-link" href="https://example.com/doc">safe link</a>
`;

const { page, errors, teardown } = await openApp({ storage: { 'oa.fmt': 'word', 'oa.richdoc': maliciousHtml } });
let pass = 0, fail = 0;
const ok = (name, condition) => {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL', name); }
};

try {
  await page.waitForSelector('.rd-page');
  await sleep(350);

  ok('unknown/script wrappers cannot execute', await page.evaluate(() => {
    return window.__richdocXss === undefined && !document.querySelector('.rd-page script, .rd-page unknown-wrapper');
  }));
  ok('unwrapped descendants are sanitized recursively', await page.evaluate(() => {
    const image = document.querySelector('#nested-image');
    const link = document.querySelector('#nested-link');
    return !!image && !image.hasAttribute('onerror') && !image.hasAttribute('src') && !!link && !link.hasAttribute('href');
  }));
  ok('active CSS is removed', await page.evaluate(() => !document.querySelector('#bad-style')?.hasAttribute('style')));
  ok('review metadata survives sanitization', await page.evaluate(() => {
    const revision = document.querySelector('#revision');
    return revision?.getAttribute('data-cid') === 'cs::e0'
      && revision.getAttribute('data-edit') === 'cs::e0'
      && revision.getAttribute('data-kind') === 'replace'
      && revision.getAttribute('contenteditable') === 'false'
      && revision.querySelector('del')?.textContent === 'old'
      && revision.querySelector('ins')?.textContent === 'new';
  }));
  ok('safe HTTPS links remain available', await page.evaluate(() => document.querySelector('#https-link')?.getAttribute('href') === 'https://example.com/doc'));
  ok('safe text content remains intact', await page.evaluate(() => /Safe text/.test(document.querySelector('.rd-page')?.textContent || '')));
  ok('无控制台报错', errors.length === 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (error) {
  console.log('SCRIPT_ERROR:', error.message);
  fail++;
} finally {
  await teardown();
}

process.exit(fail);
