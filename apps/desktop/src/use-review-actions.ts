import type { MutableRefObject, RefObject } from 'react';
import type { DiffTurn } from './App.js';
import type { WordEdit } from './proposal-materializers.js';
import type { RichDocHandle } from './RichDoc.js';
import type { SheetHandle } from './UniverSheet.js';
import { akey, AUTO_BATCH_CAP, BATCH_RX } from './review-shared.js';

type Format = DiffTurn['format'];
type GridOp = DiffTurn['ops'][number];
type BoardObject = NonNullable<DiffTurn['board']>['objs'][number];
type ExcelDiffView = 'orig' | 'mark' | 'final';

export const reviewItemKind = (turn: DiffTurn, item: DiffTurn['diff']['items'][number]): string => {
  if (turn.format === 'word') {
    const wordEdit = turn.word?.find((edit) => edit.editId === item.editId);
    return wordEdit?.style || item.style ? 'style' : 'text';
  }
  if (turn.format === 'excel') {
    const op = turn.ops.find((candidate) => candidate.editId === item.editId);
    if (!op) return 'structure';
    return op.value !== undefined ? 'value' : 'style';
  }
  if (turn.format === 'drawio') return 'object';
  return 'other';
};

export interface UseReviewActionsOptions {
  format: Format;
  accepted: Set<string>;
  autoBatch: boolean;
  autoBatchRun: MutableRefObject<number>;
  excelDiff: ExcelDiffView;
  fileBase64: string;
  wordRef: RefObject<RichDocHandle | null>;
  univerRef: RefObject<SheetHandle | null>;
  notify: (message: string) => void;
  t: (key: string) => string;
  acceptMany: (ids: string[]) => void;
  setReviewIdx: (index: number) => void;
  setExcelDiff: (view: ExcelDiffView) => void;
  ensureCommitFile: (turn: DiffTurn) => boolean;
  doCommit: (acceptedEditIds: string[], turn: DiffTurn) => Promise<boolean>;
  markCommitted: (index: number, count: number) => void;
  applyGridOp: (op: GridOp) => void;
  applyWordEdit: (edit: WordEdit) => void;
  reapplyBoardObj: (object: BoardObject) => void;
  realBg: (op: GridOp, accepted: boolean) => string | null;
  telemetry: (format: Format, verb: 'accept' | 'reject', kind: string) => void;
  send: (text: string) => void | Promise<void>;
}

export interface UseReviewActionsResult {
  acceptAll: (turn: DiffTurn, turnIndex: number) => Promise<void>;
}

export function useReviewActions({
  format,
  accepted,
  autoBatch,
  autoBatchRun,
  excelDiff,
  fileBase64,
  wordRef,
  univerRef,
  notify,
  t,
  acceptMany,
  setReviewIdx,
  setExcelDiff,
  ensureCommitFile,
  doCommit,
  markCommitted,
  applyGridOp,
  applyWordEdit,
  reapplyBoardObj,
  realBg,
  telemetry,
  send,
}: UseReviewActionsOptions): UseReviewActionsResult {
  const acceptAll = async (turn: DiffTurn, turnIndex: number): Promise<void> => {
    if (turn.format !== format) {
      notify('请先切回 ' + turn.format + ' 工作区再处理该提案');
      return;
    }
    const writebackFormat = turn.format === 'excel' || turn.format === 'word' || turn.format === 'drawio';
    if (writebackFormat && (fileBase64 || turn.fileSnapshot) && !ensureCommitFile(turn)) return;

    const pendingWord = (turn.word ?? []).filter((edit) =>
      turn.diff.items.some((item) => item.editId === edit.editId && !accepted.has(akey(turn.diff.changeSetId, item.editId))),
    );
    const wordApplyOrder = [
      ...pendingWord.filter((edit) => !edit.remove),
      ...pendingWord.filter((edit) => edit.remove).sort((a, b) => (b.blockIdx ?? -1) - (a.blockIdx ?? -1)),
    ];
    for (const edit of wordApplyOrder) applyWordEdit(edit);

    for (const item of turn.diff.items) {
      if (turn.format === 'word' || accepted.has(akey(turn.diff.changeSetId, item.editId))) continue;
      if (turn.format === 'excel') {
        const op = turn.ops.find((candidate) => candidate.editId === item.editId);
        if (op) applyGridOp(op);
      } else if (turn.format === 'drawio') {
        const object = turn.board?.objs.find((candidate) => candidate.editId === item.editId);
        if (object) reapplyBoardObj(object);
      }
    }

    if (turn.format === 'word') {
      for (const edit of turn.word ?? []) wordRef.current?.markResolved(edit.domId, 'accepted');
    }
    if (turn.format === 'excel' && excelDiff === 'mark') {
      for (const op of turn.ops) univerRef.current?.setBackground(op.a1, realBg(op, true));
      setExcelDiff('final');
    }
    for (const item of turn.diff.items) telemetry(turn.format, 'accept', reviewItemKind(turn, item));

    const editIds = turn.diff.items.map((item) => item.editId);
    acceptMany(turn.diff.items.map((item) => akey(turn.diff.changeSetId, item.editId)));
    setReviewIdx(editIds.length);

    if ((turn.format === 'excel' || turn.format === 'word' || turn.format === 'drawio') && fileBase64) {
      const committed = await doCommit(editIds, turn);
      if (committed) markCommitted(turnIndex, editIds.length);
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

  return { acceptAll };
}
