import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentFormatLabel, isValidDocTable } from './richdoc-editing.js';

test('isValidDocTable accepts bounded rectangular string matrices', () => {
  assert.equal(isValidDocTable({ rows: [['Name', 'Value'], ['Alpha', '10']], headerRows: 1, at: 'after' }), true);
  assert.equal(isValidDocTable({ rows: [['only']], headerRows: 0, at: 'end' }), true);
});

test('isValidDocTable fails closed for malformed or oversized runtime payloads', () => {
  assert.equal(isValidDocTable(null), false);
  assert.equal(isValidDocTable({ rows: 'not-an-array', headerRows: 0, at: 'end' }), false);
  assert.equal(isValidDocTable({ rows: [['A'], ['B', 'C']], headerRows: 0, at: 'end' }), false);
  assert.equal(isValidDocTable({ rows: [['A']], headerRows: 2, at: 'end' }), false);
  assert.equal(isValidDocTable({ rows: [['A']], headerRows: 0, at: 'sideways' }), false);
  assert.equal(isValidDocTable({ rows: [['x'.repeat(10_001)]], headerRows: 0, at: 'end' }), false);
});

test('documentFormatLabel summarizes whole-document and page changes', () => {
  assert.equal(documentFormatLabel({
    font: 'Times New Roman',
    size: 10,
    bold: false,
    align: 'justify',
    lineSpacing: 1.5,
    columns: 2,
    margin: 'narrow',
    orient: 'landscape',
  }), 'Times New Roman · 10pt · 取消加粗 · 两端对齐 · 行距 1.5 · 2 栏 · 窄边距 · 横向纸张');
  assert.equal(documentFormatLabel({}), '全文格式');
});
