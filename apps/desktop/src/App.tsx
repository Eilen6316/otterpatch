import { useState } from 'react';

/**
 * 渐进披露驾驶舱(design.md §6)。
 * 默认只露"选区上下文 + 说想法";点"发送"后才展开计划 / 待提交 / PR 式 diff 卡片 / 接受拒绝。
 * 这是 UI 骨架 —— 左侧 Office 画布与右侧管线后续接 @office-agent/core + adapter-univer。
 */

const MARKUP_TOOLS = [
  { key: 'circle', icon: '⭕', label: '圈' },
  { key: 'arrow', icon: '➡️', label: '箭头' },
  { key: 'delete', icon: '✏️', label: '删' },
  { key: 'rewrite', icon: '〰️', label: '重写' },
  { key: 'ask', icon: '❓', label: '问' },
];

export function App() {
  const [planShown, setPlanShown] = useState(false);
  const [intent, setIntent] = useState('');

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="topbar">
        <span className="file">月度销售表.xlsx</span>
        <span className="dot saved">● 已保存</span>
        <span className="sep" />
        <button className="ghost">模型 ▾</button>
        <button className="ghost">↶ 撤销</button>
        <button className="ghost">↷ 重做</button>
        <button className="ghost">历史</button>
      </header>

      <main className="body">
        {/* 左:Office 画布 + 红笔工具条 */}
        <section className="editor">
          <div className="toolbar">
            {MARKUP_TOOLS.map((t) => (
              <button key={t.key} className="tool" title={t.label}>
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
            <span className="sep" />
            <button className="tool">缩放</button>
          </div>
          <div className="canvas">
            <div className="placeholder">
              <div className="selbox">圈选 B2:F20</div>
              <p>真实 Excel / Word 高保真画布(待接 Univer / ProseMirror）</p>
              <p className="muted">inline diff 将在此就地显示:E5 1200 → 📊+环比 ✓ ✗</p>
            </div>
          </div>
        </section>

        {/* 右:Agent 驾驶舱(渐进披露) */}
        <aside className="cockpit">
          <div className="ctx">
            <div className="ctx-title">① 你圈的</div>
            <div className="ctx-val">
              销售数据 12 行 5 列
              <span className="muted">(Sheet1!B2:F20,识别到表头)</span>
            </div>
          </div>

          <div className="intent">
            <div className="ctx-title">② 说想法 / 红笔标注</div>
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="例:统一日期格式、修复文本数字、标红异常值、补毛利率公式、生成问题清单…"
            />
            <button className="primary" onClick={() => setPlanShown(true)}>
              发送
            </button>
          </div>

          {planShown && (
            <div className="reveal">
              <div className="seg">
                <div className="ctx-title">③ 我打算做 4 件事</div>
                <ol className="plan">
                  <li>统一日期格式</li>
                  <li>修复被存成文本的数字</li>
                  <li>补齐毛利率公式</li>
                  <li>标红异常值并生成问题清单</li>
                </ol>
              </div>

              <div className="seg">
                <div className="ctx-title">④ 待提交</div>
                <div className="muted">改 18 格 · +1 列公式 · 5 处样式</div>
              </div>

              <div className="seg">
                <div className="ctx-title">⑤ diff 卡片(像 PR)</div>
                <DiffCard title="E2:E20 +毛利率公式" before="空白" after="=(C2-D2)/C2" />
                <DiffCard title="B7 标红" before="1,240" after="1,240 🔴" reason="数值 > 均值 2.5 倍" />
              </div>

              <div className="actions">
                <button className="primary">全部接受</button>
                <button className="ghost">部分接受</button>
                <button className="ghost">拒绝</button>
                <button className="ghost">回滚</button>
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* 底部:Git-like 提交记录 */}
      <footer className="history">
        📜 提交记录:<b>#3</b> 清洗销售表 ✓ · <b>#2</b> 改公式 ✓ · <b>#1</b> 初始化 ✓
        <span className="muted">↩ 可回滚</span>
      </footer>
    </div>
  );
}

function DiffCard(props: { title: string; before: string; after: string; reason?: string }) {
  return (
    <div className="diff-card">
      <div className="diff-title">{props.title}</div>
      <div className="diff-row">
        <span className="before">{props.before}</span>
        <span className="arrow">→</span>
        <span className="after">{props.after}</span>
      </div>
      {props.reason && <div className="reason">原因:{props.reason}</div>}
      <div className="diff-actions">
        <button className="mini ok">✓ 接受</button>
        <button className="mini no">✗ 拒绝</button>
      </div>
    </div>
  );
}
