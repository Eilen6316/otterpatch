import type { AgentDiff, BoardPatch, CellState, GridOp, WordEdit } from './proposal-materializers.js';
import type { WorkspaceFormat } from './workspace-format.js';

export type { WorkspaceFormat };

export interface GridStateReader {
  getValue(a1: string): unknown;
  getCellState(a1: string): CellState;
}

type AssistantTurn = {
  role: 'assistant';
  kind: string;
  text?: string;
};

type ThreadTurn = AssistantTurn | { role: string };

export interface WorkspaceDiffTurnInput<FileSnapshot> {
  format: WorkspaceFormat;
  fileSnapshot?: FileSnapshot;
  changeSet: unknown;
  proposal?: unknown;
  diff: AgentDiff;
  ops?: GridOp[];
  board?: BoardPatch;
  word?: WordEdit[];
}

/** Word paragraph deletions must apply after other edits, in descending block order. */
export function orderWordEditsForApply(edits: readonly WordEdit[]): WordEdit[] {
  return [
    ...edits.filter((edit) => !edit.remove && !edit.table),
    ...edits.filter((edit) => edit.table),
    ...edits.filter((edit) => edit.remove).sort((a, b) => (b.blockIdx ?? -1) - (a.blockIdx ?? -1)),
  ];
}

/** Capture pre-change grid state used by review diff, reject, and undo. */
export function captureGridOpBeforeState(ops: readonly GridOp[], api: GridStateReader | null | undefined): GridOp[] {
  if (!api) return ops.map((op) => ({ ...op }));
  return ops.map((op) => ({
    ...op,
    before: api.getValue(op.a1),
    beforeState: api.getCellState(op.a1),
  }));
}

export interface WorkspaceDiffTurn<FileSnapshot> {
  role: 'assistant';
  kind: 'diff';
  format: WorkspaceFormat;
  fileSnapshot?: FileSnapshot;
  changeSet: unknown;
  proposal?: unknown;
  diff: AgentDiff;
  ops: GridOp[];
  board?: BoardPatch;
  word?: WordEdit[];
  text?: string;
}

export function makeWorkspaceDiffTurn<FileSnapshot>(
  previous: AssistantTurn,
  input: WorkspaceDiffTurnInput<FileSnapshot>,
): WorkspaceDiffTurn<FileSnapshot> {
  return {
    role: 'assistant',
    kind: 'diff',
    format: input.format,
    fileSnapshot: input.fileSnapshot,
    changeSet: input.changeSet,
    proposal: input.proposal,
    diff: input.diff,
    ops: input.ops ?? [],
    ...(input.board ? { board: input.board } : {}),
    ...(input.word ? { word: input.word } : {}),
    text: previous.kind === 'answer' ? previous.text : undefined,
  };
}

export function replaceLastWithWorkspaceDiff<Turn extends ThreadTurn, FileSnapshot>(
  thread: readonly Turn[],
  input: WorkspaceDiffTurnInput<FileSnapshot>,
): Array<Turn | WorkspaceDiffTurn<FileSnapshot>> {
  return thread.map((turn, index): Turn | WorkspaceDiffTurn<FileSnapshot> => {
    if (index !== thread.length - 1 || turn.role !== 'assistant' || !('kind' in turn)) return turn;
    return makeWorkspaceDiffTurn(turn as AssistantTurn, input);
  });
}
