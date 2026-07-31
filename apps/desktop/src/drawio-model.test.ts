import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanLabel,
  extractDrawioOps,
  innerForStyle,
  makeRawBoardConv,
  parseDrawioStyle,
} from './drawio-model.js';

test('drawio model sanitizes labels and parses only supported style fields', () => {
  assert.equal(cleanLabel('<b>Node</b><br/>Next'), 'Node · Next');
  assert.equal(innerForStyle('shape=ellipse;'), '<ellipse cx="20" cy="15" rx="16" ry="11"/>');
  assert.deepEqual(parseDrawioStyle('fillColor=#fff;strokeColor=none;fontColor=#111;fontSize=13;fontStyle=1;container=1;whitespace=wrap;'), {
    fill: '#fff',
    fontColor: '#111',
    fontSize: 13,
    bold: true,
    vTop: true,
    wrap: true,
  });
});

test('drawio model extracts complete operations from a truncated stream', () => {
  const buffer = '{"ops":[{"op":"add","cellId":"n1","value":"A"},{"op":"add","cellId":"n2","value":"B"}';
  assert.deepEqual(extractDrawioOps(buffer), [
    { op: 'add', cellId: 'n1', value: 'A' },
    { op: 'add', cellId: 'n2', value: 'B' },
  ]);
  assert.deepEqual(extractDrawioOps('{"answer":"no ops"}'), []);
});

test('drawio model maps streamed objects with collision and parent handling', () => {
  const convert = makeRawBoardConv(3, (id) => id === 'container');
  const container = convert({ op: 'add', cellId: 'container', value: '<b>Group</b>', x: 100, y: 80, width: 240, height: 160, style: 'rounded=1;container=1;' }, 0);
  const child = convert({ op: 'add', cellId: 'child', parent: 'container', value: 'Child<br>Node', x: 20, y: 30, width: 80, height: 40, style: 'ellipse;fillColor=#fff;' }, 1);
  const edge = convert({ op: 'add', cellId: 'edge', edge: true, source: 'container', target: 'child', style: 'dashed=1;strokeColor=#2563eb;' }, 2);

  assert.equal(container?.node?.id, 'container_3_1');
  assert.equal(child?.node?.id, 'child');
  assert.equal(child?.node?.x, 120);
  assert.equal(child?.node?.y, 110);
  assert.equal(child?.node?.label, 'Child · Node');
  assert.deepEqual(edge?.edge, {
    id: 'edge',
    from: 'container_3_1',
    to: 'child',
    arrow: 'classic',
    style: 'ortho',
    dash: true,
    color: '#2563eb',
  });
});
