import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEditsToModel } from './mxgraph.js';

const MODEL =
  '<mxGraphModel><root>' +
  '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="2" value="A" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>' +
  '<mxCell id="3" value="B" vertex="1" parent="1"><mxGeometry x="240" y="40" width="120" height="60" as="geometry"/></mxCell>' +
  '<mxCell id="e1" edge="1" source="2" target="3" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>' +
  '</root></mxGraphModel>';

test('setProps: 按 id 改 value/style,其它不动', () => {
  const out = applyEditsToModel(MODEL, [
    { cellId: '2', op: { kind: 'setProps', props: { value: '利润', style: 'rounded=1;' } } },
  ]);
  assert.match(out, /id="2"[^>]*value="利润"/);
  assert.match(out, /id="2"[^>]*style="rounded=1;"/);
  assert.match(out, /id="3"[^>]*value="B"/);
});

test('move: 改 geometry x/y', () => {
  const out = applyEditsToModel(MODEL, [{ cellId: '2', op: { kind: 'move', box: { x: 80, y: 100 } } }]);
  assert.match(out, /id="2"[\s\S]*?<mxGeometry x="80" y="100"/);
});

test('add: 追加新节点', () => {
  const out = applyEditsToModel(MODEL, [
    { cellId: '', op: { kind: 'add', spec: { id: '4', value: 'C', vertex: true, parent: '1', geometry: { x: 40, y: 200, width: 120, height: 60 } } } },
  ]);
  assert.match(out, /id="4"[^>]*value="C"/);
  assert.match(out, /id="4"[\s\S]*?<mxGeometry x="40" y="200"/);
});

test('delete: 级联删引用它的边', () => {
  const out = applyEditsToModel(MODEL, [{ cellId: '2', op: { kind: 'delete' } }]);
  assert.doesNotMatch(out, /id="2"/);
  assert.doesNotMatch(out, /id="e1"/);
  assert.match(out, /id="3"/);
});

test('特殊字符转义', () => {
  const out = applyEditsToModel(MODEL, [{ cellId: '3', op: { kind: 'setProps', props: { value: 'a<b&c"' } } }]);
  assert.match(out, /id="3"[^>]*value="a&lt;b&amp;c&quot;"/);
});
