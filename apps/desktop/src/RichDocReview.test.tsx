import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RichDocChangeCard,
  RichDocNavigationPane,
  RichDocRevisionBar,
  RichDocWordCountDialog,
} from './RichDocReview.js';

const revisionHandlers = {
  onPick: () => {},
  onStep: () => {},
  onResolve: () => {},
};

test('RichDoc revision bar hides cleanly without document changes', () => {
  const markup = renderToStaticMarkup(
    <RichDocRevisionBar
      visible={false}
      active="mark"
      changeCount={0}
      stepPosition={0}
      documentChanges={[]}
      linkedChangeId={null}
      {...revisionHandlers}
    />,
  );
  assert.equal(markup, '');
});

test('RichDoc revision bar renders view state, count, and linked document changes', () => {
  const markup = renderToStaticMarkup(
    <RichDocRevisionBar
      visible
      active="clean"
      changeCount={3}
      stepPosition={1}
      documentChanges={[{ cid: 'doc-1', label: '双栏布局' }]}
      linkedChangeId="doc-1"
      {...revisionHandlers}
    />,
  );
  assert.match(markup, /aria-label="Agent 修订"/);
  assert.match(markup, /data-idx="2"/);
  assert.match(markup, /class="rd-dt-count">2<i>\/<\/i>3<\/span>/);
  assert.match(markup, /class="rd-dt-docchg is-linked"/);
  assert.match(markup, />双栏布局<\/span>/);
  assert.match(markup, /aria-label="接受该全文改动"/);
  assert.match(markup, /aria-label="拒绝该全文改动"/);
});

test('RichDoc navigation pane renders empty and hierarchical states', () => {
  const empty = renderToStaticMarkup(<RichDocNavigationPane items={[]} onNavigate={() => {}} />);
  assert.match(empty, /暂无标题/);

  const populated = renderToStaticMarkup(
    <RichDocNavigationPane
      items={[{ level: 1, text: '概览', idx: 0 }, { level: 3, text: '细节', idx: 4 }]}
      onNavigate={() => {}}
    />,
  );
  assert.match(populated, /class="rd-nav-i lv1">概览<\/button>/);
  assert.match(populated, /class="rd-nav-i lv3">细节<\/button>/);
});

test('RichDoc word count dialog renders every projected metric', () => {
  const markup = renderToStaticMarkup(
    <RichDocWordCountDialog
      count={{ chars: 120, noSpace: 100, cjk: 40, words: 55, paras: 6 }}
      onClose={() => {}}
    />,
  );
  assert.match(markup, /字数统计/);
  for (const value of ['55', '100', '120', '40', '6']) assert.match(markup, new RegExp('>' + value + '<'));
  assert.match(markup, /class="drop-backdrop"/);
});

test('RichDoc change card renders a positioned before-after review', () => {
  const markup = renderToStaticMarkup(
    <RichDocChangeCard
      card={{ cid: 'change-1', kind: 'replace', oldText: '旧文', newText: '新文', glyph: '', x: 40, y: 80, below: true }}
      onKeep={() => {}}
      onClose={() => {}}
      onResolve={() => {}}
    />,
  );
  assert.match(markup, /class="rd-cardwrap below"/);
  assert.match(markup, /style="left:40px;top:80px"/);
  assert.match(markup, /class="rd-card-kind">替换<\/span>/);
  assert.match(markup, /class="rd-card-old">旧文<\/span>/);
  assert.match(markup, /class="rd-card-new">新文<\/span>/);
  assert.match(markup, />✕ 拒绝<\/button>/);
  assert.match(markup, />✓ 接受<\/button>/);
});
