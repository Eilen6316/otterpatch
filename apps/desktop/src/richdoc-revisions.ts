import { escapeCssAttribute } from './richdoc-editing.js';
import type {
  RichDocDocumentChange,
  RichDocRevisionPageState,
  RichDocUndoEntry,
} from './richdoc-editing.js';

export interface RichDocRevisionContext {
  root: HTMLElement;
  undoMap: Map<string, RichDocUndoEntry>;
  documentChanges: readonly RichDocDocumentChange[];
  setPage(patch: RichDocRevisionPageState): void;
  setDocumentChanges(changes: RichDocDocumentChange[]): void;
  onMutation(): void;
}

const REVISION_ATTRIBUTES = [
  'data-edit',
  'data-cid',
  'data-kind',
  'data-glyph',
  'tabindex',
  'contenteditable',
  'aria-label',
];

function applyRootStyle(root: HTMLElement, properties: Record<string, string>): void {
  const style = root.style;
  style.fontWeight = properties.fontWeight ?? '';
  style.fontStyle = properties.fontStyle ?? '';
  style.textDecoration = properties.textDecoration ?? '';
  style.fontFamily = properties.fontFamily ?? '';
  style.fontSize = properties.fontSize ?? '';
  style.color = properties.color ?? '';
  style.textAlign = properties.textAlign ?? '';
  style.lineHeight = properties.lineHeight ?? '';
  style.backgroundColor = properties.backgroundColor ?? '';
}

function stripRevisionAttributes(element: HTMLElement): void {
  REVISION_ATTRIBUTES.forEach((attribute) => element.removeAttribute(attribute));
}

function settle(root: HTMLElement, element: HTMLElement): void {
  element.classList.add('rd-settle');
  const view = root.ownerDocument.defaultView;
  if (view) view.setTimeout(() => element.classList.remove('rd-settle'), 400);
  else globalThis.setTimeout(() => element.classList.remove('rd-settle'), 400);
}

/** Restore one pending or just-accepted revision from its exact in-memory snapshot. */
export function revertRichDocRevision(context: RichDocRevisionContext, editId: string): boolean {
  const { root, undoMap } = context;
  const escapedId = escapeCssAttribute(editId);
  const info = undoMap.get(editId);
  if (info) {
    let restored = true;
    if (info.mode === 'root') {
      applyRootStyle(root, info.priorProps);
      if (info.priorPage) context.setPage(info.priorPage);
      context.setDocumentChanges(context.documentChanges.filter((change) => change.cid !== editId));
    } else if (info.mode === 'insertBlock') {
      const inserted = root.contains(info.el)
        ? info.el
        : root.querySelector(`[data-cid="${escapedId}"]`);
      if (inserted) inserted.remove();
      else restored = false;
    } else if (info.mode === 'block') {
      const current = root.contains(info.el)
        ? info.el
        : root.querySelector(`[data-edit-block="${escapedId}"]`);
      if (current?.parentNode) current.parentNode.replaceChild(info.prior.cloneNode(true), current);
      else if (info.acceptedAnchor?.parentNode) info.acceptedAnchor.replaceWith(info.prior.cloneNode(true));
      else restored = false;
    } else {
      const elements = Array.from(root.querySelectorAll(`[data-edit="${escapedId}"], [data-undo="${escapedId}"]`)) as HTMLElement[];
      if (elements.length && elements[0]!.parentNode) {
        elements[0]!.parentNode.insertBefore(info.prior.cloneNode(true), elements[0]!);
        elements.forEach((element) => element.remove());
      } else if (root.contains(info.el) && info.el.parentNode) {
        info.el.parentNode.insertBefore(info.prior.cloneNode(true), info.el);
        info.el.remove();
      } else restored = false;
    }
    if (!restored) return false;
    undoMap.delete(editId);
    context.onMutation();
    return true;
  }

  // A reload loses undoMap. Pending DOM revisions can still be rejected on a best-effort basis.
  const elements = Array.from(root.querySelectorAll(`[data-cid="${escapedId}"]`)) as HTMLElement[];
  if (!elements.length) return false;
  for (const element of elements) {
    if (element.getAttribute('data-kind') === 'insert' && element.classList.contains('rd-chg-blkins')) {
      element.remove();
    } else if (element.hasAttribute('data-edit-block')) {
      ['data-edit-block', 'data-cid', 'data-kind', 'data-glyph'].forEach((attribute) => element.removeAttribute(attribute));
      element.classList.remove('rd-chg-blkdel');
      element.style.textAlign = '';
      element.style.textAlignLast = '';
      element.style.lineHeight = '';
      element.style.backgroundColor = '';
    } else if (element.classList.contains('rd-fmt')) {
      element.replaceWith(...Array.from(element.childNodes));
    } else {
      const deleted = element.querySelector('del');
      if (deleted) element.replaceWith(...Array.from(deleted.childNodes));
      else element.remove();
    }
  }
  context.onMutation();
  return true;
}

