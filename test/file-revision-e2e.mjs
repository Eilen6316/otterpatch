/** Browser contract: imported bytes bind proposal SHA-256, revision, and document identity. */
import { createHash } from 'node:crypto';
import { createReporter, openApp, sleep } from './harness.mjs';

const xml = '<mxfile><diagram id="d"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Before" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
const bytes = Buffer.from(xml, 'utf8');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const revision = Number.parseInt(sha256.slice(0, 13), 16);
const documentId = `drawio:sha256:${sha256}`;
let requestBody;

const { page, errors, teardown } = await openApp({
  storage: {
    'oa.fmt': 'drawio',
    'oa.apiKey': 'test-key',
    'oa.server': 'http://localhost:4319',
  },
});
const reporter = createReporter();

try {
  await page.route('**/propose-stream', (route) => {
    requestBody = route.request().postDataJSON();
    const diff = {
      changeSetId: 'bound-drawio',
      hostId: 'serve',
      intent: 'rename node',
      items: [{ editId: 'e1', ref: '2', badge: 'modify', label: 'Rename', risk: { level: 'safe', reasons: [] } }],
    };
    const changeSet = {
      id: 'bound-drawio',
      hostId: 'serve',
      baseRev: requestBody.baseRev,
      origin: { by: 'agent', sessionId: 'test' },
      meta: { intent: 'rename node' },
      anchors: {
        a1: { id: 'a1', hostId: 'serve', kind: 'object', ref: null, baseRev: requestBody.baseRev, portable: { kind: 'object', slide: 0, elementId: '2' } },
      },
      edits: [{ id: 'e1', target: 'a1', op: { family: 'object', kind: 'setObjectProps', props: { value: 'After' } } }],
    };
    const proposal = {
      version: 1,
      proposalId: 'proposal',
      format: 'drawio',
      sourceFileSha256: requestBody.sourceFileSha256,
      baseRev: requestBody.baseRev,
      documentId: requestBody.documentId,
    };
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'done', kind: 'changeset', diff, changeSet, proposal })}\n\n`,
    });
  });

  await page.locator('input[data-role="attach"]').setInputFiles({
    name: 'bound.drawio',
    mimeType: 'application/xml',
    buffer: bytes,
  });
  await page.waitForFunction(() => document.querySelector('.composer .plus')?.getAttribute('title') === 'bound.drawio');

  await page.locator('.composer textarea').fill('Rename the node');
  await page.locator('.composer .send').click();
  await page.waitForSelector('.reviewbox', { timeout: 8000 });
  await sleep(250);

  reporter.ok('proposal request carries the exact source SHA-256', requestBody?.sourceFileSha256 === sha256);
  reporter.ok('baseRev is derived from the source SHA-256', requestBody?.baseRev === revision);
  reporter.ok('document identity is content-bound', requestBody?.documentId === documentId);
  reporter.ok('matching bound proposal enters review', await page.locator('.reviewbox').count() === 1);
  reporter.ok('no console errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  console.log('SCRIPT_ERROR:', error.message);
  reporter.ok('script completed', false);
} finally {
  await teardown();
}

process.exit(reporter.done());
