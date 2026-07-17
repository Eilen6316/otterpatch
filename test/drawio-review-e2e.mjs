/** Drawio review regression: deleting a node must restore its connected edge on reject/original view. */
import { createReporter, openApp, sleep } from './harness.mjs';

const initialBoard = {
  pages: [{
    name: 'Page-1',
    nodes: [
      { id: 'keep-node', x: 80, y: 100, w: 120, h: 50, inner: '<rect/>', label: 'Keep' },
      { id: 'delete-node', x: 320, y: 100, w: 120, h: 50, inner: '<rect/>', label: 'Delete' },
    ],
    edges: [{ id: 'connected-edge', from: 'keep-node', to: 'delete-node', arrow: 'classic', style: 'ortho' }],
  }],
  cur: 0,
};
const diff = {
  changeSetId: 'drawio-review',
  hostId: 'drawio',
  intent: 'Delete one connected node',
  items: [{ editId: 'delete-edit', ref: 'delete-node', badge: 'remove', label: 'Delete connected node' }],
};
const changeSet = {
  edits: [{ id: 'delete-edit', target: 'delete-anchor', op: { family: 'object', kind: 'deleteObject' } }],
  anchors: { 'delete-anchor': { portable: { kind: 'object', elementId: 'delete-node' } } },
};

const sse = `data: ${JSON.stringify({ type: 'done', kind: 'changeset', diff, changeSet })}\n\n`;
const { page, errors, teardown } = await openApp({
  storage: {
    'oa.fmt': 'drawio',
    'oa.apiKey': 'test-key',
    'oa.server': 'http://localhost:4319',
    'oa.board': JSON.stringify(initialBoard),
  },
});
const reporter = createReporter();

const currentBoard = () => page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('oa.board') ?? '{}');
  return saved.pages?.[saved.cur ?? 0] ?? { nodes: [], edges: [] };
});
const hasCounts = async (nodes, edges) => {
  const board = await currentBoard();
  return board.nodes.length === nodes && board.edges.length === edges;
};
const waitForCounts = async (nodes, edges, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasCounts(nodes, edges)) return true;
    await sleep(100);
  }
  return hasCounts(nodes, edges);
};

try {
  await page.route('**/propose-stream', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: sse,
  }));
  await page.waitForSelector('.canvas.board', { timeout: 20000 });
  await sleep(500);

  await page.locator('.composer textarea').fill('Delete the connected node');
  await page.locator('.composer .send').click();
  await page.waitForSelector('.reviewbox', { timeout: 8000 });
  await sleep(500);

  reporter.ok('proposal deletion removes the node and its connected edge', await waitForCounts(1, 0));

  await page.locator('.board-difftoggle .rd-dt-seg').first().click();
  await sleep(500);
  reporter.ok('original view restores the node and connected edge', await waitForCounts(2, 1));

  await page.locator('.board-difftoggle .rd-dt-seg').last().click();
  await sleep(500);
  reporter.ok('final view reapplies cascading deletion', await waitForCounts(1, 0));

  await page.locator('.reviewbox .rv-acts .btn.no').click();
  await sleep(500);
  reporter.ok('reject restores the node and connected edge', await waitForCounts(2, 1));

  await page.locator('.reviewbox .rv-acts.done .btn.solid').click();
  await sleep(500);
  reporter.ok('accept all reapplies deletion after rejection', await waitForCounts(1, 0));
  reporter.ok('accepted turn reaches its final state', await page.locator('.reviewbox .rv-final.ok').count() === 1);
  reporter.ok('no console errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  console.log('SCRIPT_ERROR:', error.message);
  reporter.ok('script completed', false);
} finally {
  await teardown();
}

process.exit(reporter.done());
