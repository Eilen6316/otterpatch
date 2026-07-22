import type { BoardMutationSnapshot, BoardObject, BoardPatch } from './proposal-materializers.js';

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

function objectId(object: BoardObject): string | undefined {
  return object.node?.id ?? object.edge?.id;
}

function restoreRelatedObjects(
  mutations: readonly BoardMutationSnapshot[],
  board: DrawioReviewBoard,
): void {
  const restored = new Set<string>();
  for (const mutation of mutations) {
    for (const related of mutation.priorRelated ?? []) {
      const id = objectId(related);
      if (id && restored.has(id)) continue;
      if (id) restored.add(id);
      board.restoreObject(related);
    }
  }
}

function setBoardEditStateInternal(
  patch: BoardPatch,
  editId: string,
  state: BoardEditState,
  board: DrawioReviewBoard,
  restoreRelated: boolean,
): void {
  const mutation = patch.muts?.[editId];
  const id = patch.byEdit[editId];
  if (mutation) {
    if (state === 'prior') {
      board.restoreObject(mutation.prior);
      if (restoreRelated) restoreRelatedObjects([mutation], board);
    } else if (mutation.next) board.restoreObject(mutation.next);
    else {
      const mutationId = id ?? objectId(mutation.prior);
      if (mutationId) board.removeObjects([mutationId]);
    }
    return;
  }

  const object = patch.objs.find((candidate) => candidate.editId === editId);
  if (!object) return;
  if (state === 'prior') {
    const addedObjectId = id ?? objectId(object);
    if (addedObjectId) board.removeObjects([addedObjectId]);
    return;
  }

  board.restoreObject(boardObjectSnapshot(object));
}

/** Project one proposal edit to its state before or after the proposal. */
export function setBoardEditState(
  patch: BoardPatch,
  editId: string,
  state: BoardEditState,
  board: DrawioReviewBoard | null | undefined,
): void {
  if (!board) return;
  setBoardEditStateInternal(patch, editId, state, board, true);
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
  const board = options.board;
  if (!board) return;
  const states = options.editIds.map((editId) => ({
    editId,
    state: options.view === 'final' && options.isAccepted(editId) ? 'next' as const : 'prior' as const,
  }));
  const priorMutations: BoardMutationSnapshot[] = [];

  for (const { editId, state } of states) {
    if (state !== 'prior') continue;
    setBoardEditStateInternal(patch, editId, state, board, false);
    const mutation = patch.muts?.[editId];
    if (mutation) priorMutations.push(mutation);
  }
  restoreRelatedObjects(priorMutations, board);
  for (const { editId, state } of states) {
    if (state === 'next') setBoardEditStateInternal(patch, editId, state, board, false);
  }
}

/** Remove proposal additions and restore every mutated object to its captured prior state. */
export function revertBoardPatch(
  patch: BoardPatch,
  board: DrawioReviewBoard | null | undefined,
  editIds?: readonly string[],
): void {
  if (!board) return;
  const selected = editIds ? new Set(editIds) : undefined;
  const mutations = Object.fromEntries(
    Object.entries(patch.muts ?? {}).filter(([editId]) => !selected || selected.has(editId)),
  );
  const addedIds = [...new Set(patch.objs
    .filter((object) => !selected || selected.has(object.editId))
    .filter((object) => !mutations[object.editId])
    .map((object) => patch.byEdit[object.editId] ?? object.node?.id ?? object.edge?.id)
    .filter((id): id is string => !!id))];
  if (addedIds.length) board.removeObjects(addedIds);
  for (const mutation of Object.values(mutations)) board.restoreObject(mutation.prior);
  restoreRelatedObjects(Object.values(mutations), board);
}
