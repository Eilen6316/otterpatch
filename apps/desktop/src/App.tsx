import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  IconGrid, IconSelect, IconArrow, IconStrike, IconPencil, IconHelp,
  IconFilter, IconFlag, IconSigma, IconPaperclip, IconImage, IconClock,
  IconSend, IconChevron, IconSearch, IconDots, IconUndo, IconCheck, IconX,
  IconDoc, IconPlus,
} from './icons.js';

/** 渐进披露驾驶舱(.work/design.md §6)。风格参照 Next AI Drawio:纯白、分区块、线性图标、无 emoji。 */

const TOOLS = [
  { Icon: IconSelect, label: '圈选', active: true },
  { Icon: IconArrow, label: '箭头' },
  { Icon: IconStrike, label: '删除' },
  { Icon: IconPencil, label: '重写' },
  { Icon: IconHelp, label: '提问' },
];

const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
const HEADERS = ['日期', '产品', '销量', '单价', '金额', '毛利率'];
const DATA = [
  ['01-03', 'A型', '120', '38'],
  ['01-05', 'B型', '86', '52'],
  ['01-09', 'A型', '1500', '38'],
  ['01-12', 'C型', '64', '70'],
  ['01-15', 'B型', '92', '52'],
];
const AMOUNT = ['4560', '4472', '57000', '4480', '4784'];
const MARGIN = ['41%', '37%', '41%', '28%', '37%'];
const ANOMALY_ROW = 2;

const EXAMPLES = [
  { Icon: IconFilter, t: '清洗这张表', d: '统一日期格式、修复被存成文本的数字、去空值' },
  { Icon: IconFlag, t: '标红异常值', d: '高亮偏离均值过大的数据,生成问题清单' },
  { Icon: IconSigma, t: '补公式 + 摘要', d: '按 销量×单价 补齐金额与毛利率,逐项确认' },
];

const RECENT = [
  { t: '清洗销售表', time: '刚刚' },
  { t: '改公式 E2:E6', time: '2 分钟前' },
  { t: '标红异常值', time: '今天 09:14' },
];

/** 8 家 BYOK 模型(与 @office-agent/agent 的 providers 对应)。 */
const MODEL_PROVIDERS = [
  { id: 'claude', label: 'Claude', model: 'claude-opus-4-8' },
  { id: 'openai', label: 'ChatGPT', model: 'gpt-5.5' },
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat' },
  { id: 'glm', label: '智谱 GLM', model: 'glm-4.6' },
  { id: 'kimi', label: 'Kimi', model: 'kimi-latest' },
  { id: 'doubao', label: '豆包', model: 'doubao-seed-1-6-251015' },
  { id: 'minimax', label: 'MiniMax', model: 'MiniMax-M2' },
  { id: 'gemini', label: 'Gemini', model: 'gemini-2.5-pro' },
];
const lsGet = (k: string, d: string): string =>
  typeof localStorage !== 'undefined' ? (localStorage.getItem(k) ?? d) : d;
const lsSet = (k: string, v: string): void => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
};

function Section({ label, children, defaultOpen = true }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sect">
      <button className="sect-head" onClick={() => setOpen(!open)}>
        <span className="lbl">{label}</span>
        <span className={'chev' + (open ? '' : ' closed')}><IconChevron size={14} /></span>
      </button>
      {open && <div className="sect-body">{children}</div>}
    </div>
  );
}

