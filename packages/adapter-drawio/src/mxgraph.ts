/**
 * mxGraphModel operation engine: setProps/move/add/delete by mxCell id (delete cascades to edges and children).
 * Approach mirrors applyDiagramOperations from DayuanJiang/next-ai-draw-io: parse into a cell list → edit matched cells by id → serialize.
 * Handles only UNCOMPRESSED .drawio (bare mxCell under <root>); compressed diagrams (deflateRaw+base64) deferred until pako is added.
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

export interface DrawioDisplayProps {
  value?: string;
  style?: string;
}

export type DrawioOp =
  | { kind: 'setProps'; props: DrawioDisplayProps }
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
  vertex: boolean;
  edge: boolean;
  raw: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');


const MUTABLE_CELL_ATTRS = new Set(['value', 'style']);
const SAFE_GEOMETRY_ATTRS = new Set(['x', 'y', 'width', 'height']);
function assertMutableCellAttr(name: string): void {
  if (!MUTABLE_CELL_ATTRS.has(name)) throw new Error('drawio: immutable mxCell attribute ' + name);
}
function assertSafeGeometryAttr(name: string, value: number): void {
  if (!SAFE_GEOMETRY_ATTRS.has(name)) throw new Error('drawio: unsupported mxGeometry attribute ' + name);
  if (!Number.isFinite(value)) throw new Error('drawio: invalid mxGeometry ' + name);
}

const attr = (raw: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(raw)?.[1];

const meta = (raw: string): Cell => ({
  id: attr(raw, 'id') ?? '',
  parent: attr(raw, 'parent'),
  source: attr(raw, 'source'),
  target: attr(raw, 'target'),
  vertex: attr(raw, 'vertex') === '1',
  edge: attr(raw, 'edge') === '1',
  raw,
});

/** Parse the mxCell list inside <root> (both self-closing and content-bearing forms). */
function parseCells(rootInner: string): Cell[] {
  const re = /<mxCell\b[^>]*\/>|<mxCell\b[^>]*>[\s\S]*?<\/mxCell>/g;
  const out: Cell[] = [];
  for (const m of rootInner.matchAll(re)) out.push(meta(m[0]));
  return out;
}

const serializeCells = (cells: Cell[]): string => cells.map((c) => c.raw).join('');

