import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { LocalServiceHttpError, streamPropose } from './agent-client.js';
import { buildHistory } from './app-history.js';
import {
  appendAnswerDelta,
  appendStreamingAnswerTurn,
  appendUserTurn,
  finalizeLastAnswer,
  interruptLastStreamingAnswer,
  replaceLastWithClarify,
  setStreamStatus,
} from './app-proposal-flow.js';
import type { ClarifyQuestion, Turn, WorkspaceFormat } from './app-thread-types.js';
import { captureGridOpBeforeState, orderWordEditsForApply, replaceLastWithWorkspaceDiff } from './app-workspace-proposals.js';
import { chartToPngDataUrl } from './chart.js';
import { applyDrawioMutations } from './drawio-proposal-adapter.js';
import { extractDrawioOps, makeRawBoardConv } from './DrawioBoard.js';
import type { BEdge, BNode, BoardHandle, BoardSel } from './DrawioBoard.js';
import { applyExcelStructure, type ChartPlacement } from './excel-structure-adapter.js';
import { playGridOps, type ExcelDiffView } from './excel-review-adapter.js';
import { fileSnapshotDocumentId, proposalMatchesFileSnapshot, type FileSnapshot } from './file-snapshot.js';
import {
  countAddedBoardObjects,
  materializeAddedBoardObjects,
  materializeGridOps,
  materializeWordEdits,
  wordEditOpts,
} from './proposal-materializers.js';
import type { AgentDiff, BoardPatch } from './proposal-materializers.js';
import type { RichDocHandle, WordSel } from './RichDoc.js';
import type { SheetHandle, UniSel } from './UniverSheet.js';

interface StreamEvent {
  type: string;
  status?: unknown;
  delta?: string;
  kind?: string;
  text?: string;
  diff?: AgentDiff;
  changeSet?: unknown;
  proposal?: unknown;
  questions?: ClarifyQuestion[];
  message?: string;
  error?: { kind?: string };
}

export interface RecentIntent {
  t: string;
  time: string;
}

export interface UseProposalStreamOptions {
  format: WorkspaceFormat;
  intent: string;
  provider: string;
  model: string;
  apiKey: string;
  server: string;
  serveToken: string;
  browserCredentialsEnabled: boolean;
  conversationSessionId: string;
  localUserId: string;
  thread: Turn[];
  fileSnapshot: FileSnapshot | null;
  sheetSelection: UniSel | null;
  wordSelection: WordSel | null;
  boardSelection: BoardSel | null;
  autoBatchRun: MutableRefObject<number>;
  univerRef: RefObject<SheetHandle | null>;
  wordRef: RefObject<RichDocHandle | null>;
  boardRef: RefObject<BoardHandle | null>;
  normalizeLocalEndpoint: (raw: string) => string | null;
  t: (key: string) => string;
  setIntent: Dispatch<SetStateAction<string>>;
  setConfigOpen: Dispatch<SetStateAction<boolean>>;
  setSendError: Dispatch<SetStateAction<string | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setThread: Dispatch<SetStateAction<Turn[]>>;
  setRecent: Dispatch<SetStateAction<RecentIntent[]>>;
  setRealChangeSet: Dispatch<SetStateAction<unknown>>;
  setReviewIndex: Dispatch<SetStateAction<number>>;
  setBoardDiff: Dispatch<SetStateAction<'orig' | 'final'>>;
  setExcelDiff: Dispatch<SetStateAction<ExcelDiffView>>;
}

export interface UseProposalStreamResult {
  send: (intentOverride?: string) => Promise<void>;
  cancel: () => void;
}

export function latestProposalId(thread: readonly Turn[]): string | undefined {
  for (let index = thread.length - 1; index >= 0; index--) {
    const turn = thread[index];
    if (!turn || turn.role !== 'assistant' || turn.kind !== 'diff' || !turn.proposal || typeof turn.proposal !== 'object') continue;
    const proposalId = (turn.proposal as { proposalId?: unknown }).proposalId;
    if (typeof proposalId === 'string' && proposalId.trim()) return proposalId;
  }
  return undefined;
}

