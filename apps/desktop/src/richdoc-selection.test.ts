import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWordSelection,
  captureRichDocSelection,
  readRichDocCommandState,
  richDocSelectionBlock,
} from './richdoc-selection.js';

const node = (tagName: string, parentNode: Node | null = null): HTMLElement => ({
  nodeType: 1,
  tagName,
  parentNode,
  parentElement: parentNode?.nodeType === 1 ? parentNode as HTMLElement : null,
} as unknown as HTMLElement);

test('RichDoc selection labels document blocks and bounds the selection chip', () => {
  const root = node('DIV');
  const heading = node('H2', root);
  const quote = node('BLOCKQUOTE', root);
  const item = node('LI', root);
  assert.equal(richDocSelectionBlock(heading, root), '标题');
  assert.equal(richDocSelectionBlock(quote, root), '引用');
  assert.equal(richDocSelectionBlock(item, root), '列表项');
  assert.equal(richDocSelectionBlock(root, root), '正文');

  const text = 'x'.repeat(405);
  const projected = buildWordSelection(text, '标题', { font: 'Arial', size: 12, bold: true, italic: false, align: 'center', color: '#000000', sizeDefault: false });
  assert.equal(projected?.text.length, 401);
  assert.equal(projected?.text.endsWith('…'), true);
  assert.equal(projected?.chars, 405);
  assert.equal(projected?.block, '标题');
  assert.equal(projected?.font, 'Arial');
  assert.equal(buildWordSelection('   ', '正文', null), null);
});

test('RichDoc command state reads formatting and fails closed on browser errors', () => {
  const anchor = node('SPAN');
  const active = new Set(['bold', 'underline', 'insertUnorderedList', 'justifyFull']);
  const state = readRichDocCommandState(
    anchor,
    (command) => active.has(command),
    () => ({ fontFamily: '"Times New Roman", serif', fontSize: '16px' }),
  );
  assert.deepEqual(state, {
    bold: true,
    italic: false,
    underline: true,
    strike: false,
    ul: true,
    ol: false,
    align: 'justify',
    font: 'Times New Roman',
    size: 12,
  });
  assert.equal(readRichDocCommandState(anchor, () => { throw new Error('unsupported'); }, () => ({ fontFamily: '', fontSize: '16px' })), null);
});

test('RichDoc selection capture rejects outside selections and projects valid ranges', () => {
  const root = node('DIV') as HTMLElement & { contains: (candidate: Node) => boolean };
  const paragraph = node('P', root);
  const textNode = { nodeType: 3, parentNode: paragraph, parentElement: paragraph } as unknown as Node;
  root.contains = (candidate) => candidate === textNode || candidate === paragraph;
  const range = { cloneRange: () => ({ id: 'clone' }) } as unknown as Range;
  const selection = {
    rangeCount: 1,
    anchorNode: textNode,
    getRangeAt: () => range,
    toString: () => 'selected text',
  } as unknown as Selection;
  const captured = captureRichDocSelection(root, selection, {
    formatElement: () => ({ font: 'Calibri', size: 11, bold: false, italic: true, align: 'left', color: '#000000', sizeDefault: false }),
    queryCommandState: () => false,
    getStyle: () => ({ fontFamily: 'Calibri', fontSize: '14.6667px' }),
  });
  assert.equal((captured?.range as unknown as { id: string }).id, 'clone');
  assert.equal(captured?.hasText, true);
  assert.equal(captured?.wordSelection?.text, 'selected text');
  assert.equal(captured?.wordSelection?.italic, true);
  assert.equal(captured?.commandState?.size, 11);

  root.contains = () => false;
  assert.equal(captureRichDocSelection(root, selection), null);
  assert.equal(captureRichDocSelection(root, null), null);
});
