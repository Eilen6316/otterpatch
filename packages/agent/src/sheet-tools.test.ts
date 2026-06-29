/**
 * 共享取数件:read_range / aggregate / execSheetTool —— 供 OpenAI 与 Claude 两通道复用。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, auxToolDefs, execSheetTool, readRange, type SheetData } from './sheet-tools.js';

const SHEET: SheetData = {
  a1: 'A1:C4',
  values: [
    ['名称', '数量', '单价'],
    ['甲', 2, 10],
    ['乙', 3, 20],
    ['丙', 5, 0],
  ],
};

test('readRange:按 A1 区域取精确值,空格标 (空)', () => {
  const out = readRange(SHEET, 'B2:C3');
  assert.match(out, /B2=2/);
  assert.match(out, /C3=20/);
});

test('readRange:strip sheet 限定符与 $ 绝对引用', () => {
  assert.match(readRange(SHEET, 'Sheet1!$B$2'), /B2=2/);
});

test('aggregate:整列求和/计数跳过表头', () => {
  assert.equal(aggregate(SHEET, 'B', 'sum'), '10'); // 2+3+5
  assert.equal(aggregate(SHEET, 'B', 'count'), '3');
  assert.equal(aggregate(SHEET, 'C', 'max'), '20');
});

test('aggregate:groupBy 透视/分组汇总', () => {
  // 按 A 列(名称)分组,汇总 B 列(数量)—— 这里名称都唯一,各成一组
  const g = aggregate(SHEET, 'B', 'sum', 'A');
  assert.match(g, /甲: 2/);
  assert.match(g, /乙: 3/);
  assert.match(g, /丙: 5/);
});

test('aggregate:where 先筛选再聚合', () => {
  // 只统计 单价(C)>10 的行的 数量(B):乙(3,单价20)+丙(5,单价0?) → 仅乙满足 → 3
  assert.equal(aggregate(SHEET, 'B', 'sum', undefined, { col: 'C', op: '>', value: 10 }), '3');
});

test('execSheetTool:按工具名分发;无 sheet 或未知工具返回占位', () => {
  assert.match(execSheetTool('read_range', { a1: 'B2' }, SHEET), /B2=2/);
  assert.equal(execSheetTool('aggregate', { column: 'B', op: 'sum' }, SHEET), '10');
  assert.equal(execSheetTool('read_range', { a1: 'B2' }, undefined), '(unknown tool)');
  assert.equal(execSheetTool('nope', {}, SHEET), '(unknown tool)');
});

test('auxToolDefs:有整表快照才挂 read_range/aggregate', () => {
  assert.deepEqual(auxToolDefs(false).map((d) => d.name), ['answer_user']);
  assert.deepEqual(auxToolDefs(true).map((d) => d.name), ['answer_user', 'read_range', 'aggregate']);
});
