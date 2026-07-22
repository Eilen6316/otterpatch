/**
 * Deterministic in-memory Excel simulation for the operation subset advertised by
 * the adapter. Unsupported operations and formulas fail closed with stable codes.
 */
import {
  assertA1RangeBudget,
  type AbstractStyle,
  type CellValue,
  type ChangeSet,
  type ChangeSetEngine,
  type CapabilitySet,
  type DiffNode,
  type DiffNodeId,
  type DiffView,
  type DocRev,
  type Edit,
  type EditId,
  type EditOp,
  type EditOpKind,
  type LogicalAnchor,
  type MutationLog,
  type PreviewValue,
  type ShadowResult,
  type ValidationReport,
} from '@otterpatch/core';

export interface GridCell {
  value?: CellValue;
  formula?: string;
  style?: AbstractStyle;
}

export type GridShadow = Map<string, GridCell>;
const completeGridShadows = new WeakSet<GridShadow>();
export const gridShadow = (init: Record<string, GridCell> = {}, complete = false): GridShadow => {
  const shadow = new Map(Object.entries(init));
  if (complete) completeGridShadows.add(shadow);
  return shadow;
};

export type GridSimulationCode =
  | 'VERIFIER_UNSUPPORTED_OPERATION'
  | 'VERIFIER_UNSUPPORTED_FORMULA'
  | 'VERIFIER_FORMULA_CYCLE'
  | 'VERIFIER_FORMULA_VALUE'
  | 'VERIFIER_FORMULA_EVALUATION'
  | 'VERIFIER_INSUFFICIENT_SNAPSHOT'
  | 'VERIFIER_INVALID_TARGET'
  | 'VERIFIER_INVERSE_UNAVAILABLE';

export class GridSimulationError extends Error {
  constructor(
    readonly code: GridSimulationCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GridSimulationError';
  }
}

