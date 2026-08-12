import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyRichDocPageState,
  normalizeRichDocPageState,
  parseRichDocPageState,
} from './richdoc-page-state.js';

test('RichDoc page state parser keeps only bounded supported values', () => {
  assert.deepEqual(parseRichDocPageState('{broken'), {});
  assert.deepEqual(normalizeRichDocPageState(null), {});
  assert.deepEqual(normalizeRichDocPageState({
    size: 'A4', margin: '窄', orient: 'landscape', columns: 3, writing: 'v',
    zoom: 1.5, view: 'read', lang: 'ja-JP', grid: true, spell: false,
    unknown: 'drop-me', __proto__: { polluted: true },
  }), {
    size: 'A4', writing: 'v', margin: '窄', orient: 'landscape', columns: 3,
    zoom: 1.5, view: 'read', lang: 'ja-JP', grid: true, spell: false,
  });
});

test('RichDoc page state parser drops invalid enums, types, and numeric ranges', () => {
  assert.deepEqual(normalizeRichDocPageState({
    size: 'poster', margin: 'huge', orient: 'sideways', columns: 100,
    zoom: Infinity, view: 'print', lang: 'invalid', grid: 'yes', nav: 1,
  }), {});
  assert.deepEqual(normalizeRichDocPageState({ columns: 1, zoom: 0.2, lineNums: false }), {
    columns: 1, zoom: 0.2, lineNums: false,
  });
});

test('RichDoc page projection applies layout, language, classes, and zoom', () => {
  const classes = new Map<string, boolean>();
  const attributes = new Map<string, string>();
  const element = {
    style: {} as CSSStyleDeclaration,
    spellcheck: false,
    classList: { toggle: (name: string, force: boolean) => { classes.set(name, force); } },
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
  } as unknown as HTMLElement;

  applyRichDocPageState(element, {
    size: 'A4', orient: 'landscape', margin: '窄', columns: 2, writing: 'v',
    hyphens: true, spell: true, grid: true, lineNums: true, hideComments: true,
    track: true, zoom: 1.5,
  });
  assert.equal(element.style.width, '1123px');
  assert.equal(element.style.minHeight, '794px');
  assert.equal(element.style.padding, '24px 30px');
  assert.equal(element.style.columnCount, '2');
  assert.equal(element.style.writingMode, 'vertical-rl');
  assert.equal(attributes.get('lang'), 'en');
  assert.equal(element.spellcheck, true);
  assert.equal(classes.get('rd-grid'), true);
  assert.equal(classes.get('rd-track'), true);
  assert.equal(element.style.zoom, '1.5');

  applyRichDocPageState(element, {});
  assert.equal(element.style.width, '');
  assert.equal(element.style.columnCount, '');
  assert.equal(element.style.writingMode, '');
  assert.equal(attributes.has('lang'), false);
  assert.equal(classes.get('rd-grid'), false);
  assert.equal(element.style.zoom, '');
});
