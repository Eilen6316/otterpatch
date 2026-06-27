/**
 * DrawioSurgicalWriteback —— drawio 外科写回。
 * .drawio = <mxfile> 下多个 <diagram>;只重写被命中的 <diagram> 的 mxGraphModel,
 * 其余 diagram 及 diagram 之间的字节原样透传(与 OOXML 外科补丁同一哲学,只是"部件"换成 <diagram>)。
 * 每条 edit 经其锚点 portable(kind:'object' → slide=diagram 序号, elementId=mxCell id)定位。
 * 仅支持未压缩图;压缩图(deflateRaw+base64)抛错提示 compressed=false。
 */
import type {
  ChangeSet,
  DocHandle,
  EditOp,
  EditOpKind,
  FidelityReport,
  LogicalAnchor,
  OoxmlPart,
  WritebackBackend,
  WritebackId,
  WritebackKind,
  WritebackResult,
} from '@office-agent/core';
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

    // 按 diagram 序号分组 edits
    const byDiagram = new Map<number, DrawioEdit[]>();
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
      list.push(mapOp(anchor, e.op));
    }

    // 重组:gap 与未命中 diagram 字节透传,只重写命中 diagram
    let out = '';
    let pos = 0;
    const touched: string[] = [];
    matches.forEach((m, idx) => {
      out += xml.slice(pos, m.index);
      const edits = byDiagram.get(idx);
      if (edits && edits.length) {
        const inner = m[2]!;
        if (!inner.includes('<mxGraphModel')) {
          throw new Error('DrawioSurgicalWriteback: 压缩 diagram 暂不支持(请设 compressed=false)');
        }
        out += `<diagram${m[1]!}>${applyEditsToModel(inner, edits)}</diagram>`;
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
    return { ok: true, bytes: encd.encode(out), touchedParts: touched, fidelity };
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
