import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { IconX } from './icons.js';
import { asLang, LANGS, makeT, TContext, type Lang } from './i18n.js';
import type { UniSel, SheetHandle } from './UniverSheet.js';
import type { RichDocHandle, WordSel } from './RichDoc.js';
import { akey } from './review-shared.js';
import {
  browserLocalCredential,
  browserLocalCredentialsAvailable,
  setBrowserLocalCredential,
} from './electron-bridge.js';
import { wordEditOpts } from './proposal-materializers.js';
import { applyBoardPatchView, revertBoardPatch } from './drawio-review-adapter.js';
import type { AgentDiffItem, WordEdit } from './proposal-materializers.js';
import type { DiffTurn, Turn, WorkspaceFormat as Fmt } from './app-thread-types.js';
import { useFileImport } from './use-file-import.js';
import { useCommitWriteback } from './use-commit-writeback.js';
import { useReviewState } from './use-review-state.js';
import { useReviewActions } from './use-review-actions.js';
import { useProposalStream } from './use-proposal-stream.js';
import { ReviewBox } from './ReviewBox.js';
import { DiffToggle } from './DiffToggle.js';
import { AgentHome } from './AgentHome.js';
import { Composer } from './Composer.js';
import { TopBar } from './TopBar.js';
import { DrawioBoard } from './DrawioBoard.js';
import type { BoardSel, BoardHandle } from './DrawioBoard.js';
import { DrawioPalette, DrawioToolbar } from './DrawioChrome.js';
import { AgentStatusLine, ClarifyCard } from './ThreadCards.js';
import { Markdown } from './Markdown.js';
import {
  findLatestExcelDiffTurn,
  renderExcelDiffView,
  revertGridOp,
  type ExcelDiffView,
} from './excel-review-adapter.js';
import { sanitizeThread as sanitizeAppThread } from './app-history.js';

// Shared review ids and batch guards live in ./review-shared.ts (god-file decomposition).
// AgentStatusLine / ClarifyCard moved to ./ThreadCards.tsx (decomposition phase 5).

/** 真 Univer 表格(体积大 → 懒加载,仅 Excel 用)。 */
const UniverSheet = lazy(() => import('./UniverSheet.js'));
/** Word 文档工作区:自控富文本编辑器(懒加载,仅 Word 用)。 */
const RichDoc = lazy(() => import('./RichDoc.js'));

function freshLocalId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) throw new Error('secure UUID generation is unavailable');
  return value;
}

function persistedLocalId(key: string): string {
  try {
    const existing = localStorage.getItem(key)?.trim();
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) return existing;
    const value = freshLocalId();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return freshLocalId();
  }
}

/** 渐进披露驾驶舱。风格参照 Next AI Drawio:纯白、分区块、线性图标、无 emoji。五语 i18n(t 包裹显示文案)。 */

/** 工作区格式:文件名 + 工具栏随之联动。 */
const FORMATS = [
  { id: 'excel', label: 'Excel', file: '月度销售表.xlsx' },
  { id: 'word', label: 'Word', file: '实训报告.docx' },
  { id: 'drawio', label: '流程图', file: '系统架构.drawio' },
] as const satisfies ReadonlyArray<{ id: Fmt; label: string; file: string }>;

const isWorkspaceFormat = (value: string): value is Fmt => FORMATS.some((format) => format.id === value);

/** Drawio 填充色面板。 */
type Drop = { type: 'colors' };

const COLORS = [
  '#000000', '#ffffff', '#e7e6e6', '#d0cece', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47',
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0',
];

const DROPDOWNS: Record<string, Drop> = {
  填充色: { type: 'colors' },
};

const PLACEHOLDERS: Record<Fmt, string> = {
  excel: '圈一块区域,说说你想怎么改…',
  word: '选中文字,说说你想怎么改…',
  drawio: '选中节点/连线,说说你想怎么改…',
};
// QUICKS moved into ./AgentHome.tsx (god-file decomposition).


