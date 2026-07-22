import type { MutableRefObject, RefObject } from 'react';
import type { DiffTurn } from './app-thread-types.js';
import type { WordEdit } from './proposal-materializers.js';
import type { RichDocHandle } from './RichDoc.js';
import type { SheetHandle } from './UniverSheet.js';
import { setBoardEditState, type DrawioReviewBoard } from './drawio-review-adapter.js';
import { applyGridOp, gridOpBackground, type ExcelDiffView } from './excel-review-adapter.js';
import { akey, AUTO_BATCH_CAP, BATCH_RX } from './review-shared.js';
import { acceptAllConfirmation, reviewItemKind, summarizeReviewRisk } from './review-policy.js';

type Format = DiffTurn['format'];

export interface UseReviewActionsOptions {
  format: Format;
  accepted: Set<string>;
  rejected: Set<string>;
  autoBatch: boolean;
  autoBatchRun: MutableRefObject<number>;
  excelDiff: ExcelDiffView;
  fileBase64: string;
  wordRef: RefObject<RichDocHandle | null>;
  univerRef: RefObject<SheetHandle | null>;
  boardRef: RefObject<DrawioReviewBoard | null>;
  notify: (message: string) => void;
  t: (key: string) => string;
  acceptMany: (ids: string[]) => void;
  setReviewIdx: (index: number) => void;
  setExcelDiff: (view: ExcelDiffView) => void;
  ensureCommitFile: (turn: DiffTurn) => boolean;
  doCommit: (acceptedEditIds: string[], turn: DiffTurn) => Promise<boolean>;
  markCommitted: (index: number, count: number) => void;
  applyWordEdit: (edit: WordEdit) => void;
  telemetry: (format: Format, verb: 'accept' | 'reject', kind: string) => void;
  confirmAcceptAll: (message: string) => boolean;
  send: (text: string) => void | Promise<void>;
}

export interface UseReviewActionsResult {
  acceptAll: (turn: DiffTurn, turnIndex: number) => Promise<void>;
  commitAccepted: (turn: DiffTurn, turnIndex: number) => Promise<void>;
}

export function useReviewActions({
  format,
  accepted,
  rejected,
  autoBatch,
  autoBatchRun,
  excelDiff,
  fileBase64,
  wordRef,
  univerRef,
  boardRef,
  notify,
  t,
  acceptMany,
  setReviewIdx,
  setExcelDiff,
  ensureCommitFile,
  doCommit,
  markCommitted,
  applyWordEdit,
  telemetry,
  confirmAcceptAll,
  send,
}: UseReviewActionsOptions): UseReviewActionsResult {
  const canProcess = (turn: DiffTurn): boolean => {
    if (turn.format !== format) {
      notify('请先切回 ' + turn.format + ' 工作区再处理该提案');
      return false;
    }
    const writebackFormat = turn.format === 'excel' || turn.format === 'word' || turn.format === 'drawio';
    if (writebackFormat && (fileBase64 || turn.fileSnapshot) && !ensureCommitFile(turn)) return false;
    return true;
  };

  const finish = async (turn: DiffTurn, turnIndex: number, editIds: string[]): Promise<void> => {
    if ((turn.format === 'excel' || turn.format === 'word' || turn.format === 'drawio') && fileBase64) {
      const committed = await doCommit(editIds, turn);
      if (!committed) return;
      markCommitted(turnIndex, editIds.length);
    } else {
      markCommitted(turnIndex, editIds.length);
      notify('Accepted ' + editIds.length + ' changes');
    }

    if (autoBatch && BATCH_RX.test(turn.diff.intent ?? '')) {
      if (autoBatchRun.current >= AUTO_BATCH_CAP) {
        notify(t('自动续批已达上限,请确认后手动继续'));
        return;
      }
      autoBatchRun.current++;
      window.setTimeout(() => {
        void send('下一批');
      }, 900);
    }
  };

  const acceptAll = async (turn: DiffTurn, turnIndex: number): Promise<void> => {
    if (!canProcess(turn)) return;
    if (!confirmAcceptAll(acceptAllConfirmation(summarizeReviewRisk(turn)))) return;

    const pendingWord = (turn.word ?? []).filter((edit) =>
      rejected.has(akey(turn.diff.changeSetId, edit.editId)),
    );
    const wordApplyOrder = [
      ...pendingWord.filter((edit) => !edit.remove && !edit.table),
      ...pendingWord.filter((edit) => edit.table),
      ...pendingWord.filter((edit) => edit.remove).sort((a, b) => (b.blockIdx ?? -1) - (a.blockIdx ?? -1)),
    ];
    for (const edit of wordApplyOrder) applyWordEdit(edit);

    for (const item of turn.diff.items) {
      const key = akey(turn.diff.changeSetId, item.editId);
      if (turn.format === 'word' || !rejected.has(key)) continue;
      if (turn.format === 'excel') {
        const op = turn.ops.find((candidate) => candidate.editId === item.editId);
        if (op) applyGridOp(univerRef.current, op);
      } else if (turn.format === 'drawio') {
        if (turn.board) setBoardEditState(turn.board, item.editId, 'next', boardRef.current);
      }
    }

    if (turn.format === 'word') {
      for (const edit of turn.word ?? []) wordRef.current?.markResolved(edit.domId, 'accepted');
    }
    if (turn.format === 'excel' && excelDiff === 'mark') {
      for (const op of turn.ops) univerRef.current?.setBackground(op.a1, gridOpBackground(op, true));
      setExcelDiff('final');
    }
    for (const item of turn.diff.items) {
      if (!accepted.has(akey(turn.diff.changeSetId, item.editId))) telemetry(turn.format, 'accept', reviewItemKind(turn, item));
    }

    const editIds = turn.diff.items.map((item) => item.editId);
    acceptMany(turn.diff.items.map((item) => akey(turn.diff.changeSetId, item.editId)));
    setReviewIdx(editIds.length);
    await finish(turn, turnIndex, editIds);
  };

  const commitAccepted = async (turn: DiffTurn, turnIndex: number): Promise<void> => {
    if (!canProcess(turn)) return;
    const undecided = turn.diff.items.some((item) => {
      const key = akey(turn.diff.changeSetId, item.editId);
      return !accepted.has(key) && !rejected.has(key);
    });
    if (undecided) {
      notify(t('请先审阅全部改动'));
      return;
    }
    const editIds = turn.diff.items
      .filter((item) => accepted.has(akey(turn.diff.changeSetId, item.editId)))
      .map((item) => item.editId);
    if (!editIds.length) {
      notify(t('没有要接受的改动'));
      return;
    }
    setReviewIdx(turn.diff.items.length);
    await finish(turn, turnIndex, editIds);
  };

  return { acceptAll, commitAccepted };
}