const SUPPORTED_GRID_OPS = new Set<EditOpKind>([
  'setValue',
  'setFormula',
  'deleteRange',
  'setStyle',
  'setNumberFormat',
]);
const SUPPORTED_GRID_STYLE_FIELDS = new Set(['bold', 'italic', 'color', 'bgColor', 'align']);
const SUPPORTED_FORMULA_FUNCTIONS = new Set(['SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'COUNT']);

export function gridEngineSupports(kind: EditOpKind): boolean {
  return SUPPORTED_GRID_OPS.has(kind);
}

function assertOperationSimulatable(op: EditOp, editId?: string): void {
  if (!gridEngineSupports(op.kind)) {
    throw new GridSimulationError(
      'VERIFIER_UNSUPPORTED_OPERATION',
      `grid simulation does not support ${op.kind}`,
      { ...(editId ? { editId } : {}), op: op.kind },
    );
  }
  if (op.kind !== 'setStyle') return;
  const unsupported = Object.keys(op.style).filter((key) => !SUPPORTED_GRID_STYLE_FIELDS.has(key));
  if (!Object.keys(op.style).length || unsupported.length) {
    throw new GridSimulationError(
      'VERIFIER_UNSUPPORTED_OPERATION',
      unsupported.length
        ? `grid simulation does not support setStyle fields: ${unsupported.join(', ')}`
        : 'grid simulation does not support an empty setStyle operation',
      { ...(editId ? { editId } : {}), op: op.kind, fields: unsupported },
    );
  }
}

const A1 = /^([A-Za-z]+)([0-9]+)$/;

function cellName(a1: string): string {
  const bang = a1.lastIndexOf('!');
  return (bang >= 0 ? a1.slice(bang + 1) : a1).replace(/\$/g, '').toUpperCase();
}

function colToNum(column: string): number {
  let value = 0;
  for (const char of column.toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value;
}

function numToCol(value: number): string {
  let column = '';
  let remaining = value;
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    column = String.fromCharCode(65 + digit) + column;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return column;
}

export function expandGridRange(a1: string): string[] {
  const bare = cellName(a1);
  assertA1RangeBudget(bare);
  const [from, to = from] = bare.split(':');
  const start = A1.exec(from ?? '');
  const end = A1.exec(to ?? '');
  if (!start || !end) {
    throw new GridSimulationError('VERIFIER_INVALID_TARGET', `invalid grid target ${a1}`, { a1 });
  }
  const firstColumn = colToNum(start[1]!);
  const lastColumn = colToNum(end[1]!);
  const firstRow = Number(start[2]);
  const lastRow = Number(end[2]);
  const refs: string[] = [];
  for (let row = Math.min(firstRow, lastRow); row <= Math.max(firstRow, lastRow); row++) {
    for (let column = Math.min(firstColumn, lastColumn); column <= Math.max(firstColumn, lastColumn); column++) {
      refs.push(numToCol(column) + row);
    }
  }
  return refs;
}

function cloneCell(cell: GridCell | undefined): GridCell {
  if (!cell) return {};
  return {
    ...(cell.value !== undefined ? { value: cell.value } : {}),
    ...(cell.formula !== undefined ? { formula: cell.formula } : {}),
    ...(cell.style ? { style: { ...cell.style } } : {}),
  };
}

function formulaFailure(
  code: GridSimulationCode,
  formula: string,
  message: string,
  position?: number,
): never {
  throw new GridSimulationError(code, message, {
    formula,
    ...(position !== undefined ? { position } : {}),
  });
}

class FormulaParser {
  private readonly expression: string;
  private position = 0;

  constructor(
    private readonly formula: string,
    private readonly get: (ref: string) => number,
    private readonly getAggregateValues: (ref: string) => number[],
  ) {
    this.expression = formula.startsWith('=') ? formula.slice(1) : formula;
  }

  parse(): number {
    this.skipWhitespace();
    if (!this.expression.length) formulaFailure('VERIFIER_UNSUPPORTED_FORMULA', this.formula, 'formula is empty');
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.position !== this.expression.length) {
      formulaFailure(
        'VERIFIER_UNSUPPORTED_FORMULA',
        this.formula,
        `unsupported formula token near "${this.expression.slice(this.position, this.position + 16)}"`,
        this.position,
      );
    }
    if (!Number.isFinite(value)) {
      formulaFailure('VERIFIER_FORMULA_EVALUATION', this.formula, 'formula produced a non-finite result', this.position);
    }
    return value;
  }

  private rest(): string {
    return this.expression.slice(this.position);
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.expression[this.position] ?? '')) this.position++;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    this.skipWhitespace();
    while (this.expression[this.position] === '+' || this.expression[this.position] === '-') {
      const operator = this.expression[this.position++]!;
      const next = this.parseTerm();
      value = operator === '+' ? value + next : value - next;
      this.skipWhitespace();
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    this.skipWhitespace();
    while (this.expression[this.position] === '*' || this.expression[this.position] === '/') {
      const operator = this.expression[this.position++]!;
      const next = this.parseFactor();
      if (operator === '/' && next === 0) {
        formulaFailure('VERIFIER_FORMULA_EVALUATION', this.formula, 'division by zero cannot be represented by the shadow value', this.position);
      }
      value = operator === '*' ? value * next : value / next;
      this.skipWhitespace();
    }
    return value;
  }

  private parseFactor(): number {
    this.skipWhitespace();
    const char = this.expression[this.position];
    if (char === '(') {
      this.position++;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.expression[this.position] !== ')') {
        formulaFailure('VERIFIER_UNSUPPORTED_FORMULA', this.formula, 'missing closing parenthesis', this.position);
      }
      this.position++;
      return value;
    }
    if (char === '-' || char === '+') {
      this.position++;
      const value = this.parseFactor();
      return char === '-' ? -value : value;
    }

    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.rest());
    if (number) {
      this.position += number[0].length;
      return Number(number[0]);
    }

    const cell = /^\$?([A-Za-z]+)\$?([0-9]+)/.exec(this.rest());
    if (cell) {
      this.position += cell[0].length;
      return this.get((cell[1]! + cell[2]!).toUpperCase());
    }

    const identifier = /^([A-Za-z_][A-Za-z0-9_.]*)/.exec(this.rest());
    if (identifier) {
      this.position += identifier[0].length;
      this.skipWhitespace();
      if (this.expression[this.position] !== '(') {
        formulaFailure('VERIFIER_UNSUPPORTED_FORMULA', this.formula, `unsupported name ${identifier[1]}`, this.position);
      }
      const functionName = identifier[1]!.toUpperCase();
      if (!SUPPORTED_FORMULA_FUNCTIONS.has(functionName)) {
        formulaFailure('VERIFIER_UNSUPPORTED_FORMULA', this.formula, `unsupported function ${functionName}`, this.position);
      }
      this.position++;
      const args = this.parseArguments();
      this.skipWhitespace();
      if (this.expression[this.position] !== ')') {
        formulaFailure('VERIFIER_UNSUPPORTED_FORMULA', this.formula, 'missing function closing parenthesis', this.position);
      }
      this.position++;
      return evaluateFunction(functionName, args, this.formula);
    }

    formulaFailure('VERIFIER_UNSUPPORTED_FORMULA', this.formula, `unsupported formula syntax near "${this.rest().slice(0, 16)}"`, this.position);
  }

  private parseArguments(): number[] {
    const values: number[] = [];
    this.skipWhitespace();
    if (this.expression[this.position] === ')') return values;
    while (true) {
      this.skipWhitespace();
      const range = /^\$?[A-Za-z]+\$?[0-9]+:\$?[A-Za-z]+\$?[0-9]+/.exec(this.rest());
      if (range) {
        this.position += range[0].length;
        for (const ref of expandGridRange(range[0])) values.push(...this.getAggregateValues(ref));
      } else {
        const singleCell = /^\$?([A-Za-z]+)\$?([0-9]+)/.exec(this.rest());
        const afterCell = singleCell
          ? this.expression.slice(this.position + singleCell[0].length).trimStart()[0]
          : undefined;
        if (singleCell && (afterCell === ',' || afterCell === ')')) {
          this.position += singleCell[0].length;
          values.push(...this.getAggregateValues((singleCell[1]! + singleCell[2]!).toUpperCase()));
        } else {
          values.push(this.parseExpression());
        }
      }
      this.skipWhitespace();
      if (this.expression[this.position] !== ',') break;
      this.position++;
    }
    return values;
  }
}