export function buildWordProposalContext(context: string | null | undefined, selection: WordSel | null): string {
  const selectionDescription = selection
    ? `${selection.block}${selection.para ? ' · 第' + selection.para + '段' : ''}${selection.font ? ' · ' + selection.font : ''}${selection.size ? ' ' + selection.size + 'pt' : ''}${selection.bold ? ' 加粗' : ''}${selection.italic ? ' 斜体' : ''}${selection.align && selection.align !== '左对齐' ? ' ' + selection.align : ''}`
    : '';
  const instructions = '(改写正文:给 quote=文档中真实存在的原文片段 + replacement;改格式:显式给 scope，字符范围用 selection、整段用 paragraph、页面设置用 document;空段落/整段结构操作用 para=段号;对照表/矩阵必须用 table 二维数组生成真实表格,禁止竖线或制表符伪造。)';
  if (!selection) return `${context ?? '(空文档)'}\n${instructions}\n[未圈选文字]:请基于整篇文档理解。`;
  if (selection.block === '图片') {
    return `${context ?? '(空文档)'}\n${instructions}\n[当前选区·用户此刻点选了一张图片(${selectionDescription})]:${selection.text}\n若指令含"这张图/这个图片/它",目标就是这张图所在的第${selection.para ?? '?'}段;整段操作用 para=${selection.para ?? '?'} 锚定。`;
  }
  return `${context ?? '(空文档)'}\n${instructions}\n[当前选区·用户此刻圈选了这段(${selectionDescription})]:"${selection.text}"\n若指令含"这段/这句/这里/选中的/选中/它",优先针对它;quote 用这段真实原文定位。`;
}

export function buildDrawioProposalContext(selection: BoardSel | null): string {
  return selection?.context ?? '[流程图] 当前画板为空。';
}

