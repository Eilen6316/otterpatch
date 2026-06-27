import { useState } from 'react';

/**
 * 渐进披露驾驶舱(.work/design.md §6)。设计立场见 styles.css 顶部注释。
 * 招牌元素 = 单元格内联 diff + 选区高亮(产品命题:像审 PR 一样审 Office 改动)。
 */

const MARKUP_TOOLS = [
  { icon: '⭕', label: '圈选' },
  { icon: '➡️', label: '箭头' },
  { icon: '✂', label: '删除' },
  { icon: '〰', label: '重写' },
  { icon: '?', label: '提问' },
];

const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
const HEADERS = ['日期', '产品', '销量', '单价', '金额', '毛利率'];
const DATA = [
  ['01-03', 'A型', '120', '38'],
  ['01-05', 'B型', '86', '52'],
  ['01-09', 'A型', '1500', '38'], // 异常行
  ['01-12', 'C型', '64', '70'],
  ['01-15', 'B型', '92', '52'],
];
const AMOUNT = ['4560', '4472', '57000', '4480', '4784'];
const MARGIN = ['41%', '37%', '41%', '28%', '37%'];
const ANOMALY_ROW = 2;

const EXAMPLES = [
  { icon: '🧹', t: '清洗这张表', d: '统一日期格式、修复被存成文本的数字、去空值' },
  { icon: '🚩', t: '标红异常值', d: '高亮偏离均值过大的数据,生成问题清单' },
  { icon: '∑', t: '补公式 + 摘要', d: '按 销量×单价 补齐金额与毛利率,先让我逐项确认' },
];

export function App() {
  const [sent, setSent] = useState(false);
  const [intent, setIntent] = useState('');

  const cellClass = (ri: number, ci: number): string => {
    if (!sent) return ci >= 2 ? 'sel' : '';
    if (ci === 4 || ci === 5) return 'add';
    if (ci === 2 && ri === ANOMALY_ROW) return 'del';
    return '';
  };
  const cellValue = (row: string[], ri: number, ci: number): string => {
    if (ci <= 3) return row[ci] ?? '';
    if (ci === 4) return sent ? (AMOUNT[ri] ?? '') : '';
    return sent ? (MARGIN[ri] ?? '') : '';
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">◇</span>
          Office Agent <span className="sub">workbench</span>
        </div>
        <div className="file">
          <span className="name">月度销售表.xlsx</span>
          <span className="saved">已保存</span>
        </div>
        <div className="grow" />
        <button className="chip">⌕ 缩放 100%</button>
        <button className="chip">设置</button>
      </header>

      <main className="body">
        {/* 左:文档画布(主场) */}
        <section className="editor">
          <div className="toolbar">
            {MARKUP_TOOLS.map((t) => (
              <button key={t.label} className="tool" title={t.label}>
                <span aria-hidden>{t.icon}</span>
                {t.label}
              </button>
            ))}
            <span className="div" />
            <button className="tool">撤销</button>
            <button className="tool">重做</button>
          </div>
          <div className="canvas">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="colh" />
                  {COLS.map((c) => (
                    <th key={c} className="colh">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="rowh">1</td>
                  {HEADERS.map((h) => (
                    <td key={h} className="name">{h}</td>
                  ))}
                </tr>
                {DATA.map((row, ri) => (
                  <tr key={ri}>
                    <td className="rowh">{ri + 2}</td>
                    {COLS.map((_, ci) => (
                      <td key={ci} className={cellClass(ri, ci)}>
                        {cellValue(row, ri, ci)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 右:审阅栏 */}
        <aside className="rail">
          <div className="rail-body">
            {!sent && (
              <div className="thesis">
                <h2>先审，再落盘。</h2>
                <p>AI 不直接改你的文件——它把改动当成一个 PR。圈一块、说一句,改动逐条可看、可拒、可回滚。</p>
              </div>
            )}

            <div className="ctx">
              <span className="k">你圈的</span>
              <span className="v">销售数据 5 行 4 列</span>
              <span className="ref">C2:F6</span>
            </div>

            {!sent && (
              <>
                <div className="section-label">快速开始</div>
                {EXAMPLES.map((e) => (
                  <button key={e.t} className="example" onClick={() => setSent(true)}>
                    <span className="ico" aria-hidden>{e.icon}</span>
                    <span>
                      <div className="t">{e.t}</div>
                      <div className="d">{e.d}</div>
                    </span>
                  </button>
                ))}
              </>
            )}

            {sent && (
              <>
                <div className="section-label">我打算做</div>
                <ul className="plan">
                  <li>按 销量×单价 补齐「金额」列</li>
                  <li>新增「毛利率」列</li>
                  <li>标红偏离均值过大的异常值</li>
                </ul>
                <div className="summary">+10 单元格 · +1 列公式 · 1 处标记</div>

                <div className="section-label">待审改动 · 3</div>
                <Change tag="公式" title="E2:E6 金额" before="空" after="=C×D" why="按 销量×单价 自动补齐" />
                <Change tag="新列" title="F2:F6 毛利率" before="空" after="41% / 37% …" why="新增毛利率列" />
                <Change tag="标记" title="C4 销量" before="1500" after="1500 ⚠" why="偏离均值约 8 倍,疑似录入错误" />

                <div className="bulk">
                  <button className="mini ok">✓ 全部接受</button>
                  <button className="mini">部分接受</button>
                  <button className="mini no">✗ 拒绝</button>
                </div>
              </>
            )}
          </div>

          {/* composer */}
          <div className="composer">
            <div className="box">
              <textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="圈一块区域,说说你想怎么改…"
                rows={1}
              />
              <div className="row">
                <button className="iconbtn" title="附件">📎</button>
                <button className="iconbtn" title="图片">🖼</button>
                <button className="iconbtn" title="历史">🕘</button>
                <span className="grow" />
                <button className="model">默认模型 ▾</button>
                <button className="send" title="发送" onClick={() => setSent(true)}>➤</button>
              </div>
            </div>
          </div>
        </aside>
      </main>

      <footer className="history">
        <span>提交记录</span>
        <span className="id">#3</span> 清洗销售表
        <span className="sep">·</span>
        <span className="id">#2</span> 改公式
        <span className="sep">·</span>
        <span className="id">#1</span> 初始化
        <span className="rollback">↩ 回滚</span>
      </footer>
    </div>
  );
}

function Change(props: { tag: string; title: string; before: string; after: string; why: string }) {
  return (
    <div className="change">
      <div className="head">
        <span className="tag">{props.tag}</span>
        <span className="ttl">{props.title}</span>
      </div>
      <div className="body2">
        <div className="ba">
          <span className="before">{props.before}</span>
          <span className="arr">→</span>
          <span className="after">{props.after}</span>
        </div>
        <div className="why">{props.why}</div>
      </div>
      <div className="acts">
        <button className="mini ok">✓ 接受</button>
        <button className="mini no">✗ 拒绝</button>
      </div>
    </div>
  );
}