function evaluateFunction(name: string, values: number[], formula: string): number {
  switch (name) {
    case 'SUM':
      return values.reduce((sum, value) => sum + value, 0);
    case 'AVERAGE':
    case 'AVG':
      if (!values.length) formulaFailure('VERIFIER_FORMULA_EVALUATION', formula, 'AVERAGE has no numeric values');
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'MIN':
      return values.length ? Math.min(...values) : 0;
    case 'MAX':
      return values.length ? Math.max(...values) : 0;
    case 'COUNT':
      return values.length;
    default:
      formulaFailure('VERIFIER_UNSUPPORTED_FORMULA', formula, `unsupported function ${name}`);
  }
}

function numericValue(value: CellValue | undefined, ref: string): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new GridSimulationError('VERIFIER_FORMULA_VALUE', `cell ${ref} contains a non-finite number`, { ref, value });
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new GridSimulationError('VERIFIER_FORMULA_VALUE', `cell ${ref} contains non-numeric text used by a formula`, { ref, value });
}

function gridEvaluator(grid: GridShadow): (ref: string) => number {
  const cache = new Map<string, number>();
  const visiting = new Set<string>();
  const resolveCell = (ref: string): GridCell | undefined => {
    const cell = grid.get(ref);
    if (!cell && completeGridShadows.has(grid)) {
      throw new GridSimulationError(
        'VERIFIER_INSUFFICIENT_SNAPSHOT',
        `formula references ${ref}, which is outside the observed sheet snapshot`,
        { ref },
      );
    }
    return cell;
  };
  const aggregateValues = (input: string): number[] => {
    const ref = cellName(input);
    const cell = resolveCell(ref);
    if (!cell) return [];
    if (cell.formula) return [evaluate(ref)];
    if (typeof cell.value === 'number') {
      if (Number.isFinite(cell.value)) return [cell.value];
      throw new GridSimulationError('VERIFIER_FORMULA_VALUE', `cell ${ref} contains a non-finite number`, { ref, value: cell.value });
    }
    return [];
  };
  const evaluate = (input: string): number => {
    const ref = cellName(input);
    const cached = cache.get(ref);
    if (cached !== undefined) return cached;
    if (visiting.has(ref)) {
      throw new GridSimulationError('VERIFIER_FORMULA_CYCLE', `formula cycle detected at ${ref}`, { ref });
    }
    const cell = resolveCell(ref);
    if (!cell) return 0;
    visiting.add(ref);
    try {
      const value = cell.formula
        ? new FormulaParser(cell.formula, evaluate, aggregateValues).parse()
        : numericValue(cell.value, ref);
      cache.set(ref, value);
      return value;
    } finally {
      visiting.delete(ref);
    }
  };
  return evaluate;
}

