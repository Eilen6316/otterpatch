import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOARD_STORAGE_KEY,
  buildBoardSelection,
  loadBoardStore,
  parseBoardStore,
  sanitizeBoardPage,
  saveBoardStore,
} from './drawio-board-state.js';
import type { BEdge, BNode } from './drawio-geometry.js';

const node = (id: string, label = id): BNode => ({ id, x: 10, y: 20, w: 80, h: 40, inner: '<rect/>', label });

test('board state sanitizes SVG, unknown shapes, duplicates, and dangling edges', () => {
  const page = sanitizeBoardPage({
    name: ' Main ',
    nodes: [
      { ...node('a'), inner: '<script>alert(1)</script>', shape: 'not-a-shape' },
      node('a', 'duplicate'),
      { ...node('bad'), w: Number.NaN },
      node('b'),
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', style: 'ortho' },
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'dangling', from: 'a', to: 'missing' },
    ],
  });

  assert.equal(page.name, 'Main');
  assert.deepEqual(page.nodes.map((item) => item.id), ['a', 'b']);
  assert.equal(page.nodes[0]!.inner, '<rect x="4" y="5" width="32" height="20"/>');
  assert.equal(page.nodes[0]!.shape, undefined);
  assert.deepEqual(page.edges.map((edge) => edge.id), ['e1']);
});

test('board state migrates legacy storage and clamps the active page', () => {
  const legacy = parseBoardStore(JSON.stringify({ nodes: [node('a')], edges: [] }));
  assert.equal(legacy.pages.length, 1);
  assert.equal(legacy.pages[0]!.nodes[0]!.id, 'a');

  const modern = parseBoardStore(JSON.stringify({
    pages: [{ name: 'One', nodes: [node('a')], edges: [] }, { name: 'Two', nodes: [node('b')], edges: [] }],
    cur: 99,
  }));
  assert.equal(modern.cur, 1);
  assert.equal(modern.pages[1]!.name, 'Two');
  assert.deepEqual(parseBoardStore('{broken'), { pages: [{ name: 'Page-1', nodes: [], edges: [] }], cur: 0 });
});

test('board storage round-trips and tolerates unavailable storage', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  saveBoardStore(storage, ['Page-A'], [{ nodes: [node('a')], edges: [] }], 0);
  assert.ok(values.has(BOARD_STORAGE_KEY));
  assert.equal(loadBoardStore(storage).pages[0]!.nodes[0]!.id, 'a');
  assert.doesNotThrow(() => saveBoardStore({ setItem: () => { throw new Error('quota'); } }, ['Page-A'], [], 0));
  assert.deepEqual(loadBoardStore({ getItem: () => { throw new Error('blocked'); } }), { pages: [{ name: 'Page-1', nodes: [], edges: [] }], cur: 0 });
});

test('board selection projects real ids, topology, and valid selection state', () => {
  const nodes = [node('a', 'Start'), node('b', 'End')];
  const edges: BEdge[] = [{ id: 'e1', from: 'a', to: 'b' }];
  const selected = buildBoardSelection(nodes, edges, new Set(['b']), null)!;
  assert.equal(selected.count, 1);
  assert.match(selected.chip, /End/);
  assert.match(selected.context, /a=Start、b=End/);
  assert.match(selected.context, /a→b/);
  assert.deepEqual(selected.board.edges, [{ id: 'e1', source: 'a', target: 'b' }]);

  const selectedEdge = buildBoardSelection(nodes, edges, new Set(), 'e1')!;
  assert.equal(selectedEdge.chip, '选中 1 条连线');
  assert.match(selectedEdge.context, /当前选中连线: a→b/);
  assert.equal(buildBoardSelection(nodes, edges, new Set(), 'missing')!.chip, '流程图 2 节点 · 1 连线');
  assert.equal(buildBoardSelection([], [], new Set(), null), null);
});