export function App() {
  const [sent, setSent] = useState(false);
  const [intent, setIntent] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);
  const [provider, setProvider] = useState(() => lsGet('oa.provider', 'claude'));
  const [model, setModel] = useState(() => lsGet('oa.model', 'claude-opus-4-8'));
  const [apiKey, setApiKey] = useState(() => lsGet('oa.apiKey', ''));
  const curProvider = MODEL_PROVIDERS.find((p) => p.id === provider) ?? MODEL_PROVIDERS[0]!;
  const pickProvider = (id: string): void => {
    const p = MODEL_PROVIDERS.find((x) => x.id === id) ?? MODEL_PROVIDERS[0]!;
    setProvider(p.id);
    lsSet('oa.provider', p.id);
    setModel(p.model);
    lsSet('oa.model', p.model);
  };

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
          <span className="mark"><IconGrid size={18} /></span>
          Office Agent <span className="sub">workbench</span>
        </div>
        <div className="file">
          <span className="name">月度销售表.xlsx</span>
          <span className="saved">已保存</span>
        </div>
        <div className="grow" />
        <button className="zoom"><IconSearch size={14} /> 100%</button>
        <button className="icon-ghost" title="更多"><IconDots size={18} /></button>
      </header>

      <main className="body">
        <section className="editor">
          <div className="toolbar">
            {TOOLS.map((t) => {
              const Ico = t.Icon;
              return (
                <button key={t.label} className={'tool' + (t.active ? ' active' : '')} title={t.label}>
                  <Ico size={18} />
                </button>
              );
            })}
            <span className="div" />
            <button className="tool" title="撤销"><IconUndo size={18} /></button>
          </div>
          <div className="canvas">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="colh" />
                  {COLS.map((c) => <th key={c} className="colh">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="rowh">1</td>
                  {HEADERS.map((h) => <td key={h} className="name">{h}</td>)}
                </tr>
                {DATA.map((row, ri) => (
                  <tr key={ri}>
                    <td className="rowh">{ri + 2}</td>
                    {COLS.map((_, ci) => (
                      <td key={ci} className={cellClass(ri, ci)}>{cellValue(row, ri, ci)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rail">
          <div className="selbar">
            <span className="dot" />
            选区 <span className="ref">C2:F6</span>
            <span className="grow" />
            <span>销售数据 5 × 4</span>
          </div>

          <div className="rail-body">
            {!sent ? (
              <>
                <Section label="建议操作">
                  {EXAMPLES.map((e) => {
                    const Ico = e.Icon;
                    return (
                      <button key={e.t} className="example" onClick={() => setSent(true)}>
                        <span className="ico"><Ico size={17} /></span>
                        <span>
                          <div className="t">{e.t}</div>
                          <div className="d">{e.d}</div>
                        </span>
                      </button>
                    );
                  })}
                </Section>

                <Section label="指令模板">
                  <div className="tmpl-empty">
                    <div className="badge"><IconDoc size={20} /></div>
                    <div className="te-t">暂无模板</div>
                    <div className="te-d">把常用指令存成模板,下次圈选后一键复用</div>
                    <button className="btn solid"><IconPlus size={14} /> 新建模板</button>
                  </div>
                </Section>

                <Section label="最近">
                  {RECENT.map((r) => (
                    <button key={r.t} className="recent">
                      <span className="ic"><IconCheck size={15} /></span>
                      <span>
                        <div className="t">{r.t}</div>
                        <div className="time">{r.time}</div>
                      </span>
                    </button>
                  ))}
                </Section>
              </>
            ) : (
              <Section label="本次改动 · 3">
                <ul className="plan">
                  <li>按 销量×单价 补齐「金额」列</li>
                  <li>新增「毛利率」列</li>
                  <li>标记偏离均值过大的异常值</li>
                </ul>
                <div className="summary">+10 单元格 · +1 列公式 · 1 处标记</div>

                <Change tag="公式" title="E2:E6" before="空" after="=C×D" why="按 销量×单价 自动补齐金额" />
                <Change tag="新列" title="F2:F6" before="空" after="41% / 37% …" why="新增毛利率列" />
                <Change tag="标记" title="C4" before="1500" after="1500" why="偏离均值约 8 倍,疑似录入错误" />

                <div className="bulk">
                  <button className="btn ok"><IconCheck size={14} /> 全部接受</button>
                  <button className="btn">部分接受</button>
                  <button className="btn no"><IconX size={14} /> 拒绝</button>
                </div>
              </Section>
            )}
          </div>

          <div className="composer">
            {cfgOpen && (
              <div className="modelcfg">
                <h4>模型 · BYOK</h4>
                <div className="prov">
                  {MODEL_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      className={'pchip' + (p.id === provider ? ' on' : '')}
                      onClick={() => pickProvider(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <label>模型</label>
                <input
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    lsSet('oa.model', e.target.value);
                  }}
                  placeholder={curProvider.model}
                />
                <label>API Key(BYOK)</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    lsSet('oa.apiKey', e.target.value);
                  }}
                  placeholder="sk-..."
                />
                <div className="note">
                  <IconHelp size={13} /> 密钥只存在你的浏览器本地,绝不上传服务器。
                </div>
              </div>
            )}
            <div className="box">
              <textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="圈一块区域,说说你想怎么改…"
                rows={1}
              />
              <div className="row">
                <button className="iconbtn" title="附件"><IconPaperclip size={17} /></button>
                <button className="iconbtn" title="图片"><IconImage size={17} /></button>
                <button className="iconbtn" title="历史"><IconClock size={17} /></button>
                <span className="grow" />
                <button className={'model' + (cfgOpen ? ' on' : '')} onClick={() => setCfgOpen((v) => !v)}>
                  {curProvider.label} <IconChevron size={13} />
                </button>
                <button className="send" title="发送" onClick={() => setSent(true)}><IconSend size={16} /></button>
              </div>
            </div>
          </div>
        </aside>
      </main>
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
        <button className="btn ok"><IconCheck size={14} /> 接受</button>
        <button className="btn no"><IconX size={14} /> 拒绝</button>
      </div>
    </div>
  );
}
