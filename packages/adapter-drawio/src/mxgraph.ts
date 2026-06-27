/**
 * mxGraphModel 操作引擎:按 mxCell id 做 setProps/move/add/delete(级联删边和子节点)。
 * 思路照搬 DayuanJiang/next-ai-draw-io 的 applyDiagramOperations:解析成 cell 列表 → 按 id 命中改 → 序列化。
 * 仅处理【未压缩】的 .drawio(<root> 下是裸 mxCell);压缩图(deflateRaw+base64)留待加 pako。
 */

export interface DrawioObjectSpec {
  id: string;
  value?: string;
  style?: string;
  vertex?: boolean;
  edge?: boolean;
  parent?: string;
  source?: string;
  target?: string;
  geometry?: { x?: number; y?: number; width?: number; height?: number };
}

export type DrawioOp =
  | { kind: 'setProps'; props: Record<string, string> } // value / style / … 属性
  | { kind: 'move'; box: { x?: number; y?: number; width?: number; height?: number } }
  | { kind: 'add'; spec: DrawioObjectSpec }
  | { kind: 'delete' };

export interface DrawioEdit {
  cellId: string;
  op: DrawioOp;
}

interface Cell {
  id: string;
  parent?: string;
  source?: string;
  target?: string;
  raw: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attr = (raw: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(raw)?.[1];

const meta = (raw: string): Cell => ({
  id: attr(raw, 'id') ?? '',
  parent: attr(raw, 'parent'),
  source: attr(raw, 'source'),
  target: attr(raw, 'target'),
  raw,
});

/** 解析 <root> 内的 mxCell 列表(自闭合 + 带内容两种)。 */
function parseCells(rootInner: string): Cell[] {
  const re = /<mxCell\b[^>]*\/>|<mxCell\b[^>]*>[\s\S]*?<\/mxCell>/g;
  const out: Cell[] = [];
  for (const m of rootInner.matchAll(re)) out.push(meta(m[0]));
  return out;
}

const serializeCells = (cells: Cell[]): string => cells.map((c) => c.raw).join('');

/** 在单个标签串(到第一个 > 为止)上 set 属性:有则替换,无则插到 > / /> 前。 */
function setTagAttr(tag: string, name: string, val: string): string {
  const re = new RegExp(`(\\b${name}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, `$1${esc(val)}$2`);
  return tag.replace(/(\s*\/?>)\s*$/, ` ${name}="${esc(val)}"$1`);
}

/** 只改 mxCell 开标签(到第一个 >),保留内部 mxGeometry。 */
function editOpenTag(raw: string, fn: (tag: string) => string): string {
  const gt = raw.indexOf('>') + 1;
  return fn(raw.slice(0, gt)) + raw.slice(gt);
}

/** 改内部 mxGeometry 的 x/y/width/height。 */
function setGeometry(raw: string, box: Record<string, number | undefined>): string {
  return raw.replace(/<mxGeometry\b[^>]*?\/?>/, (g) => {
    let t = g;
    for (const [k, v] of Object.entries(box)) if (v != null) t = setTagAttr(t, k, String(v));
    return t;
  });
}

function buildCell(s: DrawioObjectSpec): string {
  const a: string[] = [`id="${esc(s.id)}"`];
  if (s.value != null) a.push(`value="${esc(s.value)}"`);
  if (s.style != null) a.push(`style="${esc(s.style)}"`);
  if (s.vertex) a.push('vertex="1"');
  if (s.edge) a.push('edge="1"');
  if (s.parent != null) a.push(`parent="${esc(s.parent)}"`);
  if (s.source != null) a.push(`source="${esc(s.source)}"`);
  if (s.target != null) a.push(`target="${esc(s.target)}"`);
  const g = s.geometry ?? {};
  const geo =
    `<mxGeometry` +
    (g.x != null ? ` x="${g.x}"` : '') +
    (g.y != null ? ` y="${g.y}"` : '') +
    (g.width != null ? ` width="${g.width}"` : '') +
    (g.height != null ? ` height="${g.height}"` : '') +
    ` as="geometry" />`;
  return `<mxCell ${a.join(' ')}>${geo}</mxCell>`;
}

function collectDescendants(id: string, cells: Cell[], set: Set<string>): void {
  set.add(id);
  for (const c of cells) if (c.parent === id && !set.has(c.id)) collectDescendants(c.id, cells, set);
}

/** 把一组 edit 应用到 cell 列表(纯函数返回新列表)。 */
export function applyEdits(cells: Cell[], edits: DrawioEdit[]): Cell[] {
  let arr = cells.slice();
  for (const ed of edits) {
    if (ed.op.kind === 'add') {
      arr.push(meta(buildCell(ed.op.spec)));
      continue;
    }
    if (ed.op.kind === 'delete') {
      const remove = new Set<string>();
      collectDescendants(ed.cellId, arr, remove);
      arr = arr.filter(
        (c) => !remove.has(c.id) && !(c.source && remove.has(c.source)) && !(c.target && remove.has(c.target)),
      );
      continue;
    }
    const i = arr.findIndex((c) => c.id === ed.cellId);
    if (i < 0) throw new Error(`drawio: cell "${ed.cellId}" not found`);
    let raw = arr[i]!.raw;
    if (ed.op.kind === 'setProps') {
      const props = ed.op.props;
      raw = editOpenTag(raw, (t) => {
        let tt = t;
        for (const [k, v] of Object.entries(props)) tt = setTagAttr(tt, k, v);
        return tt;
      });
    } else {
      raw = setGeometry(raw, ed.op.box);
    }
    arr[i] = meta(raw);
  }
  return arr;
}

/** 对一段 mxGraphModel XML 应用 edits(只重写 <root> 内容)。 */
export function applyEditsToModel(model: string, edits: DrawioEdit[]): string {
  const m = /(<root\b[^>]*>)([\s\S]*?)(<\/root>)/.exec(model);
  if (!m) throw new Error('drawio: <root> not found (压缩图?请设 compressed=false)');
  const next = serializeCells(applyEdits(parseCells(m[2]!), edits));
  return model.slice(0, m.index) + m[1]! + next + m[3]! + model.slice(m.index + m[0]!.length);
}
