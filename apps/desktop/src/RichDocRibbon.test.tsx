import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichDocRibbon, RICH_DOC_MENU_COMMANDS, RICH_DOC_RIBBON_TABS } from './RichDocRibbon.js';

const handlers = {
  onTabChange: () => {},
  onCommand: () => {},
  onOpenMenu: () => {},
  onApplyStyle: () => {},
  onApplyColor: () => {},
  onSpin: () => {},
  onMouseOver: () => {},
  onMouseOut: () => {},
  onMouseDownCapture: () => {},
};

test('RichDoc ribbon exposes the six stable document tabs and menu commands', () => {
  assert.deepEqual(RICH_DOC_RIBBON_TABS.map((tab) => tab.name), ['开始', '插入', '布局', '引用', '审阅', '视图']);
  assert.equal(RICH_DOC_MENU_COMMANDS.has('字体'), true);
  assert.equal(RICH_DOC_MENU_COMMANDS.has('加粗'), false);
});

test('RichDoc ribbon renders command state, open menus, and document counters', () => {
  const markup = renderToStaticMarkup(
    <RichDocRibbon
      tab={0}
      font="Calibri"
      fontSize={12}
      openMenuKey="字体"
      foregroundColor="#c00000"
      highlightColor="#ffe600"
      wordCount={321}
      zoomPercent={125}
      isActive={(label) => label === '加粗'}
      {...handlers}
    />,
  );
  assert.match(markup, /class="rtab on">开始<\/button>/);
  assert.match(markup, /class="rcombo font open"/);
  assert.match(markup, /class="rc-val">Calibri<\/span>/);
  assert.match(markup, /class="rcombo size"/);
  assert.match(markup, /class="rs biu biu-b on"/);
  assert.match(markup, /字数 321/);
  assert.match(markup, />125%<\/button>/);
});

test('RichDoc ribbon renders only the selected tab groups', () => {
  const markup = renderToStaticMarkup(
    <RichDocRibbon
      tab={2}
      font=""
      fontSize={0}
      openMenuKey={null}
      foregroundColor="#000000"
      highlightColor="#ffff00"
      wordCount={0}
      zoomPercent={100}
      isActive={() => false}
      {...handlers}
    />,
  );
  assert.match(markup, /页面设置/);
  assert.match(markup, /data-cmd="页边距"/);
  assert.doesNotMatch(markup, /data-cmd="粘贴"/);
});
