import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichDocMenuPopup } from './RichDocMenuPopup.js';
import type { RichDocMenuActions } from './RichDocMenuPopup.js';

const noop = (): void => {};
const actions: RichDocMenuActions = {
  paste: noop,
  setFont: noop,
  setSize: noop,
  changeCase: noop,
  exec: noop,
  wrapSelection: noop,
  applyColor: noop,
  insertEnclosed: noop,
  sortBlocks: noop,
  setLineSpacing: noop,
  styleBlocks: noop,
  findNext: noop,
  findReplace: noop,
  clearSelection: noop,
  insertCover: noop,
  insertTable: noop,
  insertTablePrompt: noop,
  insertShape: noop,
  insertText: noop,
  insertHTML: noop,
  insertPageNumber: noop,
  insertWordArt: noop,
  dropCap: noop,
  updatePage: noop,
  setGridPaper: noop,
  arrangeImage: noop,
  ungroupSelection: noop,
  rotateImage: noop,
  buildToc: noop,
  updateToc: noop,
  notify: noop,
  fitZoom: noop,
  run: noop,
};

const renderMenu = (menuKey: string, page = {}): string => renderToStaticMarkup(
  <RichDocMenuPopup menuKey={menuKey} page={page} actions={actions} onClose={noop} />,
);

test('RichDoc popup renders font and shape galleries outside the editor shell', () => {
  const fonts = renderMenu('字体');
  assert.match(fonts, /font-family:宋体/);
  assert.match(fonts, /Times New Roman/);

  const shapes = renderMenu('形状');
  assert.equal((shapes.match(/class="dgcell"/g) ?? []).length, 6);
  assert.match(shapes, />圆角矩形</);
  assert.match(shapes, />箭头</);
});

test('RichDoc popup projects checked page state and complete color controls', () => {
  const orientation = renderMenu('纸张方向', { orient: 'landscape' });
  assert.equal((orientation.match(/<svg/g) ?? []).length, 1);
  assert.match(orientation, />横向<\/span>/);

  const colors = renderMenu('字体颜色');
  assert.equal((colors.match(/class="swatch"/g) ?? []).length, 21);
  assert.match(colors, /type="color"/);
  assert.match(colors, /更多颜色…/);
});

test('RichDoc popup keeps the generic command fallback explicit', () => {
  const markup = renderMenu('自定义命令');
  assert.match(markup, /class="drop-item"/);
  assert.match(markup, />自定义命令<\/span>/);
});
