/**
 * DrawioSurgicalWriteback — surgical writeback for drawio.
 * A .drawio file is an <mxfile> containing multiple <diagram> elements; only the
 * mxGraphModel of the targeted <diagram> is rewritten, while untouched diagrams and
 * the bytes between them pass through verbatim (same philosophy as the OOXML surgical
 * patch, with <diagram> as the "part" unit).
 * Each edit is located via its portable anchor (kind:'object' → slide = diagram index,
 * elementId = mxCell id).
 * Only uncompressed diagrams are supported; compressed ones (deflateRaw+base64) throw
 * with a hint to set compressed=false.
 */
import type {
  ChangeSet,
  DocHandle,
  EditId,
  EditOp,
  EditOpKind,
  FidelityReport,
  LogicalAnchor,
  OoxmlPart,
  WritebackBackend,
  WritebackId,
  WritebackKind,
  WritebackResult,
} from '@otterpatch/core';
import { applyEditsToModel, type DrawioEdit, type DrawioObjectSpec } from './mxgraph.js';

const dec = new TextDecoder();
const encd = new TextEncoder();
const DIAGRAM_RE = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g;
const attrOf = (s: string, n: string): string | undefined => new RegExp(`\\b${n}="([^"]*)"`).exec(s)?.[1];
const stringifyProps = (p: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]));

const SUPPORTED: ReadonlySet<EditOpKind> = new Set<EditOpKind>([
  'setValue',
  'setObjectProps',
  'moveObject',
  'addObject',
  'deleteObject',
]);

function mapOp(anchor: LogicalAnchor, op: EditOp): DrawioEdit {
  const cellId = anchor.portable.kind === 'object' ? anchor.portable.elementId : '';
  if (op.family === 'object') {
    switch (op.kind) {
      case 'setObjectProps':
        return { cellId, op: { kind: 'setProps', props: stringifyProps(op.props) } };
      case 'moveObject':
        return { cellId, op: { kind: 'move', box: { x: op.box.left, y: op.box.top, width: op.box.width, height: op.box.height } } };
      case 'addObject': {
        const spec = { ...(op.payload as DrawioObjectSpec) };
        if (spec.parent == null && cellId) spec.parent = cellId;
        return { cellId, op: { kind: 'add', spec } };
      }
      case 'deleteObject':
        return { cellId, op: { kind: 'delete' } };
    }
  }
  if (op.family === 'value' && op.kind === 'setValue') {
    return { cellId, op: { kind: 'setProps', props: { value: String(op.value ?? '') } } };
  }
  throw new Error(`DrawioSurgicalWriteback: unsupported op ${op.family}/${op.kind}`);
}

export class DrawioSurgicalWriteback implements WritebackBackend {
  readonly id = 'drawio-surgical' as WritebackId;
  readonly strategy: WritebackKind = 'surgical-xml';

  canHandle(cs: ChangeSet): { ok: boolean; reason?: string } {
    const bad = cs.edits.find((e) => !SUPPORTED.has(e.op.kind));
    if (bad) return { ok: false, reason: `op ${bad.op.kind} not supported by drawio surgical` };
    return { ok: true };
  }

  supports(op: EditOpKind, _part: OoxmlPart): boolean {
    return SUPPORTED.has(op);
  }

  async commit(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult> {
    if (!doc.bytes) throw new Error('DrawioSurgicalWriteback.commit: DocHandle.bytes required');
    const xml = dec.decode(doc.bytes);
    const matches = [...xml.matchAll(DIAGRAM_RE)];

    // Group edits by diagram index
    const byDiagram = new Map<number, Array<{ editId: EditId; edit: DrawioEdit }>>();
    for (const e of cs.edits) {
      const anchor = cs.anchors[e.target];
      if (!anchor || anchor.portable.kind !== 'object') {
        throw new Error('DrawioSurgicalWriteback: edit anchor must be a drawio object locator');
      }
      const di = anchor.portable.slide;
      let list = byDiagram.get(di);
      if (!list) {
        list = [];
        byDiagram.set(di, list);
      }
      list.push({ editId: e.id, edit: mapOp(anchor, e.op) });
    }

    // Reassemble: pass through gap bytes and untouched diagrams verbatim; rewrite only targeted diagrams
    let out = '';
    let pos = 0;
    const touched: string[] = [];
    const applied: EditId[] = [];
    const dropped: Array<{ editId: EditId; reason: string }> = [];
    matches.forEach((m, idx) => {
      out += xml.slice(pos, m.index);
      const entries = byDiagram.get(idx);
      if (entries && entries.length) {
        const edits = entries.map((x) => x.edit);
        const inner = m[2]!;
        if (!inner.includes('<mxGraphModel')) {
          throw new Error('DrawioSurgicalWriteback: 压缩 diagram 暂不支持(请设 compressed=false)');
        }
        out += `<diagram${m[1]!}>${applyEditsToModel(inner, edits)}</diagram>`;
        applied.push(...entries.map((x) => x.editId));
        touched.push(attrOf(m[1]!, 'id') ?? `#${idx}`);
      } else {
        out += m[0];
      }
      pos = m.index! + m[0].length;
    });
    out += xml.slice(pos);

    const total = matches.length;
    const fidelity: FidelityReport = {
      score: total === 0 ? 1 : (total - touched.length) / total,
      drift: [],
    };
    for (const [idx, entries] of byDiagram) {
      if (idx < 0 || idx >= matches.length) {
        dropped.push(...entries.map((x) => ({ editId: x.editId, reason: `diagram index ${idx} out of range` })));
      }
    }
    return {
      ok: dropped.length === 0 && applied.length === cs.edits.length,
      bytes: encd.encode(out),
      touchedParts: touched,
      fidelity,
      appliedEditIds: applied,
      ...(dropped.length ? { droppedEdits: dropped } : {}),
    };
  }

  async verify(before: DocHandle, after: DocHandle, _cs: ChangeSet): Promise<FidelityReport> {
    if (!before.bytes || !after.bytes) throw new Error('DrawioSurgicalWriteback.verify: before/after bytes required');
    const a = [...dec.decode(before.bytes).matchAll(DIAGRAM_RE)].map((m) => m[0]);
    const b = [...dec.decode(after.bytes).matchAll(DIAGRAM_RE)].map((m) => m[0]);
    const n = Math.max(a.length, b.length);
    const drift: FidelityReport['drift'] = [];
    let identical = 0;
    for (let i = 0; i < n; i++) {
      if (a[i] === b[i]) identical++;
      else drift.push({ part: `diagram#${i}`, kind: 'content', note: 'changed' });
    }
    return { score: n === 0 ? 1 : identical / n, drift };
  }
}
