import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DrawioNodeLayer, isContainerNode } from './DrawioNodes.js';
import type { BNode } from './drawio-geometry.js';

const node = (id: string, patch: Partial<BNode> = {}): BNode => ({ id, x: 0, y: 0, w: 100, h: 60, inner: '<rect/>', label: id, ...patch });
const handlers = {
  onNodeStart: () => {},
  onEditStart: () => {},
  onLabelCommit: () => {},
  onPortStart: () => {},
  onResizeStart: () => {},
  onRotateStart: () => {},
  onArrowStart: () => {},
};

test('Drawio node containment requires a meaningfully smaller enclosed node', () => {
  const container = node('container', { w: 300, h: 200 });
  const child = node('child', { x: 30, y: 30, w: 80, h: 40 });
  assert.equal(isContainerNode(container, [container, child]), true);
  assert.equal(isContainerNode(child, [container, child]), false);
  assert.equal(isContainerNode(node('explicit', { vTop: true }), []), true);
});

test('Drawio node layer renders shapes, labels, ports, and single-selection handles', () => {
  const markup = renderToStaticMarkup(
    <DrawioNodeLayer
      nodes={[node('selected', { shape: 'ellipse', label: 'Selected' })]}
      selectedIds={new Set(['selected'])}
      targetNodeId="selected"
      highlightedId="selected"
      editingId={null}
      portsEnabled
      quickConnectEnabled
      {...handlers}
    />,
  );
  assert.match(markup, /class="bnode sel tgt hi"/);
  assert.match(markup, /<ellipse/);
  assert.match(markup, />Selected<\/span>/);
  assert.equal((markup.match(/class="bport"/g) ?? []).length, 4);
  assert.equal((markup.match(/class="bhandle/g) ?? []).length, 8);
  assert.match(markup, /class="brot"/);
});

test('Drawio node layer renders the controlled label editor', () => {
  const markup = renderToStaticMarkup(
    <DrawioNodeLayer
      nodes={[node('editing', { label: 'Draft' })]}
      selectedIds={new Set()}
      targetNodeId={null}
      highlightedId={null}
      editingId="editing"
      portsEnabled={false}
      quickConnectEnabled={false}
      {...handlers}
    />,
  );
  assert.match(markup, /class="bnode-edit"/);
  assert.match(markup, /value="Draft"/);
  assert.doesNotMatch(markup, /class="bnode-label/);
});
