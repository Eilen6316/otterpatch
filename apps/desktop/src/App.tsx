import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  IconGrid, IconSelect, IconArrow, IconStrike, IconPencil, IconHelp,
  IconFilter, IconFlag, IconSigma, IconPaperclip, IconImage, IconClock,
  IconSend, IconChevron, IconSearch, IconDots, IconUndo, IconCheck, IconX,
  IconDoc, IconPlus,
} from './icons.js';

/** 渐进披露驾驶舱(.work/design.md §6)。风格参照 Next AI Drawio:纯白、分区块、线性图标、无 emoji。 */

/** 工作区格式:文件名 + 工具栏随之联动。 */
const FORMATS = [
  { id: 'excel', label: 'Excel', file: '月度销售表.xlsx' },
  { id: 'word', label: 'Word', file: '实训报告.docx' },
  { id: 'ppt', label: 'PPT', file: '季度汇报.pptx' },
  { id: 'drawio', label: '流程图', file: '系统架构.drawio' },
] as const;
type Fmt = (typeof FORMATS)[number]['id'];

/** 每种格式对应的工具栏(菜单栏随工作区格式而变)。 */
const TOOLSETS: Record<Fmt, Array<{ Icon: typeof IconSelect; label: string }>> = {
  excel: [
    { Icon: IconSelect, label: '圈选区域' },
    { Icon: IconSigma, label: '求和/统计' },
    { Icon: IconPencil, label: '公式' },
    { Icon: IconFilter, label: '排序筛选' },
    { Icon: IconFlag, label: '标记异常' },
  ],
  word: [
    { Icon: IconSelect, label: '选择文字' },
    { Icon: IconPencil, label: '加粗/样式' },
    { Icon: IconDoc, label: '标题层级' },
    { Icon: IconHelp, label: '批注' },
    { Icon: IconStrike, label: '修订红线' },
  ],
  ppt: [
    { Icon: IconSelect, label: '选择对象' },
    { Icon: IconDoc, label: '文本框' },
    { Icon: IconGrid, label: '形状' },
    { Icon: IconImage, label: '图片' },
    { Icon: IconFlag, label: '版式' },
  ],
  drawio: [
    { Icon: IconSelect, label: '选择' },
    { Icon: IconPlus, label: '添加节点' },
    { Icon: IconArrow, label: '连线' },
    { Icon: IconPencil, label: '样式' },
    { Icon: IconGrid, label: '布局' },
  ],
};
const PLACEHOLDERS: Record<Fmt, string> = {
  excel: '圈一块区域,说说你想怎么改…',
  word: '选中文字,说说你想怎么改…',
  drawio: '选中节点/连线,说说你想怎么改…',
  ppt: '选中对象,说说你想怎么改…',
};
const CANVAS_HINT: Record<Fmt, string> = {
  excel: '',
  word: '流式文档:选中文字 → 指令 → 红线修订(@opal/adapter-word)',
  drawio: '流程图:选中节点/连线 → 指令 → 按 mxCell id 改(@opal/adapter-drawio)',
  ppt: '幻灯片:选中对象 → 指令 → 版式/文本(适配器规划中)',
};

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
const ANOMALY_ROWIDX = 3; // 1500 那行(DATA[2])在网格里的 rowIdx(0=表头行)

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

/** 8 家 BYOK 模型(与 @opal/agent 的 providers 对应)。 */
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

