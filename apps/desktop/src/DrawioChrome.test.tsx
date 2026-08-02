import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DrawioToolbar, filterPaletteShapes } from './DrawioChrome.js';

test('Drawio toolbar renders the complete command surface', () => {
  const markup = renderToStaticMarkup(<DrawioToolbar onAct={() => {}} />);
  assert.equal((markup.match(/class="dtool(?: |")/g) ?? []).length, 11);
  assert.match(markup, /title="撤销"/);
  assert.match(markup, /title="选择"/);
  assert.match(markup, /title="填充色"/);
  assert.match(markup, /100%<\/span>/);
});

test('Drawio palette search stays within the requested category', () => {
  assert.deepEqual(filterPaletteShapes('general', '圆角').map((shape) => shape.kind), ['roundRect']);
  const flowData = filterPaletteShapes('flow', 'data');
  assert.ok(flowData.length >= 2);
  assert.ok(flowData.every((shape) => shape.cat === 'flow'));
  assert.deepEqual(filterPaletteShapes('icons', 'USER').map((shape) => shape.kind), ['user', 'users']);
});
