import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DATE_FMTS,
  FONTS,
  PAPERS,
  RichDocMenuItem,
  RichDocSymbolGrid,
  RichDocTableGrid,
  SHAPES,
  SIZES,
  SYMBOLS,
} from './RichDocMenus.js';

test('RichDoc menu catalog preserves document formatting options', () => {
  assert.equal(FONTS.includes('宋体'), true);
  assert.equal(FONTS.includes('Times New Roman'), true);
  assert.deepEqual([SIZES[0], SIZES.at(-1)], [8, 72]);
  assert.deepEqual(PAPERS.A4, [794, 1123]);
  assert.deepEqual(Object.keys(SYMBOLS), ['常用', '数学', '货币', '希腊', '箭头']);
  assert.equal(SYMBOLS.数学?.includes('∑'), true);
  assert.deepEqual(SHAPES.map(([name]) => name), ['矩形', '圆角矩形', '椭圆', '三角形', '直线', '箭头']);
  assert.equal(DATE_FMTS().length, 4);
});

test('RichDoc menu item renders checked and secondary labels', () => {
  const markup = renderToStaticMarkup(
    <RichDocMenuItem label="横向" sub="A4" check onPick={() => {}} onClose={() => {}} />,
  );
  assert.match(markup, /class="drop-item"/);
  assert.match(markup, /<svg/);
  assert.match(markup, />横向<\/span>/);
  assert.match(markup, /class="di-sub">A4<\/em>/);
});

test('RichDoc table grid renders the stable 8 by 10 picker', () => {
  const markup = renderToStaticMarkup(<RichDocTableGrid onPick={() => {}} onMore={() => {}} />);
  assert.equal((markup.match(/<i/g) ?? []).length, 80);
  assert.match(markup, /class="rd-tgrid-cap">插入表格<\/div>/);
  assert.match(markup, /插入表格…/);
});

test('RichDoc symbol grid renders categories and the initial symbol set', () => {
  const markup = renderToStaticMarkup(
    <RichDocSymbolGrid sets={{ 常用: ['—', '…'], 数学: ['∑'] }} onPick={() => {}} />,
  );
  assert.match(markup, /class="rd-symtab on">常用<\/button>/);
  assert.match(markup, /class="rd-symtab">数学<\/button>/);
  assert.match(markup, />—<\/button>/);
  assert.match(markup, />…<\/button>/);
  assert.doesNotMatch(markup, />∑<\/button>/);
});
