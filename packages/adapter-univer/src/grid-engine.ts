/**
 * GridChangeSetEngine —— 网格(Excel)的真实 ChangeSetEngine:把 ChangeSet 应用到内存影子网格,
 * 算出每个单元格真实的 before/after,递归求值公式(支持单元格引用 / + - * / ( ) / SUM·AVERAGE·MIN·MAX·COUNT),
 * 捕获逐 edit 反演,产出可审阅 DiffView(batch → leaf),并把公式重算结果放进 effects。
 * rebase:无结构性变更(插删行)→ tracked(锚点零成本平移)。
 *
 * 这让 diff 不再"从 edits 直推",而是反映影子里真实的值与公式重算 —— OtterPatch 抽象层 §2/§3 的落地。
 */
import type {
  CellValue,
  ChangeSet,
  ChangeSetEngine,
  CapabilitySet,
  DiffNode,
  DiffNodeId,
  DiffView,
  DocRev,
  Edit,
  EditId,
  EditOp,
  LogicalAnchor,
  MutationLog,
  PreviewValue,
  ShadowDoc,
  ShadowResult,
  ValidationReport,
} from '@otterpatch/core';

export interface GridCell {
  value?: CellValue;
  formula?: string;
}
export type GridShadow = Map<string, GridCell>;
export const gridShadow = (init: Record<string, GridCell> = {}): GridShadow => new Map(Object.entries(init));

const cellName = (a1: string): string => {
  const i = a1.indexOf('!');
  return (i >= 0 ? a1.slice(i + 1) : a1).toUpperCase();
};
const a1Of = (anchor: LogicalAnchor | undefined): string =>
  anchor && anchor.portable.kind === 'grid' ? cellName(anchor.portable.a1) : '';