/** Set an attribute on a single tag string (up to the first >): replace if present, else insert before > or />. */
function setTagAttr(tag: string, name: string, val: string): string {
  assertMutableCellAttr(name);
  const re = new RegExp(`(\\b${name}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, `$1${esc(val)}$2`);
  return tag.replace(/(\s*\/?>)\s*$/, ` ${name}="${esc(val)}"$1`);
}

/** Edit only the mxCell opening tag (up to the first >), preserving the inner mxGeometry. */
function editOpenTag(raw: string, fn: (tag: string) => string): string {
  const gt = raw.indexOf('>') + 1;
  return fn(raw.slice(0, gt)) + raw.slice(gt);
}

/** Update x/y/width/height on the inner mxGeometry. */
function setGeometry(raw: string, box: Record<string, number | undefined>): string {
  return raw.replace(/<mxGeometry\b[^>]*?\/?>/, (g) => {
    let t = g;
    for (const [k, v] of Object.entries(box)) {
      if (v == null) continue;
      assertSafeGeometryAttr(k, v);
      const re = new RegExp(`(\\b${k}=")[^"]*(")`);
      if (re.test(t)) t = t.replace(re, `$1${String(v)}$2`);
      else t = t.replace(/(\s*\/?>)\s*$/, ` ${k}="${String(v)}"$1`);
    }
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
  for (const [k, v] of Object.entries(g)) if (v != null) assertSafeGeometryAttr(k, v);
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

function requireRef(spec: DrawioObjectSpec, key: 'parent' | 'source' | 'target'): string | undefined {
  const value = spec[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`drawio: add ${spec.id} has invalid ${key}`);
  return value;
}

function assertTopology(cells: Cell[], subjectIds: ReadonlySet<string>): void {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  for (const id of subjectIds) {
    const cell = byId.get(id);
    if (!cell) continue;
    if (cell.parent === id || cell.source === id || cell.target === id) {
      throw new Error(`drawio: cell "${id}" references itself`);
    }
    if (!cell.parent || !byId.has(cell.parent)) throw new Error(`drawio: parent "${cell.parent ?? ''}" for "${id}" not found`);
    if (byId.get(cell.parent)!.edge) throw new Error(`drawio: parent "${cell.parent}" for "${id}" is an edge`);
    if (cell.edge) {
      if (!cell.source || !byId.has(cell.source)) throw new Error(`drawio: source "${cell.source ?? ''}" for "${id}" not found`);
      if (!cell.target || !byId.has(cell.target)) throw new Error(`drawio: target "${cell.target ?? ''}" for "${id}" not found`);
      if (cell.source === cell.target) throw new Error(`drawio: edge "${id}" source and target must differ`);
      if (byId.get(cell.source)!.edge || byId.get(cell.target)!.edge) {
        throw new Error(`drawio: edge "${id}" endpoints must be vertices`);
      }
    }

    const seen = new Set<string>();
    let cursor: Cell | undefined = cell;
    while (cursor) {
      if (seen.has(cursor.id)) throw new Error(`drawio: parent cycle involving "${id}"`);
      seen.add(cursor.id);
      cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
    }
  }
}

function assertValidAdditions(cells: Cell[], edits: DrawioEdit[]): Set<string> {
  const knownIds = new Set(cells.map((cell) => cell.id));
  const addedIds = new Set<string>();
  const planned: Cell[] = [];
  for (const edit of edits) {
    if (edit.op.kind !== 'add') continue;
    const spec = edit.op.spec;
    if (typeof spec.id !== 'string' || !spec.id.trim()) throw new Error('drawio: add requires a non-empty id');
    if (knownIds.has(spec.id)) throw new Error(`drawio: duplicate cell id "${spec.id}"`);
    if ((spec.vertex === true) === (spec.edge === true)) {
      throw new Error(`drawio: add "${spec.id}" must be exactly one of vertex or edge`);
    }
    if ((spec.vertex !== undefined && typeof spec.vertex !== 'boolean') || (spec.edge !== undefined && typeof spec.edge !== 'boolean')) {
      throw new Error(`drawio: add "${spec.id}" has invalid vertex/edge flags`);
    }
    const parent = requireRef(spec, 'parent');
    const source = requireRef(spec, 'source');
    const target = requireRef(spec, 'target');
    if (spec.edge && (!source || !target)) throw new Error(`drawio: edge "${spec.id}" requires source and target`);
    if (spec.vertex && (source || target)) throw new Error(`drawio: vertex "${spec.id}" cannot have edge endpoints`);

    knownIds.add(spec.id);
    addedIds.add(spec.id);
    planned.push({
      id: spec.id,
      ...(parent ? { parent } : {}),
      ...(source ? { source } : {}),
      ...(target ? { target } : {}),
      vertex: spec.vertex === true,
      edge: spec.edge === true,
      raw: '',
    });
  }
  assertTopology([...cells, ...planned], addedIds);
  return addedIds;
}

/** Apply a batch of edits to the cell list (pure function; returns a new list). */
export function applyEdits(cells: Cell[], edits: DrawioEdit[]): Cell[] {
  const addedIds = assertValidAdditions(cells, edits);
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
      if (Object.keys(props).length === 0) throw new Error('drawio: setProps requires value or style');
      raw = editOpenTag(raw, (t) => {
        let tt = t;
        for (const [k, v] of Object.entries(props)) {
          if (typeof v !== 'string') throw new Error(`drawio: ${k} must be a string`);
          tt = setTagAttr(tt, k, v);
        }
        return tt;
      });
    } else {
      raw = setGeometry(raw, ed.op.box);
    }
    arr[i] = meta(raw);
  }
  assertTopology(arr, addedIds);
  return arr;
}

/** Apply edits to an mxGraphModel XML string (rewrites only the <root> content). */
export function applyEditsToModel(model: string, edits: DrawioEdit[]): string {
  const m = /(<root\b[^>]*>)([\s\S]*?)(<\/root>)/.exec(model);
  if (!m) throw new Error('drawio: <root> not found (压缩图?请设 compressed=false)');
  const next = serializeCells(applyEdits(parseCells(m[2]!), edits));
  return model.slice(0, m.index) + m[1]! + next + m[3]! + model.slice(m.index + m[0]!.length);
}
