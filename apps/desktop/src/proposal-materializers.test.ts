import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countAddedBoardObjects,
  materializeAddedBoardObjects,
  materializeGridOps,
  materializeWordEdits,
  wordEditOpts,
  type AgentDiff,
} from './proposal-materializers.js';

const diff = (items: AgentDiff['items'], changeSetId = 'cs1'): AgentDiff => ({
  changeSetId,
  hostId: 'host',
  intent: 'test',
  items,
});

test('materializeWordEdits maps text, style, delete, and image operations in diff order', () => {
  const result = materializeWordEdits(
    diff([
      { editId: 'text', ref: 'fallback', badge: 'modify', label: 'rewrite', after: 'diff fallback' },
      { editId: 'style', ref: 'heading', badge: 'modify', label: 'bold' },
      { editId: 'delete', ref: 'paragraph', badge: 'remove', label: 'delete' },
      { editId: 'image', ref: 'image', badge: 'modify', label: 'resize' },
    ]),
    {
      edits: [
        { id: 'image', target: 'a4', op: { kind: 'setObjectProps', props: { imgAction: 'resize', width: 320 } } },
        { id: 'delete', target: 'a3', op: { kind: 'deleteRange' } },
        { id: 'style', target: 'a2', op: { kind: 'setStyle', style: { bold: true } } },
        { id: 'text', target: 'a1', op: { kind: 'replaceText', text: 'replacement' } },
      ],
      anchors: {
        a1: { portable: { quote: { text: 'original' }, path: [4] } },
        a2: { portable: { quote: { text: 'title' } } },
        a3: { portable: { quote: { text: 'remove me' }, path: [8] } },
        a4: { portable: { path: [2] } },
      },
    },
  );

  assert.deepEqual(result, [
    { editId: 'text', domId: 'cs1::text', quote: 'original', blockIdx: 4, replacement: 'replacement' },
    { editId: 'style', domId: 'cs1::style', quote: 'title', style: { bold: true } },
    { editId: 'delete', domId: 'cs1::delete', quote: 'remove me', blockIdx: 8, remove: true },
    { editId: 'image', domId: 'cs1::image', quote: '', blockIdx: 2, img: { action: 'resize', width: 320 } },
  ]);
  assert.deepEqual(wordEditOpts(result[0]!), { replacement: 'replacement', blockIdx: 4 });
  assert.deepEqual(wordEditOpts(result[1]!), { fmt: { bold: true }, blockIdx: undefined });
  assert.deepEqual(wordEditOpts(result[2]!), { removeBlock: true, blockIdx: 8 });
  assert.deepEqual(wordEditOpts(result[3]!), { img: { action: 'resize', width: 320 }, blockIdx: 2 });
});

test('materializeWordEdits preserves structured Word table data and placement', () => {
  const result = materializeWordEdits(
    diff([{ editId: 'table', ref: 'Summary', kind: 'insertTable', badge: 'add', label: 'insert 2x2 table', after: '2x2 table' }]),
    {
      edits: [{ id: 'table', target: 'a1', op: { kind: 'insertTable', rows: [['Name', 'Value'], ['Alpha', '10']], headerRows: 1, at: 'after' } }],
      anchors: { a1: { portable: { quote: { text: 'Summary' }, path: [3] } } },
    },
  );

  assert.deepEqual(result, [{
    editId: 'table',
    domId: 'cs1::table',
    quote: 'Summary',
    blockIdx: 3,
    table: { rows: [['Name', 'Value'], ['Alpha', '10']], headerRows: 1, at: 'after' },
  }]);
  assert.deepEqual(wordEditOpts(result[0]!), {
    blockIdx: 3,
    table: { rows: [['Name', 'Value'], ['Alpha', '10']], headerRows: 1, at: 'after' },
  });
});