interface Sel { ar: number; ac: number; br: number; bc: number }

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
  const [fmt, setFmt] = useState<Fmt>('excel');
  const [intent, setIntent] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);
  const [provider, setProvider] = useState(() => lsGet('oa.provider', 'claude'));
  const [model, setModel] = useState(() => lsGet('oa.model', 'claude-opus-4-8'));
  const [apiKey, setApiKey] = useState(() => lsGet('oa.apiKey', ''));
  // 选区:锚点 (ar,ac) → 焦点 (br,bc);rowIdx 0=表头行,1..5=数据行;col 0..5=A..F
  const [sel, setSel] = useState<Sel>({ ar: 1, ac: 2, br: 5, bc: 5 });
  const dragRef = useRef(false);
  // 双击进入单元格编辑;改动存 overrides(以 "ri,ci" 为键),覆盖原始显示值
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ ri: number; ci: number } | null>(null);
  const [editVal, setEditVal] = useState('');
  const cellKey = (ri: number, ci: number): string => ri + ',' + ci;

  const curProvider = MODEL_PROVIDERS.find((p) => p.id === provider) ?? MODEL_PROVIDERS[0]!;
  const pickProvider = (id: string): void => {
    const p = MODEL_PROVIDERS.find((x) => x.id === id) ?? MODEL_PROVIDERS[0]!;
    setProvider(p.id);
    lsSet('oa.provider', p.id);
    setModel(p.model);
    lsSet('oa.model', p.model);
  };

  // 拖选:松开鼠标即结束(全局监听,松手在表外也算)
  useEffect(() => {
    const up = (): void => {
      dragRef.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const r1 = Math.min(sel.ar, sel.br);
  const r2 = Math.max(sel.ar, sel.br);
  const c1 = Math.min(sel.ac, sel.bc);
  const c2 = Math.max(sel.ac, sel.bc);
  const inSel = (ri: number, ci: number): boolean => ri >= r1 && ri <= r2 && ci >= c1 && ci <= c2;
  const a1 = (ri: number, ci: number): string => `${COLS[ci]}${ri + 1}`; // rowIdx 0 → 行 1
  const rangeLabel = r1 === r2 && c1 === c2 ? a1(r1, c1) : `${a1(r1, c1)}:${a1(r2, c2)}`;
  const selRows = r2 - r1 + 1;
  const selCols = c2 - c1 + 1;
  const curFmt = FORMATS.find((f) => f.id === fmt) ?? FORMATS[0];
  const isExcel = fmt === 'excel';

  const gridValue = (ri: number, ci: number): string => {
    const ov = overrides[cellKey(ri, ci)];
    if (ov !== undefined) return ov;
    if (ri === 0) return HEADERS[ci] ?? '';
    const di = ri - 1;
    const row = DATA[di] ?? [];
    if (ci <= 3) return row[ci] ?? '';
    if (ci === 4) return sent ? (AMOUNT[di] ?? '') : '';
    return sent ? (MARGIN[di] ?? '') : '';
  };
  const cellClass = (ri: number, ci: number): string => {
    const cls: string[] = [];
    if (inSel(ri, ci)) cls.push('sel');
    if (sent && ri >= 1) {
      if (ci === 4 || ci === 5) cls.push('add');
      else if (ci === 2 && ri === ANOMALY_ROWIDX) cls.push('del');
    }
    return cls.join(' ');
  };

  const onDown = (ri: number, ci: number): void => {
    setSel({ ar: ri, ac: ci, br: ri, bc: ci });
    dragRef.current = true;
  };
  const onEnter = (ri: number, ci: number): void => {
    if (dragRef.current) setSel((s) => ({ ...s, br: ri, bc: ci }));
  };
  const selColumn = (ci: number): void => setSel({ ar: 0, ac: ci, br: 5, bc: ci });
  const selRow = (ri: number): void => setSel({ ar: ri, ac: 0, br: ri, bc: 5 });

  const beginEdit = (ri: number, ci: number): void => {
    setEditing({ ri, ci });
    setEditVal(gridValue(ri, ci));
  };
  const commitEdit = (): void => {
    if (editing) setOverrides((o) => ({ ...o, [cellKey(editing.ri, editing.ci)]: editVal }));
    setEditing(null);
  };
  const cellInner = (ri: number, ci: number): ReactNode =>
    editing && editing.ri === ri && editing.ci === ci ? (
      <input
        className="celledit"
        autoFocus
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitEdit();
          else if (e.key === 'Escape') setEditing(null);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      />
    ) : (
      gridValue(ri, ci)
    );

  /** 发送时随消息一并交给 Agent 的选区上下文(= ProposeRequest.context)。 */
  const selectionContext = (): string => {
    const lines = [`选区 ${rangeLabel}`];
    for (let r = r1; r <= r2; r++) {
      const cells: string[] = [];
      for (let c = c1; c <= c2; c++) cells.push(gridValue(r, c) || '(空)');
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  };
  const send = (): void => {
    // 选区随消息一并发给 Agent。接真后端时:
    // agent.propose({ format:'excel', intent, context: selectionContext(), baseRev, anchors, hostId })
    void selectionContext();
    setSent(true);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark"><IconGrid size={18} /></span>
          OPAL <span className="sub">safe-commit layer</span>
        </div>
        <div className="fmttabs">
          {FORMATS.map((f) => (
            <button key={f.id} className={'fmttab' + (f.id === fmt ? ' on' : '')} onClick={() => setFmt(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="file">
          <span className="name">{curFmt.file}</span>
          <span className="saved">已保存</span>
        </div>
        <div className="grow" />
        <button className="zoom"><IconSearch size={14} /> 100%</button>
        <button className="icon-ghost" title="更多"><IconDots size={18} /></button>
      </header>

      <main className="body">
        <section className="editor">
          <div className="toolbar">
            {TOOLSETS[fmt].map((t, i) => {
              const Ico = t.Icon;
              return (
                <button key={t.label} className={'tool' + (i === 0 ? ' active' : '')} title={t.label}>
                  <Ico size={18} />
                </button>
              );
            })}
            <span className="div" />
            <button className="tool" title="撤销"><IconUndo size={18} /></button>
          </div>
          <div className="canvas">
            {isExcel ? (
            <table className="sheet">
              <thead>
                <tr>
                  <th className="colh corner" />
                  {COLS.map((c, ci) => (
                    <th key={c} className="colh" onMouseDown={() => selColumn(ci)}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="rowh" onMouseDown={() => selRow(0)}>1</td>
                  {HEADERS.map((_, ci) => (
                    <td
                      key={ci}
                      className={('name ' + cellClass(0, ci)).trim()}
                      onMouseDown={() => onDown(0, ci)}
                      onMouseEnter={() => onEnter(0, ci)}
                      onDoubleClick={() => beginEdit(0, ci)}
                    >
                      {cellInner(0, ci)}
                    </td>
                  ))}
                </tr>
                {DATA.map((_, di) => {
                  const ri = di + 1;
                  return (
                    <tr key={di}>
                      <td className="rowh" onMouseDown={() => selRow(ri)}>{ri + 1}</td>
                      {COLS.map((_, ci) => (
                        <td
                          key={ci}
                          className={cellClass(ri, ci)}
                          onMouseDown={() => onDown(ri, ci)}
                          onMouseEnter={() => onEnter(ri, ci)}
                          onDoubleClick={() => beginEdit(ri, ci)}
                        >
                          {cellInner(ri, ci)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            ) : (
              <div className="canvas-ph">
                <div className="ph-badge"><IconDoc size={26} /></div>
                <div className="ph-t">{curFmt.label} 渲染区</div>
                <div className="ph-d">{CANVAS_HINT[fmt]}</div>
              </div>
            )}
          </div>
        </section>

        <aside className="rail">
          <div className="selbar">
            <span className="dot" />
            选区 <span className="ref">{isExcel ? rangeLabel : '—'}</span>
            <span className="grow" />
            <span>{isExcel ? `${selRows} × ${selCols} 单元格` : `${curFmt.label} 工作区`}</span>
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
              <div className="selchip">
                <span className="dot" />{' '}
                {isExcel ? (
                  <>
                    已选 <b>{rangeLabel}</b> · {selRows}×{selCols}
                  </>
                ) : (
                  <>
                    当前 <b>{curFmt.label}</b> 工作区
                  </>
                )}
                ,发送时随选区一并给 Agent
              </div>
              <textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder={PLACEHOLDERS[fmt]}
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
                <button className="send" title="发送" onClick={send}><IconSend size={16} /></button>
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