function cellPreview(grid: GridShadow, ref: string, evaluate = gridEvaluator(grid)): PreviewValue {
  const cell = grid.get(ref) ?? {};
  const value = cell.formula ? evaluate(ref) : (cell.value ?? null);
  return {
    kind: 'cell',
    value,
    ...(cell.formula !== undefined ? { formula: cell.formula } : {}),
    ...(cell.style ? { style: { ...cell.style } } : {}),
  };
}

function inverseOf(op: EditOp, before: GridCell): EditOp | undefined {
  if (op.kind === 'setValue' || op.kind === 'setFormula' || op.kind === 'deleteRange') {
    if (before.formula) return { family: 'value', kind: 'setFormula', formula: before.formula };
    return { family: 'value', kind: 'setValue', value: before.value ?? null };
  }
  if (op.kind === 'setNumberFormat') {
    return { family: 'style', kind: 'setNumberFormat', pattern: before.style?.numberFormat ?? 'General' };
  }
  if (op.kind === 'setStyle') {
    const style: AbstractStyle = {};
    for (const key of Object.keys(op.style) as Array<keyof AbstractStyle>) {
      const previous = before.style?.[key];
      if (previous === undefined) return undefined;
      Object.assign(style, { [key]: previous });
    }
    return { family: 'style', kind: 'setStyle', style };
  }
  return undefined;
}

function applyOperation(grid: GridShadow, ref: string, op: EditOp): void {
  const current = cloneCell(grid.get(ref));
  switch (op.kind) {
    case 'setValue': {
      const next: GridCell = { ...current, value: op.value };
      delete next.formula;
      grid.set(ref, next);
      return;
    }
    case 'setFormula': {
      const next: GridCell = { ...current, formula: op.formula };
      delete next.value;
      grid.set(ref, next);
      return;
    }
    case 'deleteRange': {
      const next: GridCell = { ...current, value: null };
      delete next.formula;
      grid.set(ref, next);
      return;
    }
    case 'setStyle':
      grid.set(ref, { ...current, style: { ...(current.style ?? {}), ...op.style } });
      return;
    case 'setNumberFormat':
      grid.set(ref, { ...current, style: { ...(current.style ?? {}), numberFormat: op.pattern } });
      return;
    default:
      throw new GridSimulationError(
        'VERIFIER_UNSUPPORTED_OPERATION',
        `grid shadow does not simulate ${op.kind}`,
        { op: op.kind },
      );
  }
}

function leafAnchor(anchor: LogicalAnchor, ref: string): LogicalAnchor {
  if (anchor.portable.kind !== 'grid') return anchor;
  return { ...anchor, portable: { ...anchor.portable, a1: ref } };
}

interface AppliedCell {
  edit: ChangeSet['edits'][number];
  anchor: LogicalAnchor;
  ref: string;
  before: PreviewValue;
  after: PreviewValue;
}

function finalFormulaPreview(immediate: PreviewValue, final: PreviewValue): PreviewValue {
  if (immediate.kind !== 'cell' || final.kind !== 'cell') return final;
  return {
    kind: 'cell',
    value: final.value,
    ...(final.formula !== undefined ? { formula: final.formula } : {}),
    ...(immediate.style ? { style: immediate.style } : {}),
  };
}

function immediatePreview(grid: GridShadow, ref: string, op: EditOp): PreviewValue {
  if (op.kind !== 'setFormula') return cellPreview(grid, ref);
  const cell = grid.get(ref) ?? {};
  return {
    kind: 'cell',
    value: null,
    ...(cell.formula !== undefined ? { formula: cell.formula } : {}),
    ...(cell.style ? { style: { ...cell.style } } : {}),
  };
}

export class GridChangeSetEngine implements ChangeSetEngine<GridShadow> {
  validate(cs: ChangeSet, caps: CapabilitySet): ValidationReport {
    const issues: ValidationReport['issues'] = [];
    for (const edit of cs.edits) {
      const capability = caps.supports({ op: edit.op.kind });
      if (!capability.ok) {
        if ('downgrade' in capability) issues.push({ editId: edit.id, code: 'unsupported', downgrade: { family: 'value', kind: capability.downgrade } as EditOp });
        else issues.push({ editId: edit.id, code: 'unsupported' });
      }
      if (!gridEngineSupports(edit.op.kind)) issues.push({ editId: edit.id, code: 'unsupported' });
    }
    return { ok: issues.length === 0, issues };
  }

