import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  documentContextFromBlocks,
  documentSnapshotFromBlocks,
  documentTextFromBlocks,
  filterVisibleDocumentBlocks,
  rgbToHex,
  safeHtmlUrl,
  summarizeTableRows,
  type FormatBrief,
  type ProjectionBlock,
} from './richdoc-projection.js';

test('filterVisibleDocumentBlocks keeps top-level tables as one block', () => {
  const candidate = (name: string, kind: string | null, insideTable: boolean) => ({
    name,
    getAttribute: (attribute: string): string | null => attribute === 'data-kind' ? kind : null,
    parentElement: { closest: (selector: string): unknown => selector === 'table' && insideTable ? { tagName: 'TABLE' } : null },
  });
  const blocks = [
    candidate('paragraph', null, false),
    candidate('table', null, false),
    candidate('table-cell-paragraph', null, true),
    candidate('pending-deletion', 'remove', false),
  ];

  assert.deepEqual(filterVisibleDocumentBlocks(blocks).map((block) => block.name), ['paragraph', 'table']);
});

test('summarizeTableRows preserves two-dimensional boundaries and reports truncation', () => {
  const summary = summarizeTableRows([
    ['Alphabet', 'B', 'C'],
    ['D', 'E', 'F'],
    ['G', 'H', 'I'],
  ], 2, 2, 4);

  assert.equal(summary, '[表格 3×3,rows=[["Alph…","B"],["D","E"]],省略 1 行/1 列]');
  assert.doesNotMatch(summary, /AlphabetBC/);
});

const format = (overrides: Partial<FormatBrief> = {}): FormatBrief => ({
  font: '宋体',
  size: 12,
  color: '#1f2430',
  bold: false,
  italic: false,
  align: '左对齐',
  sizeDefault: false,
  ...overrides,
});

const blocks: ProjectionBlock[] = [
  {
    tag: 'h1',
    style: '标题1',
    text: '季度报告',
    contextText: '季度报告',
    imageBrief: '',
    format: format({ font: '黑体', size: 18, bold: true, align: '居中' }),
  },
  {
    tag: 'p',
    style: '正文',
    text: '正文第一段',
    contextText: '正文第一段',
    imageBrief: '[图片 图1 100×50]',
    format: format(),
  },
  {
    tag: 'table',
    style: '表格',
    text: '[表格 2×2,rows=[["字段","说明"],["目标","真实表格"]]]',
    contextText: '[表格 2×2,rows=[["字段","说明"],["目标","真实表格"]]]',
    imageBrief: '',
    format: format({ sizeDefault: true }),
  },
];

test('document projection keeps text, context, and snapshot in one stable block order', () => {
  assert.equal(documentTextFromBlocks(blocks), [blocks[0]!.text, blocks[1]!.text, blocks[2]!.text].join('\n'));
  assert.deepEqual(documentSnapshotFromBlocks(blocks), {
    blocks: [
      { style: '标题1', text: '季度报告', font: '黑体', size: 18, align: '居中' },
      { style: '正文', text: '[图片 图1 100×50]正文第一段', font: '宋体', size: 12, align: '左对齐' },
      { style: '表格', text: '[表格 2×2,rows=[["字段","说明"],["目标","真实表格"]]]', font: '宋体', size: 12, align: '左对齐' },
    ],
  });

  const context = documentContextFromBlocks(blocks);
  assert.match(context, /^\[Word 文档 · 3 段]/);
  assert.match(context, /标题树 1 个\(H1 第1段 季度报告\)/);
  assert.match(context, /正文基线 宋体 12pt\(1 段\)/);
  assert.match(context, /第2段 \[正文 · 宋体 12pt]: \[图片 图1 100×50]正文第一段/);
  assert.match(context, /第3段 \[表格 · 宋体 12pt\(默认\)]/);
  assert.match(context, /rows=\[\["字段","说明"\],\["目标","真实表格"\]\]/);
  assert.doesNotMatch(context, /字段说明目标真实表格/);
});

test('document projection handles empty and truncated blocks explicitly', () => {
  assert.equal(documentTextFromBlocks([], ' fallback '), 'fallback');
  assert.equal(documentContextFromBlocks([], 'empty'), 'empty');
  const longBlock: ProjectionBlock = {
    tag: 'p', style: '正文', text: 'x'.repeat(320), contextText: 'x'.repeat(320), imageBrief: '', format: format(),
  };
  const context = documentContextFromBlocks([longBlock]);
  assert.match(context, /…\(已截断\)/);
  assert.match(context, /有 1 段超长已截断/);
});

test('projection security helpers reject active URLs and normalize CSS colors', () => {
  assert.equal(safeHtmlUrl('javascript:alert(1)'), false);
  assert.equal(safeHtmlUrl('http://evil.example/test'), false);
  assert.equal(safeHtmlUrl('http://localhost.evil.example/test'), false);
  assert.equal(safeHtmlUrl('http://[::1]:4319/test'), true);
  assert.equal(safeHtmlUrl('https://example.com/test'), true);
  assert.equal(safeHtmlUrl('data:image/png;base64,AAAA'), true);
  assert.equal(rgbToHex('rgb(31, 36, 48)'), '#1f2430');
  assert.equal(rgbToHex('transparent'), 'transparent');
});
