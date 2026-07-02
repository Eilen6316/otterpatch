import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBlocks, findText, getOutline, getStyleUsage, execDocTool, type DocSnapshot } from './doc-tools.js';

const DOC: DocSnapshot = {
  blocks: [
    { style: '标题1', text: '项目周报', font: '宋体', size: 18, align: '居中' },
    { style: '正文', text: '本周核心进展:完成透视图内联渲染。整体进度符合预期。', font: '宋体', size: 11.5 },
    { style: '标题3', text: '下周计划', font: '黑体', size: 14 }, // 故意 H1→H3 越级
    { style: '正文', text: '一、补齐回归测试;二、校准澄清边界。', font: '仿宋', size: 12 }, // 故意与上面正文不同基线
    { style: '正文', text: '备注:本文档为演示数据。整体进度符合预期。', font: '宋体', size: 11.5 },
  ],
};

test('read_blocks:按段号取全文,越界报范围', () => {
  const r = readBlocks(DOC, 2, 3);
  assert.match(r, /第2段 \[正文\]: 本周核心进展/);
  assert.match(r, /第3段 \[标题3\]: 下周计划/);
  assert.match(readBlocks(DOC, 99), /段号超出范围/);
});

test('read_blocks:单段与段数上限', () => {
  assert.match(readBlocks(DOC, 1), /项目周报/);
  const r = readBlocks(DOC, 1, 5, 2); // maxBlocks=2
  assert.match(r, /一次最多返回 2 段/);
});

test('find_text:命中给段号+摘录,多处提示唯一性,未命中明说', () => {
  const r = findText(DOC, '整体进度符合预期');
  assert.match(r, /共出现 2 处/);
  assert.match(r, /第2段/);
  assert.match(r, /第5段/);
  assert.match(r, /唯一/);
  assert.match(findText(DOC, '不存在的句子'), /全文未出现/);
});

test('get_outline:标题树 + 越级诊断', () => {
  const r = getOutline(DOC);
  assert.match(r, /H1 第1段: 项目周报/);
  assert.match(r, /H3 第3段: 下周计划/);
  assert.match(r, /越级/); // H1 → H3
});

test('get_style_usage:分布 + 正文基线不统一告警', () => {
  const r = getStyleUsage(DOC);
  assert.match(r, /宋体 · 11\.5pt/);
  assert.match(r, /基线不统一/); // 正文有 宋体11.5 与 仿宋12 两种
});

test('execDocTool:路由与未知工具返回 null(交上层继续路由)', () => {
  assert.match(execDocTool('get_outline', {}, DOC) ?? '', /H1/);
  assert.equal(execDocTool('read_range', { a1: 'A1' } as never, DOC), null);
  assert.match(execDocTool('read_blocks', { from: 1 }) ?? '', /无文档快照/);
});
