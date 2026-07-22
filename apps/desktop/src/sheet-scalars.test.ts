import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetScalars, toSheetScalar } from './sheet-scalars.js';

test('sheet scalar snapshot keeps raw percent semantics and display text', () => {
  assert.deepEqual(toSheetScalar(0.5, '50%', '0%', 2), { kind: 'percent', value: 0.5, display: '50%' });
  assert.deepEqual(toSheetScalar('50%', '50%', undefined, 1), { kind: 'text', value: '50%' });
});

test('sheet scalar snapshot derives currency/date only from trusted number formats', () => {
  assert.deepEqual(toSheetScalar(12.5, '$12.50', '$#,##0.00', 2), { kind: 'currency', value: 12.5, currency: 'USD' });
  assert.deepEqual(toSheetScalar(45_658, '2025-01-01', 'yyyy-mm-dd', 2), { kind: 'date', serial: 45_658, iso: '2025-01-01' });
  assert.deepEqual(toSheetScalar(50, '50', undefined, 2), { kind: 'number', value: 50 });
});

test('sheet scalar matrix preserves explicit Univer text and boolean types', () => {
  const values = [['01', true, null]];
  assert.deepEqual(buildSheetScalars(values, undefined, undefined, [[{ t: 4 }, { t: 3 }, null]]), [[
    { kind: 'text', value: '01' },
    { kind: 'boolean', value: true },
    { kind: 'blank' },
  ]]);
});