const colToNum = (c: string): number => {
  let n = 0;
  for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const numToCol = (n: number): string => {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const A1 = /^([A-Za-z]+)([0-9]+)$/;
function expandRange(r: string): string[] {
  const [from, to] = r.split(':');
  const a = A1.exec(from ?? '');
  const b = A1.exec(to ?? '');
  if (!a || !b) return [];
  const c1 = colToNum(a[1]!);
  const c2 = colToNum(b[1]!);
  const r1 = parseInt(a[2]!, 10);
  const r2 = parseInt(b[2]!, 10);
  const out: string[] = [];
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
    for (let rr = Math.min(r1, r2); rr <= Math.max(r1, r2); rr++) out.push(numToCol(c) + rr);
  return out;
}

/** 递归公式求值;get 解析单元格(含其公式),depth 防环。 */
function evalFormula(formula: string, get: (a1: string) => number): number {
  const expr = formula.replace(/^=/, '');
  let pos = 0;
  const rest = (): string => expr.slice(pos);
  const skip = (): void => {
    while (expr[pos] === ' ') pos++;
  };
  function parseExpr(): number {
    let v = parseTerm();
    skip();
    while (expr[pos] === '+' || expr[pos] === '-') {
      const op = expr[pos++];
      const t = parseTerm();
      v = op === '+' ? v + t : v - t;
      skip();
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    skip();
    while (expr[pos] === '*' || expr[pos] === '/') {
      const op = expr[pos++];
      const f = parseFactor();
      v = op === '*' ? v * f : v / f;
      skip();
    }
    return v;
  }
  function parseArgs(): number[] {
    const nums: number[] = [];
    skip();
    if (expr[pos] === ')') return nums;
    do {
      skip();
      const rng = /^[A-Za-z]+[0-9]+:[A-Za-z]+[0-9]+/.exec(rest());
      if (rng) {
        pos += rng[0].length;
        for (const cell of expandRange(rng[0])) nums.push(get(cell.toUpperCase()));
      } else {
        nums.push(parseExpr());
      }
      skip();
    } while (expr[pos] === ',' && ++pos);
    return nums;
  }
  function func(name: string, nums: number[]): number {
    switch (name) {
      case 'SUM':
        return nums.reduce((a, b) => a + b, 0);
      case 'AVERAGE':
      case 'AVG':
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      case 'MIN':
        return nums.length ? Math.min(...nums) : 0;
      case 'MAX':
        return nums.length ? Math.max(...nums) : 0;
      case 'COUNT':
        return nums.length;
      default:
        return 0;
    }
  }
  function parseFactor(): number {
    skip();
    const c = expr[pos];
    if (c === '(') {
      pos++;
      const v = parseExpr();
      skip();
      if (expr[pos] === ')') pos++;
      return v;
    }
    if (c === '-') {
      pos++;
      return -parseFactor();
    }
    if (c === '+') {
      pos++;
      return parseFactor();
    }
    const num = /^[0-9]+(\.[0-9]+)?/.exec(rest());
    if (num) {
      pos += num[0].length;
      return parseFloat(num[0]);
    }
    const letters = /^[A-Za-z]+/.exec(rest());
    if (letters) {
      pos += letters[0].length;
      if (expr[pos] === '(') {
        pos++;
        const args = parseArgs();
        skip();
        if (expr[pos] === ')') pos++;
        return func(letters[0].toUpperCase(), args);
      }
      const digits = /^[0-9]+/.exec(rest());
      if (digits) {
        pos += digits[0].length;
        return get((letters[0] + digits[0]).toUpperCase());
      }
      return 0;
    }
    return 0;
  }
  const v = parseExpr();
  return Number.isFinite(v) ? v : 0;
}

const toNum = (v: CellValue | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 解析单元格的数值(含公式递归,depth 防环)。 */
function cellNumber(grid: GridShadow, a1: string, depth = 0): number {
  const cell = grid.get(a1);
  if (!cell) return 0;
  if (cell.formula && depth < 32) return evalFormula(cell.formula, (ref) => cellNumber(grid, ref, depth + 1));
  return toNum(cell.value);
}
function cellPreview(grid: GridShadow, cell: GridCell): PreviewValue {
  if (cell.formula) return { kind: 'cell', value: evalFormula(cell.formula, (ref) => cellNumber(grid, ref)), formula: cell.formula };
  return { kind: 'cell', value: cell.value ?? null };
}

const VALUE_OPS = new Set(['setValue', 'setFormula', 'deleteRange']);

function inverseOf(before: GridCell): EditOp {
  if (before.formula) return { family: 'value', kind: 'setFormula', formula: before.formula };
  return { family: 'value', kind: 'setValue', value: before.value ?? null };
}

export class GridChangeSetEngine implements ChangeSetEngine {
  validate(cs: ChangeSet, caps: CapabilitySet): ValidationReport {
    const issues: ValidationReport['issues'] = [];
    for (const e of cs.edits) {
      const v = caps.supports({ op: e.op.kind });
      if (!v.ok) {
        if ('downgrade' in v) issues.push({ editId: e.id, code: 'unsupported', downgrade: { family: 'value', kind: v.downgrade } as EditOp });
        else issues.push({ editId: e.id, code: 'unsupported' });
      }
    }
    return { ok: issues.length === 0, issues };
  }

  async shadowApply(cs: ChangeSet, shadow: ShadowDoc): Promise<ShadowResult> {
    const grid = shadow as GridShadow;
    const capturedInverse: Record<EditId, EditOp> = {};
    const children: DiffNode[] = [];
    let firstAnchor: LogicalAnchor | undefined;

    for (const e of cs.edits) {
      const anchor = cs.anchors[e.target];
      if (!firstAnchor) firstAnchor = anchor;
      const a1 = a1Of(anchor);
      const before: GridCell = { ...(grid.get(a1) ?? {}) };
      const beforePV = cellPreview(grid, before);
      capturedInverse[e.id] = inverseOf(before);

      if (e.op.kind === 'setValue') grid.set(a1, { value: e.op.value });
      else if (e.op.kind === 'setFormula') grid.set(a1, { formula: e.op.formula });
      else if (e.op.kind === 'deleteRange') grid.set(a1, { value: null });
      // style/number-format 等:不改值,仅作为 diff 节点呈现

      const afterPV = cellPreview(grid, grid.get(a1) ?? {});
      children.push({
        id: ('n-' + e.id) as DiffNodeId,
        level: 'leaf',
        anchor: anchor as LogicalAnchor,
        editIds: [e.id],
        before: beforePV,
        after: afterPV,
        children: [],
        render: { badge: 'modify', label: a1 },
        state: 'pending',
      });
    }

    // 公式重算:收集所有公式单元格的当前计算值(依赖已在 cellNumber 里递归解析)
    const recalculated: CellValue[][] = [];
    for (const [a1, cell] of grid) {
      if (cell.formula) recalculated.push([a1, evalFormula(cell.formula, (ref) => cellNumber(grid, ref))]);
    }

    const root: DiffNode = {
      id: 'root' as DiffNodeId,
      level: 'batch',
      anchor: (firstAnchor ?? ({ portable: { kind: 'grid', sheet: '', a1: '' } } as unknown as LogicalAnchor)),
      editIds: cs.edits.map((e) => e.id),
      before: { kind: 'cell', value: null },
      after: { kind: 'cell', value: null },
      children,
      render: { badge: 'modify', label: cs.meta.intent },
      state: 'pending',
    };
    const diff: DiffView = { changeSetId: cs.id, hostId: cs.hostId, root, conflicts: [] };
    return { afterRev: (cs.baseRev + 1) as DocRev, diff, capturedInverse, effects: { recalculated } };
  }

  invert(cs: ChangeSet, applied: ShadowResult): ChangeSet {
    const edits: Edit[] = cs.edits.map((e) => ({
      id: 'inv-' + e.id,
      target: e.target,
      op: applied.capturedInverse[e.id] ?? inverseOf({}),
    }));
    return { ...cs, id: cs.id + '-inv', edits: [...edits].reverse(), meta: { ...cs.meta, intent: '撤销:' + cs.meta.intent } };
  }

  rebase(cs: ChangeSet, log: MutationLog, target: DocRev): { cs: ChangeSet; broken: EditId[] } {
    // 无结构性变更(插删行/列)→ tracked:锚点零成本平移,edits 原样;有则交给适配器 AnchorService(此处保守标 broken)
    const structural = Array.isArray(log) && log.some((m) => typeof m === 'object' && m !== null && 'structural' in (m as Record<string, unknown>));
    if (!structural) return { cs: { ...cs, baseRev: target }, broken: [] };
    return { cs: { ...cs, baseRev: target }, broken: cs.edits.map((e) => e.id) };
  }
}