const MODEL_PROVIDERS = [
  { id: 'claude', label: 'Claude', model: 'claude-opus-4-8' },
  { id: 'openai', label: 'ChatGPT', model: 'gpt-5.5' },
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-flash' },
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

function normalizeLocalEndpoint(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) return null;
    u.hash = '';
    u.search = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
/** Agent 反向澄清:像 Claude Code 那样给引导选择表(2-4 项)+ 允许自填。 */
// ClarifyOption / ClarifyQuestion live in ./app-thread-types.ts.

export function App() {
  const browserCredentialsEnabled = browserLocalCredentialsAvailable();
  const [lang, setLang] = useState<Lang>(() => asLang(lsGet('oa.lang', 'zh')));
  const t = makeT(lang);
  const [fmt, setFmt] = useState<Fmt>(() => {
    const stored = lsGet('oa.fmt', 'excel');
    return isWorkspaceFormat(stored) ? stored : 'excel';
  });
  const [drop, setDrop] = useState<{ key: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (msg: string): void => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };
  const [intent, setIntent] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);
  const [provider, setProvider] = useState(() => lsGet('oa.provider', 'claude'));
  const [model, setModel] = useState(() => lsGet('oa.model', 'claude-opus-4-8'));
  const [apiKey, setApiKey] = useState('');
  const [server, setServer] = useState(() => lsGet('oa.server', 'http://localhost:4319'));
  const [serveToken, setServeToken] = useState(() => browserLocalCredential('oa.serveToken'));
  const [reviewToken, setReviewToken] = useState(() => browserLocalCredential('oa.reviewToken'));
  useEffect(() => { try { localStorage.removeItem('oa.apiKey'); } catch { /* ignore */ } }, []);
  const [uniSel, setUniSel] = useState<UniSel | null>(null);
  const [excelDiff, setExcelDiff] = useState<ExcelDiffView>('final'); // Excel 改动视图:原文/对照(改动格着色)/改后
  const [boardDiff, setBoardDiff] = useState<'orig' | 'final'>('final'); // drawio 改动视图:原文(隐提案)/改后
  const [wordSel, setWordSel] = useState<WordSel | null>(null);
  const [hoverCid, setHoverCid] = useState<string | null>(null); // 文档里/rail 悬停联动的改动 domId
  const [boardSel, setBoardSel] = useState<BoardSel | null>(null);
  const univerRef = useRef<SheetHandle>(null);
  const boardRef = useRef<BoardHandle>(null);
  const wordRef = useRef<RichDocHandle>(null);
  const { fileB64, fileName, fileSnapshot, onFile } = useFileImport({
    format: fmt,
    wordRef,
    boardRef,
    notify,
    t,
  });
  const [reviewIdx, setReviewIdx] = useState(0);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const lsJson = <T,>(k: string, fb: T): T => { try { const v = JSON.parse(localStorage.getItem(k) ?? 'null'); return v == null ? fb : (v as T); } catch { return fb; } };
  const [localUserId] = useState(() => persistedLocalId('oa.auditUserId'));
  const [conversationSessionId, setConversationSessionId] = useState(() => persistedLocalId('oa.auditSessionId'));
  // Cursor 式连续对话流 + 模型历史,持久化到当前工作区(localStorage)
  const [thread, setThread] = useState<Turn[]>(() => sanitizeAppThread(lsJson<Turn[]>('oa.thread', []))
    .filter((turn) => turn.role !== 'assistant' || turn.kind !== 'diff' || isWorkspaceFormat(turn.format)));
  const [recent, setRecent] = useState<{ t: string; time: string }[]>([]);
  const [realCs, setRealCs] = useState<unknown>(null);
  const [accepted, setAccepted] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('oa.accepted') ?? '[]') as string[]); } catch { return new Set(); } }); // 随 thread 持久化:刷新后审批处置不丢
  const [rejected, setRejected] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('oa.rejected') ?? '[]') as string[]); } catch { return new Set(); } });
  const { clearAccepted, toggleAccept, acceptMany, markCommitted, markReverted, markClarifyAnswered } = useReviewState({ setThread, setAccepted, setRejected });
  useEffect(() => { try { localStorage.setItem('oa.accepted', JSON.stringify([...accepted])); } catch { /* 配额忽略 */ } }, [accepted]);
  useEffect(() => { try { localStorage.setItem('oa.rejected', JSON.stringify([...rejected])); } catch { /* 配额忽略 */ } }, [rejected]);
  useEffect(() => { // 接受率遥测读取口:控制台 __otterTelemetry() 看 格式×改动类型 的 accept/reject 分布
    (window as unknown as { __otterTelemetry?: () => unknown }).__otterTelemetry = () => { try { return JSON.parse(localStorage.getItem('oa.telemetry') ?? '{}'); } catch { return {}; } };
  }, []);
  // 自动续批(opt-in):plan 声明分批 + 用户开着开关 → 全部接受后自动续发"下一批";每批仍走完整 propose→verify→审阅,写是串行的
  const [autoBatch, setAutoBatch] = useState(() => localStorage.getItem('oa.autobatch') === '1');
  useEffect(() => { try { localStorage.setItem('oa.autobatch', autoBatch ? '1' : '0'); } catch { /* 忽略 */ } }, [autoBatch]);
  const autoBatchRun = useRef(0); // 连续自动批次计数(手动指令即清零,上限 AUTO_BATCH_CAP)
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const { ensureCommitFile, doCommit } = useCommitWriteback({
    server,
    realChangeSet: realCs,
    fileBase64: fileB64,
    fileName,
    fileSnapshot,
    notify,
    t,
    setBusy,
    normalizeLocalEndpoint,
  });
  const curProvider = MODEL_PROVIDERS.find((p) => p.id === provider) ?? MODEL_PROVIDERS[0]!;
  const pickProvider = (id: string): void => {
    const p = MODEL_PROVIDERS.find((x) => x.id === id) ?? MODEL_PROVIDERS[0]!;
    setProvider(p.id);
    lsSet('oa.provider', p.id);
    setModel(p.model);
    lsSet('oa.model', p.model);
  };
  const pickLang = (l: Lang): void => {
    setLang(l);
    lsSet('oa.lang', l);
  };
  // 对话历史持久化到当前工作区
  useEffect(() => {
    try {
      localStorage.setItem('oa.thread', JSON.stringify(thread));
    } catch {
      /* 配额满时忽略 */
    }
  }, [thread]);
  // 新消息时滚到底部(Cursor 式)
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread, busy]);
  const curFmt = FORMATS.find((format) => format.id === fmt) ?? FORMATS[0];
  const isExcel = fmt === 'excel';
  const { send, cancel } = useProposalStream({
    format: fmt,
    intent,
    provider,
    model,
    apiKey,
    server,
    serveToken,
    browserCredentialsEnabled,
    conversationSessionId,
    localUserId,
    thread,
    fileSnapshot,
    sheetSelection: uniSel,
    wordSelection: wordSel,
    boardSelection: boardSel,
    autoBatchRun,
    univerRef,
    wordRef,
    boardRef,
    normalizeLocalEndpoint,
    t,
    setIntent,
    setConfigOpen: setCfgOpen,
    setSendError: setSendErr,
    setBusy,
    setThread,
    setRecent,
    setRealChangeSet: setRealCs,
    setReviewIndex: setReviewIdx,
    setBoardDiff,
    setExcelDiff,
  });
  /** 退出「本次改动」回到建议视图,可发起新指令。 */
  const resetDiff = (): void => {
    setRealCs(null);
    clearAccepted();
  };
  /** 开启新对话:清空多轮历史 + 当前视图。 */
  const newConversation = (): void => {
    const nextSessionId = freshLocalId();
    try { localStorage.setItem('oa.auditSessionId', nextSessionId); } catch { /* persistence is best-effort */ }
    setConversationSessionId(nextSessionId);
    setThread([]);
    resetDiff();
    setSendErr(null);
    clearAccepted(); // 处置记账随对话清零
    wordRef.current?.closeUndoWindow();
  };
  /** 撤销某条改动:把该回合写过的格子还原到改前值,并清掉它加的底色。 */
  const revertTurn = (idx: number): void => {
    const turn = thread[idx];
    if (!turn || turn.role !== 'assistant' || turn.kind !== 'diff') return;
    if (turn.board) {
      revertBoardPatch(
        turn.board,
        boardRef.current,
        turn.diff.items.filter((item) => !rejected.has(akey(turn.diff.changeSetId, item.editId))).map((item) => item.editId),
      );
    } else if (turn.word) {
      let missed = 0;
      for (const w of turn.word) if (!rejected.has(akey(turn.diff.changeSetId, w.editId))) { if (!wordRef.current?.revert(w.domId)) missed++; } // 按 domId 精确还原仍在预览/已接受的改动
      if (missed) notify(t('部分改动已定稿,无法自动回退') + ` · ${missed}`);
    } else {
      for (const op of [...turn.ops].reverse()) {
        if (!op.editId || !rejected.has(akey(turn.diff.changeSetId, op.editId))) revertGridOp(univerRef.current, op);
      }
    }
    markReverted(idx);
    notify(t('已撤销该回合改动'));
  };
  /** 用户提交澄清选择:锁定该卡片 + 把选择作为新一轮指令发回(thread 续接,Agent 据此继续或再追问)。 */
  const submitClarify = (idx: number, text: string): void => {
    markClarifyAnswered(idx, text);
    void send(text);
  };

  /** drawio 改动视图:原文=隐掉本轮提案(新增移除、改动还原改前快照);改后=按当前处置呈现。 */
  const applyBoardDiffView = (view: 'orig' | 'final'): void => {
    let turn: DiffTurn | undefined;
    for (let i = thread.length - 1; i >= 0; i--) { const tt = thread[i]; if (tt && tt.role === 'assistant' && tt.kind === 'diff' && tt.board && tt.diff.items.length) { turn = tt; break; } }
    const b = turn?.board;
    if (!turn || !b) return;
    applyBoardPatchView(b, {
      editIds: turn.diff.items.map((item) => item.editId),
      view,
      isAccepted: (editId) => !rejected.has(akey(turn.diff.changeSetId, editId)),
      board: boardRef.current,
    });
    setBoardDiff(view);
  };
  const applyExcelDiffView = (view: ExcelDiffView): void => {
    const turn = findLatestExcelDiffTurn(thread);
    if (!turn) return;
    renderExcelDiffView(
      univerRef.current,
      turn,
      view,
      (editId) => !rejected.has(akey(turn.diff.changeSetId, editId)),
    );
    setExcelDiff(view);
  };
  /** 高亮当前审阅的改动:Excel 聚焦该格、drawio 高亮该对象。 */
  const highlightItem = (turn: DiffTurn, item: AgentDiffItem | undefined): void => {
    if (!item) return;
    if (turn.format === 'excel') univerRef.current?.focus(item.ref.replace(/^.*!/, ''));
    else if (turn.format === 'drawio') { const id = turn.board?.byEdit[item.editId]; if (id) boardRef.current?.highlight(id); }
    else if (turn.format === 'word') { const w = turn.word?.find((x) => x.editId === item.editId); if (w) wordRef.current?.highlight(w.domId); } // 定位当前条
  };
  const applyWordEdit = (edit: WordEdit): void => {
    wordRef.current?.applyEdit(edit.domId, edit.quote, wordEditOpts(edit));
  };
  const { acceptItem, rejectItem, resolveByCid, acceptAll, commitAccepted } = useReviewActions({
    format: fmt,
    thread,
    accepted,
    rejected,
    autoBatch,
    autoBatchRun,
    excelDiff,
    fileBase64: fileB64,
    wordRef,
    univerRef,
    notify,
    t,
    toggleAccept,
    acceptMany,
    setReviewIdx,
    setExcelDiff,
    ensureCommitFile,
    doCommit,
    markCommitted,
    applyWordEdit,
    boardRef,
    confirmAcceptAll: (message) => window.confirm(message),
    send,
  });
  const openDrop = (it: string, el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    setDrop({ key: it, x: Math.min(r.left, window.innerWidth - 250), y: r.bottom + 3 });
  };
  /** Drawio 工具栏中有面板的命令打开面板,其余命令由画板处理并给出反馈。 */
  const act = (it: string, el: HTMLElement): void => {
    if (DROPDOWNS[it]) openDrop(it, el);
    else notify(t('执行') + ' · ' + t(it));
  };
  const pick = (v: string): void => {
    notify(t('应用') + ' · ' + t(v));
    setDrop(null);
  };

  // 对话流里最后一条改动(仅它可交互:接受/提交);更早的改动转为只读 + 可撤销
  let lastDiffIdx = -1;
  for (let i = thread.length - 1; i >= 0; i--) {
    const tt = thread[i];
    if (tt && tt.role === 'assistant' && tt.kind === 'diff') {
      lastDiffIdx = i;
      break;
    }
  }

  // 审阅当前条 → 在左侧工作区高亮它(Excel 聚焦该格 / drawio 高亮该对象),逐条引导
  useEffect(() => {
    let li = -1;
    for (let i = thread.length - 1; i >= 0; i--) { const tt = thread[i]; if (tt && tt.role === 'assistant' && tt.kind === 'diff') { li = i; break; } }
    if (li < 0) return;
    const turn = thread[li];
    if (!turn || turn.role !== 'assistant' || turn.kind !== 'diff' || turn.committed || turn.reverted) return;
    if (reviewIdx >= turn.diff.items.length) return;
    highlightItem(turn, turn.diff.items[reviewIdx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewIdx, lastDiffIdx, thread.length, fmt]);

  return (
    <TContext.Provider value={t}>
      <div className="app">
        <TopBar
          formats={FORMATS}
          fmt={fmt}
          fileLabel={curFmt.file}
          lang={lang}
          onPickFormat={(id) => { setFmt(id as typeof fmt); lsSet('oa.fmt', id); }}
          onPickLang={pickLang}
        />

        <main className={'body' + (fmt === 'drawio' ? ' three' : '')}>
          {fmt === 'drawio' && <DrawioPalette onPick={(s) => notify(t('插入形状') + ' · ' + s)} />}
          <section className="editor">
            {fmt === 'drawio' && <DrawioToolbar onAct={act} />}
            <div className={'canvas' + (isExcel ? ' excel' : fmt === 'drawio' ? ' board' : ' worddoc')}>
              {isExcel ? (
                <>
                  {(() => {
                    // 与 Word 同一交互模型的切换条:原文/对照/改后 + 逐格步进(游标与右侧审阅列表同步)
                    const dt = lastDiffIdx >= 0 ? thread[lastDiffIdx] : undefined;
                    const dturn = dt && dt.role === 'assistant' && dt.kind === 'diff' && dt.ops.length > 0 ? dt : undefined;
                    if (!dturn && !thread.some((tt) => tt.role === 'assistant' && tt.kind === 'diff' && tt.ops.length > 0)) return null;
                    const total = dturn && !dturn.committed && !dturn.reverted ? dturn.diff.items.length : 0;
                    return (
                      <DiffToggle<'orig' | 'mark' | 'final'>
                        label="Agent 改动"
                        className="excel-difftoggle"
                        segs={[
                          { v: 'orig', label: '原文', title: '回看改前的表格' },
                          { v: 'mark', label: '对照', title: '改后 + 着色标记被改动的单元格' },
                          { v: 'final', label: '改后', title: '只看改后' },
                        ] as const}
                        active={excelDiff}
                        count={total > 0 ? { pos: Math.min(reviewIdx, total - 1), total } : null}
                        onPick={applyExcelDiffView}
                        onStep={total > 0 ? (dir) => setReviewIdx((total + Math.min(reviewIdx, total - 1) + dir) % total) : undefined}
                      />
                    );
                  })()}
                  <Suspense fallback={<div className="univer-loading">{t('加载表格引擎…')}</div>}>
                    <UniverSheet ref={univerRef} onSelection={setUniSel} />
                  </Suspense>
                </>
              ) : fmt === 'drawio' ? (
                <>
                  {(() => {
                    const dt = lastDiffIdx >= 0 ? thread[lastDiffIdx] : undefined;
                    const dturn = dt && dt.role === 'assistant' && dt.kind === 'diff' && dt.board && dt.diff.items.length > 0 ? dt : undefined;
                    if (!dturn) return null;
                    const total = !dturn.committed && !dturn.reverted ? dturn.diff.items.length : 0;
                    return (
                      <DiffToggle<'orig' | 'final'>
                        label="Agent 改动"
                        className="board-difftoggle"
                        segs={[
                          { v: 'orig', label: '原文', title: '隐藏本轮提案,回看改前画板' },
                          { v: 'final', label: '改后', title: '按当前处置呈现提案' },
                        ] as const}
                        active={boardDiff}
                        count={total > 0 ? { pos: Math.min(reviewIdx, total - 1), total } : null}
                        onPick={applyBoardDiffView}
                        onStep={total > 0 ? (dir) => setReviewIdx((total + Math.min(reviewIdx, total - 1) + dir) % total) : undefined}
                      />
                    );
                  })()}
                  <DrawioBoard ref={boardRef} onBoardSel={setBoardSel} />
                </>
              ) : (
                <Suspense fallback={<div className="univer-loading">{t('加载文档编辑器…')}</div>}>
                  <RichDoc ref={wordRef} onSelection={setWordSel} onChangeHover={setHoverCid} onChangeResolve={resolveByCid} />
                </Suspense>
              )}
            </div>
          </section>

          <aside className="rail">
            <div className="selbar">
              <span className="dot" />
              {t('选区')} <span className="ref">{isExcel ? (uniSel?.a1 ?? '—') : fmt === 'word' ? (wordSel ? t('已选') : '—') : '—'}</span>
              <span className="grow" />
              <span>{isExcel ? (uniSel ? `${uniSel.rows} × ${uniSel.cols} ${t('单元格')}` : '—') : fmt === 'drawio' && boardSel ? `${boardSel.count} ${t('个对象')}` : fmt === 'word' ? (wordSel ? `${wordSel.chars} ${t('字')} · ${t(wordSel.block)}` : t('文档工作区')) : `${t(curFmt.label)} ${t('工作区')}`}</span>
            </div>

            <div className="rail-body">
              {thread.length === 0 && !busy && !sendErr ? (
                <AgentHome recent={recent} onSend={(p) => { void send(p); }} onPick={setIntent} />
              ) : (
                <div className="chat-thread">
                  {thread.length > 0 && (
                    <div className="convo-bar">
                      <span className="dot" /> {t('对话')} · {thread.filter((x) => x.role === 'user').length} {t('轮')}
                      <span className="grow" />
                      <button className="convo-new" onClick={newConversation}>{t('新对话')}</button>
                    </div>
                  )}
                  {thread.map((turn, i) => {
                    if (turn.role === 'user') return <div key={i} className="msg-user">{turn.text}</div>;
                    if (turn.kind === 'answer')
                      return (
                        <div key={i} className="ai-msg">
                          <img className="ai-av" src="/favicon.png" alt="" />
                          <div className="ai-stack">
                            {turn.streaming && turn.status ? <AgentStatusLine status={turn.status} /> : null}
                            {(turn.text || !turn.streaming) && <div className="answer-bubble md">{turn.text ? <Markdown text={turn.text} /> : <span className="dim">{t('(无内容)')}</span>}</div>}
                            {turn.streaming && !turn.text && !turn.status && <div className="thinking"><span className="spin" /> {t('正在生成回复')}</div>}
                          </div>
                        </div>
                      );
                    if (turn.kind === 'clarify')
                      return (
                        <div key={i} className="ai-msg">
                          <img className="ai-av" src="/favicon.png" alt="" />
                          <div className="ai-stack">
                            <ClarifyCard questions={turn.questions} answered={turn.answered} answerText={turn.answerText} onSubmit={(text) => submitClarify(i, text)} />
                          </div>
                        </div>
                      );
                    const active = i === lastDiffIdx && turn.format === fmt && !turn.committed && !turn.reverted;
                    return (
                      <div key={i} className="ai-msg">
                        <img className="ai-av" src="/favicon.png" alt="" />
                        <div className="ai-stack">
                          {turn.text?.trim() ? <div className="answer-bubble md"><Markdown text={turn.text} /></div> : null}
                          <ReviewBox
                            turn={turn}
                            index={i}
                            active={active}
                            reviewIdx={reviewIdx}
                            accepted={accepted}
                            rejected={rejected}
                            hoverCid={hoverCid}
                            autoBatch={autoBatch}
                            wordRef={wordRef}
                            lockedEdits={(() => { // 历史重审守卫:该条的格子被后续回合改过 → 锁行内 ✓/✕(先撤销后面的回合)
                              if (turn.format !== 'excel' || i === lastDiffIdx) return undefined;
                              const laterA1 = new Set<string>();
                              for (let j = i + 1; j < thread.length; j++) { const t2 = thread[j]; if (t2 && t2.role === 'assistant' && t2.kind === 'diff') for (const op of t2.ops) laterA1.add(op.a1); }
                              return new Set(turn.ops.filter((o) => o.editId && laterA1.has(o.a1)).map((o) => o.editId!));
                            })()}
                            onSetReviewIdx={setReviewIdx}
                            onHoverCid={setHoverCid}
                            onAccept={(k) => acceptItem(turn, k, !active)}
                            onReject={(k) => rejectItem(turn, k, !active)}
                            onAcceptAll={() => acceptAll(turn, i)}
                            onCommitAccepted={() => commitAccepted(turn, i)}
                            onRevertTurn={() => revertTurn(i)}
                            onSend={(s) => { void send(s); }}
                            onSetAutoBatch={setAutoBatch}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {sendErr && (
                    <div className="agent-err">
                      <div className="ae-i"><IconX size={18} /></div>
                      <div className="ae-t">{t('Agent 调用失败')}</div>
                      <div className="ae-m">{sendErr}</div>
                      <div className="ae-acts">
                        <button className="btn solid" onClick={() => setSendErr(null)}>{t('返回')}</button>
                      </div>
                    </div>
                  )}
                  <div ref={threadEndRef} />
                </div>
              )}
            </div>

            <Composer
              cfgOpen={cfgOpen}
              onToggleCfg={() => setCfgOpen((v) => !v)}
              providers={MODEL_PROVIDERS}
              providerId={provider}
              providerLabel={curProvider.label}
              defaultModel={curProvider.model}
              onPickProvider={pickProvider}
              model={model}
              onModel={(v) => { setModel(v); lsSet('oa.model', v); }}
              apiKey={apiKey}
              onApiKey={(v) => setApiKey(v)}
              server={server}
              onServer={(v) => { setServer(v); lsSet('oa.server', v); }}
              localCredentials={browserCredentialsEnabled ? {
                serveToken,
                reviewToken,
                onServeToken: (v) => { setServeToken(v); setBrowserLocalCredential('oa.serveToken', v); },
                onReviewToken: (v) => { setReviewToken(v); setBrowserLocalCredential('oa.reviewToken', v); },
              } : undefined}
              selChip={
                isExcel ? (
                  uniSel ? (
                    <>{t('已选')} <b>{uniSel.a1}</b> · {uniSel.rows}×{uniSel.cols}</>
                  ) : (
                    <span className="muted">{t('未选区域 · 将基于整张表理解')}</span>
                  )
                ) : fmt === 'drawio' && boardSel ? (
                  <>{boardSel.chip}</>
                ) : fmt === 'word' ? (
                  wordSel ? (
                    <>{t('已选')} <b>{wordSel.chars} {t('字')}</b> · <span className="sel-quote">{wordSel.text}</span></>
                  ) : (
                    <span className="muted">{t('未选文字 · 将基于整篇文档理解')}</span>
                  )
                ) : (
                  <>{t('当前')} <b>{t(curFmt.label)}</b> {t('工作区')}</>
                )
              }
              intent={intent}
              onIntent={setIntent}
              placeholder={t(PLACEHOLDERS[fmt])}
              busy={busy}
              onSend={() => { void send(); }}
              onCancel={cancel}
              fileRef={fileRef}
              fileName={fileName}
              onFile={onFile}
            />
          </aside>
        </main>
        {drop && DROPDOWNS[drop.key] && (
          <Dropdown spec={DROPDOWNS[drop.key]!} x={drop.x} y={drop.y} onClose={() => setDrop(null)} onPick={pick} />
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </TContext.Provider>
  );
}

function Dropdown({ spec, x, y, onClose, onPick }: { spec: Drop; x: number; y: number; onClose: () => void; onPick: (v: string) => void }) {
  return (
    <>
      <div className="drop-backdrop" onMouseDown={onClose} />
      <div className="dropdown" style={{ left: x, top: y }}>
        {spec.type === 'colors' && (
          <div className="drop-colors">
            {COLORS.map((c, i) => (
              <button key={c + i} className="swatch" style={{ background: c }} title={c} onClick={() => onPick(c)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Drawio workspace moved to ./DrawioBoard.tsx (decomposition phase 4).
