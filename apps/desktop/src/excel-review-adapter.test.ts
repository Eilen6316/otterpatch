import assert from 'node:assert/strict';
import test from 'node:test';
import type { DiffTurn, Turn } from './app-thread-types.js';
import type { GridOp } from './proposal-materializers.js';
import {
  applyGridOp,
  findLatestExcelDiffTurn,
  playGridOps,
  renderExcelDiffView,
  revertGridOp,
} from './excel-review-adapter.js';

type ReviewSheet = NonNullable<Parameters<typeof applyGridOp>[0]>;
type Event = [string, ...unknown[]];

const makeSheet = (events: Event[]): ReviewSheet => ({
  setCell: (...args) => { events.push(['setCell', ...args]); },
  setBackground: (...args) => { events.push(['setBackground', ...args]); },
  setFontColor: (...args) => { events.push(['setFontColor', ...args]); },
  setBold: (...args) => { events.push(['setBold', ...args]); },
  setNumberFormat: (...args) => { events.push(['setNumberFormat', ...args]); },
  setAlign: (...args) => { events.push(['setAlign', ...args]); },
  focus: (...args) => { events.push(['focus', ...args]); },
});

const excelTurn = (ops: GridOp[]): DiffTurn => ({
  role: 'assistant',
  kind: 'diff',
  format: 'excel',
  diff: {
    changeSetId: 'cs-1',
    hostId: 'excel',
    intent: 'update cells',
    items: ops.map((op, index) => ({
      editId: op.editId ?? `e${index + 1}`,
      ref: op.a1,
      badge: 'modify',
      label: op.note,
    })),
  },
  ops,
});

test('grid operations apply and restore only the dimensions they changed', () => {
  const events: Event[] = [];
  const sheet = makeSheet(events);
  const op: GridOp = {
    a1: 'B2',
    value: 42,
    bg: '#dbeafe',
    color: '#111827',
    bold: true,
    numFmt: '#,##0.00',
    align: 'center',
    note: 'format total',
    beforeState: {
      v: 10,
      f: '=A1*2',
      bg: '#ffffff',
      color: '#334155',
      bold: false,
      numFmt: '0.00',
      align: 'right',
    },
  };

  applyGridOp(sheet, op);
  assert.deepEqual(events, [
    ['setCell', 'B2', 42],
    ['setBold', 'B2'],
    ['setFontColor', 'B2', '#111827'],
    ['setNumberFormat', 'B2', '#,##0.00'],
    ['setAlign', 'B2', 'center'],
    ['setBackground', 'B2', '#dbeafe'],
  ]);

  events.length = 0;
  revertGridOp(sheet, op);
  assert.deepEqual(events, [
    ['setCell', 'B2', '=A1*2'],
    ['setBackground', 'B2', '#ffffff'],
    ['setFontColor', 'B2', '#334155'],
    ['setBold', 'B2', false],
    ['setNumberFormat', 'B2', '0.00'],
    ['setAlign', 'B2', 'right'],
  ]);

  events.length = 0;
  revertGridOp(sheet, { a1: 'C3', value: 1, note: 'restore zero', beforeState: { v: 0, f: null } });
  assert.deepEqual(events, [['setCell', 'C3', 0]]);
});

test('small playback preserves flash and final background ordering', async () => {
  const events: Event[] = [];
  const sheet = makeSheet(events);
  await playGridOps(sheet, [{ a1: 'C3', value: 7, bold: true, bg: '#ecfccb', note: 'update' }], {
    onStart: () => { events.push(['start']); },
    delay: async (ms) => { events.push(['delay', ms]); },
  });

  assert.deepEqual(events, [
    ['start'],
    ['focus', 'C3'],
    ['delay', 220],
    ['setBackground', 'C3', '#dbeafe'],
    ['delay', 120],
    ['setCell', 'C3', 7],
    ['setBold', 'C3'],
    ['delay', 240],
    ['setBackground', 'C3', '#ecfccb'],
    ['delay', 140],
  ]);
});

test('large playback focuses the bounding range and applies operations in chunks', async () => {
  const events: Event[] = [];
  const sheet = makeSheet(events);
  const ops = Array.from({ length: 11 }, (_, index): GridOp => ({
    a1: `B${index + 2}`,
    value: index,
    note: 'bulk update',
  }));
  await playGridOps(sheet, ops, { delay: async (ms) => { events.push(['delay', ms]); } });

  assert.deepEqual(events[0], ['focus', 'B2:B12']);
  assert.deepEqual(events[1], ['delay', 120]);
  assert.equal(events.filter(([name]) => name === 'setCell').length, 11);
  assert.deepEqual(events.at(-1), ['delay', 20]);
});

test('diff view projects accepted and rejected operations without persisting marker colors', () => {
  const events: Event[] = [];
  const sheet = makeSheet(events);
  const turn = excelTurn([
    { a1: 'A1', value: 10, bg: '#dcfce7', note: 'accepted', editId: 'accepted', beforeState: { v: 1, bg: '#ffffff' } },
    { a1: 'B1', value: 20, note: 'rejected', editId: 'rejected', beforeState: { v: 2, bg: '#fefce8' } },
  ]);

  renderExcelDiffView(sheet, turn, 'mark', (editId) => editId === 'accepted');
  assert.deepEqual(events, [
    ['setCell', 'A1', 10],
    ['setBackground', 'A1', '#dcfce7'],
    ['setBackground', 'A1', '#dbeafe'],
    ['setCell', 'B1', 2],
    ['setBackground', 'B1', '#fee2e2'],
  ]);

  events.length = 0;
  renderExcelDiffView(sheet, turn, 'final', (editId) => editId === 'accepted');
  assert.deepEqual(events, [
    ['setCell', 'A1', 10],
    ['setBackground', 'A1', '#dcfce7'],
    ['setBackground', 'A1', '#dcfce7'],
    ['setCell', 'B1', 2],
    ['setBackground', 'B1', '#fefce8'],
  ]);
});

test('latest Excel turn ignores newer non-grid diffs', () => {
  const first = excelTurn([{ a1: 'A1', value: 1, note: 'first' }]);
  const latest = excelTurn([{ a1: 'B2', value: 2, note: 'latest' }]);
  const drawio: Turn = {
    role: 'assistant',
    kind: 'diff',
    format: 'drawio',
    diff: { changeSetId: 'drawio', hostId: 'drawio', intent: 'draw', items: [] },
    ops: [],
  };

  assert.equal(findLatestExcelDiffTurn([first, drawio, latest, drawio]), latest);
  assert.equal(findLatestExcelDiffTurn([drawio]), undefined);
});