export function useProposalStream({
  format,
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
  sheetSelection,
  wordSelection,
  boardSelection,
  autoBatchRun,
  univerRef,
  wordRef,
  boardRef,
  normalizeLocalEndpoint,
  t,
  setIntent,
  setConfigOpen,
  setSendError,
  setBusy,
  setThread,
  setRecent,
  setRealChangeSet,
  setReviewIndex,
  setBoardDiff,
  setExcelDiff,
}: UseProposalStreamOptions): UseProposalStreamResult {
  const sendingRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const applySequenceRef = useRef(0);
  const chartPlacementsRef = useRef<ChartPlacement[]>([]);
  const draftBufferRef = useRef('');
  const drawnOperationsRef = useRef(0);
  const streamConverterRef = useRef<ReturnType<typeof makeRawBoardConv> | null>(null);
  const staleStreamRef = useRef(false);
  const streamObjectsRef = useRef<Array<{ editId: string; node?: BNode; edge?: BEdge }>>([]);
  const streamBoardIdByEditRef = useRef<Record<string, string>>({});

  useEffect(() => () => streamAbortRef.current?.abort(), []);

  const playBoard = async (nodes: BNode[], edges: BEdge[]): Promise<void> => {
    for (const node of nodes) {
      boardRef.current?.addObjects([node], []);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    for (const edge of edges) {
      boardRef.current?.addObjects([], [edge]);
      await new Promise((resolve) => setTimeout(resolve, 45));
    }
  };

  const send = async (intentOverride?: string): Promise<void> => {
    if (sendingRef.current) return;
    const requestedIntent = (intentOverride ?? intent).trim();
    if (!requestedIntent) return;
    if (requestedIntent !== '下一批') autoBatchRun.current = 0;
    if (intentOverride && intentOverride !== intent) setIntent(intentOverride);

    const isExcel = format === 'excel';
    const sheetSnapshot = isExcel ? (univerRef.current?.getSheet() ?? sheetSelection) : null;
    const documentSnapshot = format === 'word' ? (wordRef.current?.getDocSnapshot() ?? null) : null;
    const context = isExcel
      ? (sheetSnapshot?.text ?? '(表格为空)')
      : format === 'drawio'
        ? buildDrawioProposalContext(boardSelection)
        : buildWordProposalContext(wordRef.current?.getContext(), wordSelection);
    const proposalFile = fileSnapshot?.format === format ? fileSnapshot : null;
    const proposalDocumentId = proposalFile ? fileSnapshotDocumentId(proposalFile) : `desktop:${format}`;
    const parentProposalId = latestProposalId(thread);
    const proposalBoard = format === 'drawio' && boardSelection?.board
      ? { ...boardSelection.board, ...(proposalFile?.drawioSourceEncoding ? { sourceEncoding: proposalFile.drawioSourceEncoding } : {}) }
      : undefined;

    setSendError(null);
    const endpoint = normalizeLocalEndpoint(server);
    if (server.trim() && !endpoint) {
      setConfigOpen(true);
      setSendError('Agent 服务地址必须是本机地址: http://localhost、http://127.0.0.1 或 http://[::1]');
      return;
    }
    if (endpoint && apiKey && browserCredentialsEnabled && !serveToken) {
      setConfigOpen(true);
      setSendError(t('未填写本机服务令牌。请在模型设置中粘贴服务启动时显示的 POST token。'));
      return;
    }
    if (!endpoint || !apiKey) {
      setConfigOpen(true);
      setSendError('未填写 API Key。请在下方「模型」里粘贴你所选厂商的 API Key(本机服务地址已默认填好),即可用真实大模型驱动表格。');
      return;
    }

    const requestController = new AbortController();
    streamAbortRef.current = requestController;
    sendingRef.current = true;
    setBusy(true);
    setThread((current) => appendUserTurn(current, requestedIntent));
    setIntent('');
    try {
      draftBufferRef.current = '';
      drawnOperationsRef.current = 0;
      streamConverterRef.current = null;
      streamObjectsRef.current = [];
      streamBoardIdByEditRef.current = {};
      staleStreamRef.current = false;
      await streamPropose<StreamEvent>(
        endpoint,
        {
          format,
          intent: requestedIntent,
          context,
          baseRev: proposalFile?.revision ?? 0,
          provider,
          model,
          apiKey,
          documentId: proposalDocumentId,
          sessionId: conversationSessionId,
          userId: localUserId,
          ...(proposalFile ? { sourceFileSha256: proposalFile.sha256 } : {}),
          ...(parentProposalId ? { parentProposalId } : {}),
          ...(isExcel && sheetSnapshot?.sheet ? { sheet: sheetSnapshot.sheet } : {}),
          ...(proposalBoard ? { board: proposalBoard } : {}),
          ...(documentSnapshot ? { doc: documentSnapshot } : {}),
          ...(thread.length ? { history: buildHistory(thread) } : {}),
        },
        () => {
          setRecent((current) => [{ t: requestedIntent, time: t('刚刚') }, ...current.filter((item) => item.t !== requestedIntent)].slice(0, 6));
          setThread((current) => appendStreamingAnswerTurn(current));
        },
        (event) => {
          if (event.type === 'status') {
            setThread((current) => setStreamStatus(current, event.status));
            if (format === 'drawio' && streamObjectsRef.current.length) staleStreamRef.current = true;
          } else if (event.type === 'answer') {
            setThread((current) => appendAnswerDelta(current, event.delta));
          } else if (event.type === 'draft' && format === 'drawio') {
            if (staleStreamRef.current) {
              boardRef.current?.removeObjects(Object.values(streamBoardIdByEditRef.current));
              streamObjectsRef.current = [];
              streamBoardIdByEditRef.current = {};
              draftBufferRef.current = '';
              drawnOperationsRef.current = 0;
              streamConverterRef.current = null;
              staleStreamRef.current = false;
            }
            draftBufferRef.current += event.delta ?? '';
            const converter = streamConverterRef.current ?? (streamConverterRef.current = makeRawBoardConv(
              ++applySequenceRef.current,
              (id) => !!boardRef.current?.getObject(id),
            ));
            const operations = extractDrawioOps(draftBufferRef.current);
            for (let index = drawnOperationsRef.current; index < operations.length; index++) {
              const result = converter(operations[index]!, index);
              if (!result) continue;
              boardRef.current?.addObjects(result.node ? [result.node] : [], result.edge ? [result.edge] : []);
              streamObjectsRef.current.push({
                editId: result.editId,
                ...(result.node ? { node: result.node } : {}),
                ...(result.edge ? { edge: result.edge } : {}),
              });
              streamBoardIdByEditRef.current[result.editId] = result.boardId;
            }
            drawnOperationsRef.current = operations.length;
          } else if (event.type === 'error') {
            const providerMessage: Record<string, string> = {
              authentication: t('API Key 未通过 Provider 验证'),
              permission: t('当前 API Key 无权使用该模型'),
              invalid_request: t('Provider 拒绝了模型请求'),
              rate_limit: t('Provider 限流,请稍后重试'),
              timeout: t('Provider 请求超时'),
              unavailable: t('Provider 暂时不可用'),
              network: t('无法连接 Provider'),
              circuit_open: t('Provider 暂时熔断,请稍后重试'),
              unknown: t('Provider 请求失败'),
            };
            throw new Error(providerMessage[event.error?.kind ?? ''] ?? event.message ?? 'stream error');
          } else if (event.type === 'done') {
            if (event.kind === 'changeset' && event.diff) {
              const diff = event.diff;
              const changeSet = event.changeSet ?? null;
              const proposal = event.proposal ?? null;
              if (proposalFile && !proposalMatchesFileSnapshot(proposal, proposalFile)) {
                throw new Error('The local service returned a proposal that is not bound to the imported file. Regenerate after updating the service.');
              }
              setRealChangeSet(changeSet);
              setReviewIndex(0);
              if (format === 'drawio') {
                setBoardDiff('final');
                const mutations = applyDrawioMutations(changeSet, boardRef.current, {
                  excludedObjectIds: new Set(Object.values(streamBoardIdByEditRef.current)),
                });
                let board: BoardPatch;
                const addedObjectCount = countAddedBoardObjects(changeSet);
                if (streamObjectsRef.current.length >= addedObjectCount && streamObjectsRef.current.length > 0) {
                  board = {
                    byEdit: { ...streamBoardIdByEditRef.current, ...mutations.byEdit },
                    objs: streamObjectsRef.current,
                    muts: mutations.muts,
                  };
                } else {
                  if (streamObjectsRef.current.length) boardRef.current?.removeObjects(Object.values(streamBoardIdByEditRef.current));
                  const additions = materializeAddedBoardObjects(changeSet, {
                    sequence: ++applySequenceRef.current,
                    getObject: (id) => boardRef.current?.getObject(id) ?? null,
                  });
                  board = { byEdit: { ...additions.byEdit, ...mutations.byEdit }, objs: additions.objs, muts: mutations.muts };
                  if (additions.nodes.length || additions.edges.length) void playBoard(additions.nodes, additions.edges);
                }
                setThread((current) => replaceLastWithWorkspaceDiff(current, {
                  format,
                  fileSnapshot: proposalFile ?? undefined,
                  changeSet,
                  proposal,
                  diff,
                  board,
                }));
              } else if (format === 'word') {
                const wordEdits = materializeWordEdits(diff, changeSet);
                wordRef.current?.closeUndoWindow();
                for (const edit of orderWordEditsForApply(wordEdits)) {
                  wordRef.current?.applyEdit(edit.domId, edit.quote, wordEditOpts(edit));
                }
                setThread((current) => replaceLastWithWorkspaceDiff(current, {
                  format,
                  fileSnapshot: proposalFile ?? undefined,
                  changeSet,
                  proposal,
                  diff,
                  word: wordEdits,
                }));
                setReviewIndex(0);
                if (wordEdits[0]) wordRef.current?.highlight(wordEdits[0].domId);
              } else {
                applyExcelStructure(changeSet, {
                  sheet: univerRef.current,
                  chartPlacements: chartPlacementsRef.current,
                  renderChart: chartToPngDataUrl,
                });
                const operations = captureGridOpBeforeState(materializeGridOps(diff), univerRef.current);
                setExcelDiff('final');
                setThread((current) => replaceLastWithWorkspaceDiff(current, {
                  format,
                  fileSnapshot: proposalFile ?? undefined,
                  changeSet,
                  proposal,
                  diff,
                  ops: operations,
                }));
                if (operations.length) void playGridOps(univerRef.current, operations);
              }
            } else if (event.kind === 'clarify' && event.questions?.length) {
              setThread((current) => replaceLastWithClarify(current, event.questions!));
            } else {
              setThread((current) => finalizeLastAnswer(current, event.text));
            }
          }
        },
        requestController.signal,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = requestController.signal.aborted;
      const localAuthFailed = error instanceof LocalServiceHttpError && error.status === 401;
      const displayMessage = localAuthFailed ? t('本机服务令牌无效。请更新模型设置中的 POST token。') : message;
      const refused = /failed to fetch|refused|ECONNREFUSED|networkerror|load failed/i.test(message);
      if (localAuthFailed) setConfigOpen(true);
      if (format === 'drawio' && streamObjectsRef.current.length) {
        boardRef.current?.removeObjects(Object.values(streamBoardIdByEditRef.current));
        streamObjectsRef.current = [];
        streamBoardIdByEditRef.current = {};
      }
      setThread((current) => interruptLastStreamingAnswer(
        current,
        cancelled ? t('本轮请求已取消。') : `⚠ 本轮请求中断(${refused ? '连不上本机 Agent 服务' : displayMessage}),对话已保留,可直接重发。`,
      ));
      setIntent(requestedIntent);
      setSendError(cancelled
        ? null
        : refused
          ? `连不上本机 Agent 服务(${endpoint})。改了代码后请在项目根目录跑 npm run serve 重启它(会先重新构建再启动,确保用上最新能力)。`
          : localAuthFailed
            ? displayMessage
            : 'Agent · ' + message);
    } finally {
      if (streamAbortRef.current === requestController) streamAbortRef.current = null;
      setBusy(false);
      sendingRef.current = false;
    }
  };

  return {
    send,
    cancel: () => streamAbortRef.current?.abort(),
  };
}
