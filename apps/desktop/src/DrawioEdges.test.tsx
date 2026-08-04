import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DrawioEdgeLayer, DrawioEdgeToolbar, routeBoardEdges } from './DrawioEdges.js';
import type { BEdge, BNode } from './drawio-geometry.js';

const nodes: BNode[] = [
  { id: 'a', x: 0, y: 0, w: 80, h: 40, inner: '', label: 'A' },
  { id: 'b', x: 200, y: 100, w: 80, h: 40, inner: '', label: 'B' },
];

test('Drawio edge routing drops dangling edges and separates shared lanes', () => {
  const edges: BEdge[] = [
    { id: 'e1', from: 'a', to: 'b' },
    { id: 'e2', from: 'a', to: 'b' },
    { id: 'dangling', from: 'a', to: 'missing' },
  ];
  const routed = routeBoardEdges(nodes, edges);
  assert.deepEqual(routed.map(({ edge }) => edge.id), ['e1', 'e2']);
  assert.notDeepEqual(routed[0]!.points, routed[1]!.points);
  assert.ok(routed.every(({ path }) => path.startsWith('M ')));
});

test('Drawio edge layer renders paths, labels, connection preview, and guides', () => {
  const markup = renderToStaticMarkup(
    <svg>
      <DrawioEdgeLayer
        nodes={nodes}
        edges={[{ id: 'e1', from: 'a', to: 'b', label: 'flow' }]}
        selectedEdgeId="e1"
        connection={{ from: 'a', x: 150, y: 50, tgt: null }}
        guides={{ v: [100], h: [80] }}
        onSelect={() => {}}
      />
    </svg>,
  );
  assert.match(markup, />flow<\/text>/);
  assert.match(markup, /stroke="var\(--accent\)"/);
  assert.match(markup, /x1="100" y1="0" x2="100" y2="6000"/);
  assert.match(markup, /x1="0" y1="80" x2="6000" y2="80"/);
});

test('Drawio edge toolbar exposes every edge formatting command', () => {
  const markup = renderToStaticMarkup(
    <DrawioEdgeToolbar
      nodes={nodes}
      edge={{ id: 'e1', from: 'a', to: 'b' }}
      zoom={1}
      pan={{ x: 0, y: 0 }}
      onChange={() => {}}
    />,
  );
  assert.equal((markup.match(/<button/g) ?? []).length, 15);
  assert.match(markup, /title="正交"/);
  assert.match(markup, /title="标签"/);
  assert.match(markup, /title="箭头 none"/);
});
