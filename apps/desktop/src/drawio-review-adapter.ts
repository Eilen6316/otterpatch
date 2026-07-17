import type { BoardObject, BoardPatch } from './proposal-materializers.js';

export interface DrawioReviewBoard {
  removeObjects(ids: string[]): void;
  restoreObject(object: BoardObject): void;
}

export type BoardEditState = 'prior' | 'next';
export type BoardDiffView = 'orig' | 'final';

function boardObjectSnapshot(object: BoardObject): BoardObject {
  return {
    ...(object.node ? { node: object.node } : {}),
    ...(object.edge ? { edge: object.edge } : {}),
  };
}

/** Project one proposal edit to its state before or after the proposal. */
export function setBoardEditState(
  patch: BoardPatch,
  editId: string,
  state: BoardEditState,
  board: DrawioReviewBoard | null | undefined,
): void {
  if (!board) return;

  const mutation = patch.muts?.[editId];
  const id = patch.byEdit[editId];
  if (mutation) {
    if (state === 'prior') board.restoreObject(mutation.prior);
    else if (mutation.next) board.restoreObject(mutation.next);
    else {
      const mutationId = id ?? mutation.prior.node?.id ?? mutation.prior.edge?.id;
      if (mutationId) board.removeObjects([mutationId]);
    }
    return;
  }

  const object = patch.objs.find((candidate) => candidate.editId === editId);
  if (!object) return;
  if (state === 'prior') {
    const objectId = id ?? object.node?.id ?? object.edge?.id;
    if (objectId) board.removeObjects([objectId]);
    return;
  }

  board.restoreObject(boardObjectSnapshot(object));
}

export function applyBoardPatchView(
  patch: BoardPatch,
  options: {
    editIds: readonly string[];
    view: BoardDiffView;
    isAccepted: (editId: string) => boolean;
    board: DrawioReviewBoard | null | undefined;
  },
): void {
  for (const editId of options.editIds) {
    const state = options.view === 'final' && options.isAccepted(editId) ? 'next' : 'prior';
    setBoardEditState(patch, editId, state, options.board);
  }
}

/** Remove proposal additions and restore every mutated object to its captured prior state. */
export function revertBoardPatch(
  patch: BoardPatch,
  board: DrawioReviewBoard | null | undefined,
): void {
  if (!board) return;
  const mutations = patch.muts ?? {};
  const addedIds = [...new Set(patch.objs
    .filter((object) => !mutations[object.editId])
    .map((object) => patch.byEdit[object.editId] ?? object.node?.id ?? object.edge?.id)
    .filter((id): id is string => !!id))];
  if (addedIds.length) board.removeObjects(addedIds);
  for (const mutation of Object.values(mutations)) board.restoreObject(mutation.prior);
}
