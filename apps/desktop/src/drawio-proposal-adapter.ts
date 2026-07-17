import { parseDrawioStyle, snap } from './DrawioBoard.js';
import type { BoardObject, BoardPatch } from './proposal-materializers.js';

export interface DrawioMutationBoard {
  getObject(id: string): BoardObject | null;
  updateObject(id: string, patch: { value?: string; style?: string }): void;
  removeObjects(ids: string[]): void;
  moveObject(id: string, box: { x?: number; y?: number; w?: number; h?: number }): void;
}

type DrawioMutationChangeSet = {
  edits?: Array<{
    id: string;
    target: string;
    op?: {
      kind?: string;
      props?: { value?: unknown; style?: unknown };
      box?: { left?: number; top?: number; width?: number; height?: number };
    };
  }>;
  anchors?: Record<string, { portable?: { elementId?: string } }>;
} | null;

export interface AppliedDrawioMutations {
  byEdit: Record<string, string>;
  muts: NonNullable<BoardPatch['muts']>;
}

/** Apply mutations to existing board objects and retain snapshots for review/reject. */
export function applyDrawioMutations(
  changeSet: unknown,
  board: DrawioMutationBoard | null | undefined,
): AppliedDrawioMutations {
  const cs = changeSet as DrawioMutationChangeSet;
  const byEdit: Record<string, string> = {};
  const muts: NonNullable<BoardPatch['muts']> = {};
  if (!cs?.edits) return { byEdit, muts };

  for (const edit of cs.edits) {
    const kind = edit.op?.kind;
    if (kind !== 'setObjectProps' && kind !== 'deleteObject' && kind !== 'moveObject') continue;

    const id = cs.anchors?.[edit.target]?.portable?.elementId;
    if (!id) continue;

    byEdit[edit.id] = id;
    const prior = board?.getObject(id);

    if (kind === 'setObjectProps') {
      const value = edit.op?.props?.value as string | undefined;
      const style = edit.op?.props?.style as string | undefined;
      board?.updateObject(id, { value, style });
      if (prior?.node) {
        muts[edit.id] = {
          prior,
          next: {
            node: {
              ...prior.node,
              ...(value != null ? { label: String(value) } : {}),
              ...(style ? parseDrawioStyle(style) : {}),
            },
          },
        };
      }
      continue;
    }

    if (kind === 'deleteObject') {
      board?.removeObjects([id]);
      if (prior) muts[edit.id] = { prior, next: null };
      continue;
    }

    const box = edit.op?.box ?? {};
    board?.moveObject(id, { x: box.left, y: box.top, w: box.width, h: box.height });
    if (prior?.node) {
      muts[edit.id] = {
        prior,
        next: {
          node: {
            ...prior.node,
            ...(box.left != null ? { x: snap(box.left) } : {}),
            ...(box.top != null ? { y: snap(box.top) } : {}),
            ...(box.width != null ? { w: box.width } : {}),
            ...(box.height != null ? { h: box.height } : {}),
          },
        },
      };
    }
  }

  return { byEdit, muts };
}
