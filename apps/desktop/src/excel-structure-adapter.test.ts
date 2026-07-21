import assert from 'node:assert/strict';
import test from 'node:test';
import type { SheetHandle } from './UniverSheet.js';
import { applyExcelStructure, type ChartPlacement } from './excel-structure-adapter.js';
import type { ChartSpec } from './chart-data.js';

type StructureSheet = Parameters<typeof applyExcelStructure>[1]['sheet'];

const makeSheet = (calls: Array<[string, ...unknown[]]>, values: Record<string, unknown> = {}): NonNullable<StructureSheet> => ({
  insertRows: (...args) => calls.push(['insertRows', ...args]),
  deleteRows: (...args) => calls.push(['deleteRows', ...args]),
  insertCols: (...args) => calls.push(['insertCols', ...args]),
  deleteCols: (...args) => calls.push(['deleteCols', ...args]),
  mergeRange: (...args) => calls.push(['mergeRange', ...args]),
  unmergeRange: (...args) => calls.push(['unmergeRange', ...args]),
  freeze: (...args) => calls.push(['freeze', ...args]),
  sortRange: (...args) => calls.push(['sortRange', ...args]),
  clearRange: (...args) => calls.push(['clearRange', ...args]),
  conditionalFormat: (...args) => calls.push(['conditionalFormat', ...args]),
  dataValidation: (...args) => calls.push(['dataValidation', ...args]),
  createFilter: (...args) => calls.push(['createFilter', ...args]),
  addSheet: (...args) => calls.push(['addSheet', ...args]),
  copyRange: (...args) => calls.push(['copyRange', ...args]),
  getValue: (a1) => values[a1],
  insertChartImage: (...args) => calls.push(['insertChartImage', ...args]),
}) satisfies Pick<SheetHandle, keyof NonNullable<StructureSheet>>;

test('applyExcelStructure dispatches sheet-aware operations with defaults', () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const anchors = {
    rows: { portable: { a1: 'Sheet2!B3' } },
    range: { portable: { a1: 'Sheet2!B3:D8' } },
  };
  applyExcelStructure({
    anchors,
    edits: [
      { target: 'rows', op: { kind: 'insertRows', count: 2, before: false } },
      { target: 'rows', op: { kind: 'deleteRows' } },
      { target: 'rows', op: { kind: 'insertCols', count: 3, before: false } },
      { target: 'rows', op: { kind: 'deleteCols' } },
      { target: 'range', op: { kind: 'mergeCells' } },
      { target: 'range', op: { kind: 'unmergeCells' } },
      { target: 'range', op: { kind: 'freezePanes', rows: 1, cols: 2 } },
      { target: 'range', op: { kind: 'sortRange', by: 2, asc: false } },
      { target: 'range', op: { kind: 'deleteRange' } },
      { target: 'range', op: { kind: 'conditionalFormat', when: 'greaterThan', v1: 10, style: { bold: true } } },
      { target: 'range', op: { kind: 'dataValidation', rule: 'list', list: ['A', 'B'] } },
      { target: 'range', op: { kind: 'autoFilter' } },
      { target: 'range', op: { kind: 'addSheet', name: 'Summary' } },
      { target: 'range', op: { kind: 'addSheet' } },
      { target: 'range', op: { kind: 'copyRange', to: 'Summary!A1' } },
      { target: 'range', op: { kind: 'setValue', value: 99 } },
    ],
  }, { sheet: makeSheet(calls), chartPlacements: [], renderChart: () => '' });

  assert.deepEqual(calls, [
    ['insertRows', 3, 2, 'Sheet2'],
    ['deleteRows', 2, 1, 'Sheet2'],
    ['insertCols', 2, 3, 'Sheet2'],
    ['deleteCols', 1, 1, 'Sheet2'],
    ['mergeRange', 'Sheet2!B3:D8'],
    ['unmergeRange', 'Sheet2!B3:D8'],
    ['freeze', 1, 2],
    ['sortRange', 'Sheet2!B3:D8', 2, false],
    ['clearRange', 'Sheet2!B3:D8'],
    ['conditionalFormat', 'Sheet2!B3:D8', { when: 'greaterThan', v1: 10, v2: undefined }, { bold: true }],
    ['dataValidation', 'Sheet2!B3:D8', { kind: 'list', list: ['A', 'B'], min: undefined, max: undefined, v: undefined }],
    ['createFilter', 'Sheet2!B3:D8'],
    ['addSheet', 'Summary'],
    ['addSheet', '新表'],
    ['copyRange', 'Sheet2!B3:D8', 'Summary!A1'],
  ]);
});

test('range chart overlays pending values and is placed to the right of its data', () => {
  const calls: Array<[string, ...unknown[]]> = [];
  let rendered: ChartSpec | undefined;
  applyExcelStructure({
    anchors: {
      a1: { portable: { a1: 'A1' } },
      a2: { portable: { a1: 'A2' } },
      b1: { portable: { a1: 'B1' } },
      b2: { portable: { a1: 'B2' } },
      chart: { portable: { a1: 'A1:B2' } },
    },
    edits: [
      { target: 'a1', op: { kind: 'setValue', value: 'Month' } },
      { target: 'b1', op: { kind: 'setValue', value: 'Sales' } },
      { target: 'a2', op: { kind: 'setValue', value: 'Jan' } },
      { target: 'b2', op: { kind: 'setValue', value: 42 } },
      { target: 'chart', op: { kind: 'insertChart', chartType: 'bar', title: 'Monthly' } },
    ],
  }, {
    sheet: makeSheet(calls),
    chartPlacements: [],
    renderChart: (spec) => {
      rendered = spec;
      return 'data:image/png;base64,chart';
    },
  });

  assert.deepEqual(rendered, {
    chartType: 'bar',
    title: 'Monthly',
    categories: ['Jan'],
    series: [{ name: 'Sales', data: [42] }],
  });
  assert.deepEqual(calls, [['insertChartImage', 'D1', 'data:image/png;base64,chart', 640, 400]]);
});

test('inline charts move below occupied placements', () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const chartPlacements: ChartPlacement[] = [{ row: 1, col: 6 }];
  applyExcelStructure({
    anchors: { chart: { portable: { a1: 'G2' } } },
    edits: [{
      target: 'chart',
      op: {
        kind: 'insertChart',
        chartType: 'line',
        title: 'Trend',
        categories: ['Q1', 'Q2'],
        series: [{ name: 'Revenue', data: [10, 20] }],
      },
    }],
  }, {
    sheet: makeSheet(calls),
    chartPlacements,
    renderChart: () => 'png',
  });

  assert.deepEqual(calls, [['insertChartImage', 'G21', 'png', 640, 400]]);
  assert.deepEqual(chartPlacements, [{ row: 1, col: 6 }, { row: 20, col: 6 }]);
});