/** Accept a revision by flattening its markup while retaining the current undo window. */
export function resolveRichDocRevision(context: RichDocRevisionContext, cid: string, state: 'accepted' | null): void {
  const { root, undoMap } = context;
  if (context.documentChanges.some((change) => change.cid === cid)) {
    if (state !== 'accepted') return;
    const info = undoMap.get(cid);
    if (info?.mode === 'root' && info.nextProps) {
      applyRootStyle(root, info.nextProps);
      if (info.nextPage) context.setPage(info.nextPage);
    }
    context.setDocumentChanges(context.documentChanges.filter((change) => change.cid !== cid));
    context.onMutation();
    return;
  }

  const elements = Array.from(root.querySelectorAll(`[data-cid="${escapeCssAttribute(cid)}"]`)) as HTMLElement[];
  if (!elements.length) return;
  if (state !== 'accepted') {
    elements.forEach((element) => element.classList.remove('is-accepted', 'is-rejected'));
    return;
  }

  for (const element of elements) {
    if (element.classList.contains('rd-chg-blkins')) {
      element.removeAttribute('data-edit-block');
      stripRevisionAttributes(element);
      element.classList.remove('rd-chg-blkins', 'is-new', 'is-active', 'is-linked');
      element.setAttribute('data-undo', cid);
      settle(root, element);
      continue;
    }
    if (element.getAttribute('data-kind') === 'remove') {
      const info = undoMap.get(cid);
      if (info?.mode === 'block' && info.el === element) {
        const anchor = root.ownerDocument.createComment('richdoc-undo');
        element.replaceWith(anchor);
        info.acceptedAnchor = anchor;
      } else element.remove();
      continue;
    }
    if (element.hasAttribute('data-edit-block')) {
      element.removeAttribute('data-edit-block');
      stripRevisionAttributes(element);
    } else if (element.classList.contains('rd-fmt')) {
      stripRevisionAttributes(element);
      element.className = '';
      element.setAttribute('data-undo', cid);
      settle(root, element);
    } else {
      element.querySelectorAll('del').forEach((deleted) => deleted.remove());
      element.querySelectorAll('ins').forEach((inserted) => {
        const inlineStyle = inserted.getAttribute('style');
        if (inlineStyle) {
          const span = root.ownerDocument.createElement('span');
          span.setAttribute('style', inlineStyle);
          while (inserted.firstChild) span.appendChild(inserted.firstChild);
          inserted.replaceWith(span);
        } else inserted.replaceWith(...Array.from(inserted.childNodes));
      });
      stripRevisionAttributes(element);
      element.className = '';
      element.setAttribute('data-undo', cid);
      settle(root, element);
    }
  }
  context.onMutation();
}

/** Permanently close the current undo window before a new proposal or conversation. */
export function closeRichDocUndoWindow(context: RichDocRevisionContext): void {
  const { root, undoMap } = context;
  root.querySelectorAll('[data-kind="remove"]').forEach((element) => element.remove());
  root.querySelectorAll('[data-undo]').forEach((node) => {
    const element = node as HTMLElement;
    element.removeAttribute('data-undo');
    element.classList.remove('rd-settle');
    if (!element.className) element.removeAttribute('class');
    if (element.tagName === 'SPAN' && !element.attributes.length) element.replaceWith(...Array.from(element.childNodes));
  });
  for (const entry of undoMap.values()) {
    if (entry.mode === 'block') entry.acceptedAnchor?.remove();
  }
  undoMap.clear();
  if (context.documentChanges.length) context.setDocumentChanges([]);
  context.onMutation();
}