  async shadowApply(cs: ChangeSet, shadow: GridShadow): Promise<ShadowResult> {
    const grid = shadow;
    const capturedInverse: Record<EditId, EditOp> = {};
    const appliedCells: AppliedCell[] = [];
    let firstAnchor: LogicalAnchor | undefined;

    for (const edit of cs.edits) {
      assertOperationSimulatable(edit.op, edit.id);
      const anchor = cs.anchors[edit.target];
      if (!anchor || anchor.portable.kind !== 'grid') {
        throw new GridSimulationError('VERIFIER_INVALID_TARGET', `edit ${edit.id} does not target a grid anchor`, { editId: edit.id });
      }
      firstAnchor ??= anchor;
      const refs = expandGridRange(anchor.portable.a1);
      let commonInverse: EditOp | undefined;
      let inverseIsCommon = true;
      for (const ref of refs) {
        const beforeCell = cloneCell(grid.get(ref));
        const before = cellPreview(grid, ref);
        const inverse = inverseOf(edit.op, beforeCell);
        if (!commonInverse) commonInverse = inverse;
        else if (JSON.stringify(commonInverse) !== JSON.stringify(inverse)) inverseIsCommon = false;
        if (!inverse) inverseIsCommon = false;
        applyOperation(grid, ref, edit.op);
        appliedCells.push({ edit, anchor: leafAnchor(anchor, ref), ref, before, after: immediatePreview(grid, ref, edit.op) });
      }
      if (commonInverse && inverseIsCommon) capturedInverse[edit.id] = commonInverse;
    }

    const evaluateFinal = gridEvaluator(grid);
    const children: DiffNode[] = appliedCells.map(({ edit, anchor, ref, before, after }, index) => ({
      id: (`n-${edit.id}-${ref}-${index}`) as DiffNodeId,
      level: 'leaf',
      anchor,
      editIds: [edit.id],
      before,
      after: edit.op.kind === 'setFormula'
        ? finalFormulaPreview(after, cellPreview(grid, ref, evaluateFinal))
        : after,
      children: [],
      render: { badge: edit.op.kind === 'deleteRange' ? 'remove' : 'modify', label: ref },
      state: 'pending',
    }));

    const recalculated: CellValue[][] = [];
    for (const ref of [...grid.keys()].sort()) {
      const cell = grid.get(ref)!;
      if (cell.formula) recalculated.push([ref, evaluateFinal(ref)]);
    }

    const root: DiffNode = {
      id: 'root' as DiffNodeId,
      level: 'batch',
      anchor: firstAnchor ?? ({ portable: { kind: 'grid', sheet: '', a1: '' } } as LogicalAnchor),
      editIds: cs.edits.map((edit) => edit.id),
      before: { kind: 'cell', value: null },
      after: { kind: 'cell', value: null },
      children,
      render: { badge: 'modify', label: cs.meta.intent },
      state: 'pending',
    };
    const diff: DiffView = { changeSetId: cs.id, hostId: cs.hostId, root, conflicts: [] };
    return { afterRev: (Number(cs.baseRev) + 1) as DocRev, diff, capturedInverse, effects: { recalculated } };
  }

  invert(cs: ChangeSet, applied: ShadowResult): ChangeSet {
    const edits: Edit[] = [...cs.edits].reverse().map((edit) => {
      const inverse = applied.capturedInverse[edit.id];
      if (!inverse) {
        throw new GridSimulationError(
          'VERIFIER_INVERSE_UNAVAILABLE',
          `edit ${edit.id} has no exact single-operation inverse`,
          { editId: edit.id },
        );
      }
      return { id: 'inv-' + edit.id, target: edit.target, op: inverse };
    });
    return { ...cs, id: cs.id + '-inv', edits, meta: { ...cs.meta, intent: '撤销:' + cs.meta.intent } };
  }

  rebase(cs: ChangeSet, log: MutationLog, target: DocRev): { cs: ChangeSet; broken: EditId[] } {
    const structural = log.some((mutation) => /(^|[-_:])(insert|delete|remove|move|sort)[-_:]?(row|rows|column|columns|col|cols)($|[-_:])/i.test(mutation.kind));
    if (!structural) return { cs: { ...cs, baseRev: target }, broken: [] };
    return { cs: { ...cs, baseRev: target }, broken: cs.edits.map((edit) => edit.id) };
  }
}