test('materializeGridOps separates cell values, styles, and structural operations', () => {
  const result = materializeGridOps(diff([
    { editId: 'value', ref: 'Sheet2!B3', badge: 'modify', label: 'set value', after: '42' },
    { editId: 'style', ref: 'C4', kind: 'setStyle', badge: 'modify', label: 'format', after: 'summary only', style: { bgColor: '#fee2e2', color: '#111827', bold: true, align: 'center', numberFormat: '0.00' } },
    { editId: 'empty-style', ref: 'D5', kind: 'setStyle', badge: 'modify', label: 'unknown style', after: 'must not become a value' },
    { editId: 'rows', ref: 'A2', kind: 'insertRows', badge: 'add', label: 'insert rows', after: '2 rows' },
  ]));

  assert.deepEqual(result, [
    { a1: 'Sheet2!B3', value: '42', note: 'set value', editId: 'value' },
    { a1: 'C4', numFmt: '0.00', bg: '#fee2e2', color: '#111827', bold: true, align: 'center', note: 'format', editId: 'style' },
    { a1: 'D5', note: 'unknown style', editId: 'empty-style' },
  ]);
});

test('materializeGridOps preserves typed shadow values, formulas, null, and explicit false styles', () => {
  const result = materializeGridOps(diff([
    { editId: 'number', ref: 'A1', kind: 'setValue', badge: 'modify', label: 'number', after: { kind: 'cell', value: 42 } },
    { editId: 'formula', ref: 'A2', kind: 'setFormula', badge: 'modify', label: 'formula', after: { kind: 'cell', value: 84, formula: '=A1*2' } },
    { editId: 'clear', ref: 'A3', kind: 'setValue', badge: 'modify', label: 'clear', proposedAfter: { kind: 'cell', value: null } },
    { editId: 'unbold', ref: 'A4', kind: 'setStyle', badge: 'modify', label: 'unbold', style: { bold: false } },
  ]));

  assert.deepEqual(result, [
    { a1: 'A1', value: 42, note: 'number', editId: 'number' },
    { a1: 'A2', value: '=A1*2', note: 'formula', editId: 'formula' },
    { a1: 'A3', value: null, note: 'clear', editId: 'clear' },
    { a1: 'A4', bold: false, note: 'unbold', editId: 'unbold' },
  ]);
});

test('materializeAddedBoardObjects preserves references and resolves collisions and parent coordinates', () => {
  const changeSet = {
    edits: [
      { id: 'container-edit', op: { kind: 'addObject', payload: { id: 'container', value: '<b>Group</b>', style: 'rounded=1;container=1;', geometry: { x: 100, y: 80, width: 240, height: 160 } } } },
      { id: 'child-edit', op: { kind: 'addObject', payload: { id: 'child', parent: 'container', value: 'Child<br>Node', style: 'ellipse;fillColor=#ffffff;', geometry: { x: 20, y: 30, width: 80, height: 40 } } } },
      { id: 'edge-edit', op: { kind: 'addObject', payload: { id: 'edge', edge: true, source: 'container', target: 'child', style: 'dashed=1;strokeColor=#2563eb;' } } },
    ],
  };
  const result = materializeAddedBoardObjects(changeSet, {
    sequence: 7,
    getObject: (id) => id === 'container'
      ? { node: { id, x: 0, y: 0, w: 1, h: 1, inner: '', label: '' } }
      : null,
  });

  assert.equal(countAddedBoardObjects(changeSet), 3);
  assert.equal(result.nodes[0]?.id, 'container_7_1');
  assert.equal(result.nodes[0]?.label, 'Group');
  assert.equal(result.nodes[1]?.id, 'child');
  assert.equal(result.nodes[1]?.x, 120);
  assert.equal(result.nodes[1]?.y, 110);
  assert.equal(result.nodes[1]?.label, 'Child · Node');
  assert.deepEqual(result.edges[0], {
    id: 'edge',
    from: 'container_7_1',
    to: 'child',
    arrow: 'classic',
    style: 'ortho',
    dash: true,
    color: '#2563eb',
  });
  assert.deepEqual(result.byEdit, {
    'container-edit': 'container_7_1',
    'child-edit': 'child',
    'edge-edit': 'edge',
  });
});
