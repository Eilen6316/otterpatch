import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchRichDocCommand } from './richdoc-command-dispatch.js';
import type { RichDocCommandContext } from './richdoc-command-dispatch.js';

function context(calls: string[]): RichDocCommandContext {
  return {
    exec: (command, value) => calls.push(`exec:${command}${value ? ':' + value : ''}`),
    clearFormat: () => calls.push('clearFormat'),
    capturePaint: () => calls.push('capturePaint'),
    stepFont: (direction) => calls.push(`stepFont:${direction}`),
    ruby: () => calls.push('ruby'),
    insertEnclosed: () => calls.push('insertEnclosed'),
    styleBlocks: () => calls.push('styleBlocks'),
    insertHTML: (html) => calls.push(`insertHTML:${html}`),
    openImagePicker: () => calls.push('openImagePicker'),
    takeScreenshot: () => { calls.push('takeScreenshot'); },
    insertLink: () => calls.push('insertLink'),
    insertBookmark: () => calls.push('insertBookmark'),
    insertCrossReference: () => calls.push('insertCrossReference'),
    toggleHeaderFooter: (which) => calls.push(`headerFooter:${which}`),
    insertTextbox: () => calls.push('insertTextbox'),
    insertSign: () => calls.push('insertSign'),
    openObjectPicker: () => calls.push('openObjectPicker'),
    changeImageLayer: (direction) => calls.push(`imageLayer:${direction}`),
    notify: (message) => calls.push(`notify:${message}`),
    translate: (key) => `translated:${key}`,
    updateToc: () => calls.push('updateToc'),
    insertNote: (kind) => calls.push(`note:${kind}`),
    nextNote: () => calls.push('nextNote'),
    showNotes: () => calls.push('showNotes'),
    insertBiblio: () => calls.push('insertBiblio'),
    insertCaption: () => calls.push('insertCaption'),
    insertTableOfFigures: () => calls.push('insertTableOfFigures'),
    markIndex: () => calls.push('markIndex'),
    buildIndex: (rebuild) => calls.push(`buildIndex:${rebuild}`),
    toggleSpell: () => calls.push('toggleSpell'),
    openWordCount: () => calls.push('openWordCount'),
    translateSelection: () => calls.push('translateSelection'),
    addComment: () => calls.push('addComment'),
    deleteComment: () => calls.push('deleteComment'),
    navigateComment: (direction) => calls.push(`navigateComment:${direction}`),
    toggleComments: () => calls.push('toggleComments'),
    toggleTrackChanges: () => calls.push('toggleTrackChanges'),
    toggleDiffView: () => calls.push('toggleDiffView'),
    acceptChange: (accept) => calls.push(`acceptChange:${accept}`),
    setView: (view) => calls.push(`setView:${view ?? 'page'}`),
    toggleRuler: () => calls.push('toggleRuler'),
    toggleGrid: () => calls.push('toggleGrid'),
    toggleNavigation: () => calls.push('toggleNavigation'),
    setZoom: (zoom) => calls.push(`setZoom:${zoom}`),
    fitZoom: (mode) => calls.push(`fitZoom:${mode}`),
    openWikipedia: () => calls.push('openWikipedia'),
  };
}

test('RichDoc command dispatch preserves editing and insertion routes', () => {
  const calls: string[] = [];
  const commands = context(calls);
  dispatchRichDocCommand('加粗', commands);
  dispatchRichDocCommand('清除格式', commands);
  dispatchRichDocCommand('拼音指南', commands);
  dispatchRichDocCommand('图片', commands);
  dispatchRichDocCommand('空白页', commands);
  assert.deepEqual(calls, [
    'exec:bold',
    'clearFormat',
    'ruby',
    'openImagePicker',
    'insertHTML:<div class="rd-pagebreak" contenteditable="false"></div><p><br></p><div class="rd-pagebreak" contenteditable="false"></div>',
  ]);
});

test('RichDoc command dispatch routes review, view, and layout state changes', () => {
  const calls: string[] = [];
  const commands = context(calls);
  dispatchRichDocCommand('接受', commands);
  dispatchRichDocCommand('拒绝', commands);
  dispatchRichDocCommand('显示标记', commands);
  dispatchRichDocCommand('页面视图', commands);
  dispatchRichDocCommand('页宽', commands);
  dispatchRichDocCommand('100%', commands);
  dispatchRichDocCommand('上一条', commands);
  assert.deepEqual(calls, ['acceptChange:true', 'acceptChange:false', 'toggleDiffView', 'setView:page', 'fitZoom:width', 'setZoom:1', 'navigateComment:-1']);
});

test('RichDoc command dispatch reports unknown and deferred commands explicitly', () => {
  const calls: string[] = [];
  const commands = context(calls);
  dispatchRichDocCommand('管理源', commands);
  dispatchRichDocCommand('未定义命令', commands);
  dispatchRichDocCommand('维基百科', commands);
  assert.deepEqual(calls, [
    'notify:translated:源管理暂用文档内直接编辑',
    'notify:translated:执行 · translated:未定义命令',
    'openWikipedia',
  ]);
});
