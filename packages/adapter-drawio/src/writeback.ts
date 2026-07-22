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
import { assertChangeSet, assertFormatCapabilities, writebackOperationKindsFor } from '@otterpatch/core';
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
import { applyEditsToModel, type DrawioDisplayProps, type DrawioEdit, type DrawioObjectSpec } from './mxgraph.js';

const dec = new TextDecoder();
const encd = new TextEncoder();
const DIAGRAM_RE = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g;
const attrOf = (s: string, n: string): string | undefined => new RegExp(`\\b${n}="([^"]*)"`).exec(s)?.[1];
const SUPPORTED: ReadonlySet<EditOpKind> = new Set(writebackOperationKindsFor('drawio'));

function displayProps(props: Record<string, unknown>): DrawioDisplayProps {
  return {
    ...(typeof props.value === 'string' ? { value: props.value } : {}),
    ...(typeof props.style === 'string' ? { style: props.style } : {}),
  };
}

function mapOp(anchor: LogicalAnchor, op: EditOp): DrawioEdit {
  const cellId = anchor.portable.kind === 'object' ? anchor.portable.elementId : '';
  if (op.family === 'object') {
    switch (op.kind) {
      case 'setObjectProps':
        return { cellId, op: { kind: 'setProps', props: displayProps(op.props) } };
      case 'moveObject':
        return { cellId, op: { kind: 'move', box: { x: op.box.left, y: op.box.top, width: op.box.width, height: op.box.height } } };
      case 'addObject': {
        if (!op.payload || typeof op.payload !== 'object') throw new Error('drawio: addObject payload must be an object');
        const spec = { ...(op.payload as DrawioObjectSpec) };
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
    try {
      assertChangeSet(cs);
      assertFormatCapabilities('drawio', cs, 'writeback');
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const bad = cs.edits.find((e) => !SUPPORTED.has(e.op.kind));
    if (bad) return { ok: false, reason: `op ${bad.op.kind} not supported by drawio surgical` };
    return { ok: true };
  }

  supports(op: EditOpKind, _part: OoxmlPart): boolean {
    return SUPPORTED.has(op);
  }

  async commit(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult> {
    if (!doc.bytes) throw new Error('DrawioSurgicalWriteback.commit: DocHandle.bytes required');
    assertChangeSet(cs);
    const support = this.canHandle(cs);
    if (!support.ok) throw new Error(`DrawioSurgicalWriteback cannot handle ChangeSet: ${support.reason ?? 'unsupported'}`);
    const xml = dec.decode(doc.bytes);
    const matches = [...xml.matchAll(DIAGRAM_RE)];

    // Group edits by diagram index
    const byDiagram = new Map<number, Array<{ editId: EditId; edit: DrawioEdit }>>();
    const dropped: Array<{ editId: EditId; reason: string }> = [];
    for (const e of cs.edits) {
      try {
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
      } catch (err) {
        dropped.push({ editId: e.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    // Reassemble: pass through gap bytes and untouched diagrams verbatim; rewrite only targeted diagrams
    let out = '';
    let pos = 0;
    const touched: string[] = [];
    const applied: EditId[] = [];
    matches.forEach((m, idx) => {
      out += xml.slice(pos, m.index);
      const entries = byDiagram.get(idx);
      if (entries && entries.length) {
        const edits = entries.map((x) => x.edit);
        const inner = m[2]!;
        if (!inner.includes('<mxGraphModel')) {
          throw new Error('DrawioSurgicalWriteback: 压缩 diagram 暂不支持(请设 compressed=false)');
        }
        try {
          out += `<diagram${m[1]!}>${applyEditsToModel(inner, edits)}</diagram>`;
          applied.push(...entries.map((x) => x.editId));
          touched.push(attrOf(m[1]!, 'id') ?? `#${idx}`);
        } catch (err) {
          out += m[0];
          dropped.push(...entries.map((x) => ({ editId: x.editId, reason: err instanceof Error ? err.message : String(err) })));
        }
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

  async verify(before: DocHandle, after: DocHandle, cs: ChangeSet): Promise<FidelityReport> {
    if (!before.bytes || !after.bytes) throw new Error('DrawioSurgicalWriteback.verify: before/after bytes required');
    const a = [...dec.decode(before.bytes).matchAll(DIAGRAM_RE)].map((m) => m[0]);
    const b = [...dec.decode(after.bytes).matchAll(DIAGRAM_RE)].map((m) => m[0]);
    const n = Math.max(a.length, b.length);
    const drift: FidelityReport['drift'] = [];
    const expected = new Set(cs.edits.map((edit) => {
      const anchor = cs.anchors[edit.target];
      return anchor?.portable.kind === 'object' ? anchor.portable.slide : -1;
    }));
    let identical = 0;
    for (let i = 0; i < n; i++) {
      if (a[i] === b[i]) identical++;
      else if (!expected.has(i)) drift.push({ part: `diagram#${i}`, kind: 'content', note: 'unexpected change' });
    }
    return { score: n === 0 ? 1 : identical / n, drift };
  }
}
