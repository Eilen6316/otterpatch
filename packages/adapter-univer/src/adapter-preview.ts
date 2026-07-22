import {
  supportsFormatOperation,
  type AdapterExecutionInput,
  type AdapterPreviewEffect,
  type AdapterPreviewResult,
  type AdapterPreviewSupport,
  type CellValue,
  type ChangeSet,
} from '@otterpatch/core';
import {
  GridChangeSetEngine,
  GridSimulationError,
  expandGridRange,
  gridEngineSupports,
  type GridShadow,
} from './grid-engine.js';
import {
  gridShadowFromSnapshot,
  sheetSnapshotContains,
  sheetSnapshotHasCompleteFormulaState,
  sheetSnapshotHasStyleAt,
  type SheetSnapshot,
} from './grid-verify.js';

export function sheetSnapshotFromAdapterInput(input: AdapterExecutionInput): SheetSnapshot | undefined {
  const value = input.snapshot;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const wrapped = value as { sheet?: unknown };
  const candidate = wrapped.sheet ?? value;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const sheet = candidate as Partial<SheetSnapshot>;
  return typeof sheet.a1 === 'string' && Array.isArray(sheet.values) ? sheet as SheetSnapshot : undefined;
}

export async function buildExcelAdapterPreview(cs: ChangeSet, input: AdapterExecutionInput): Promise<AdapterPreviewResult> {
  const sheet = sheetSnapshotFromAdapterInput(input);
  const supportByEdit: Record<string, AdapterPreviewSupport> = {};
  const expectedTouchedPartsByEdit = expectedTouchedParts(cs);
  if (!sheet) {
    for (const edit of cs.edits) supportByEdit[edit.id] = 'partial';
    return {
      supportByEdit,
      expectedTouchedPartsByEdit,
      unavailableReason: 'Excel diff requires a read-only sheet snapshot.',
    };
  }

  for (const edit of cs.edits) {
    const anchor = cs.anchors[edit.target];
    const gridAnchor = anchor?.portable.kind === 'grid' ? anchor.portable : undefined;
    let refs: string[] = [];
    if (gridAnchor) {
      try {
        refs = expandGridRange(gridAnchor.a1);
      } catch {
        refs = [];
      }
    }
    const snapshotCoversTargets = Boolean(gridAnchor
      && refs.length > 0
      && refs.every((ref) => sheetSnapshotContains(sheet, ref, gridAnchor.sheet)));
    const needsStyleSnapshot = edit.op.kind === 'setStyle' || edit.op.kind === 'setNumberFormat';
    const needsFormulaSnapshot = edit.op.kind === 'setValue' || edit.op.kind === 'setFormula' || edit.op.kind === 'deleteRange';
    const snapshotCoversStyles = !needsStyleSnapshot || Boolean(gridAnchor
      && refs.every((ref) => sheetSnapshotHasStyleAt(sheet, ref, gridAnchor.sheet)));
    const snapshotCoversFormulas = !needsFormulaSnapshot || sheetSnapshotHasCompleteFormulaState(sheet);
    if (!supportsFormatOperation('excel', edit.op.kind, 'preview') || !supportsFormatOperation('excel', edit.op.kind, 'writeback')) {
      supportByEdit[edit.id] = 'unsupported';
    } else if (gridEngineSupports(edit.op.kind) && snapshotCoversTargets && snapshotCoversStyles && snapshotCoversFormulas) {
      supportByEdit[edit.id] = 'verified';
    } else {
      supportByEdit[edit.id] = 'partial';
    }
  }

  const executable = cs.edits.filter((edit) => supportByEdit[edit.id] === 'verified');
  if (!executable.length) {
    return {
      supportByEdit,
      expectedTouchedPartsByEdit,
      unavailableReason: 'The Excel simulation engine did not simulate any proposed operations.',
    };
  }

  try {
    const beforeGrid = gridShadowFromSnapshot(sheet);
    const afterGrid = gridShadowFromSnapshot(sheet);
    const engine = new GridChangeSetEngine();
    const beforeResult = await engine.shadowApply({ ...cs, edits: [] }, beforeGrid);
    const shadow = await engine.shadowApply({ ...cs, edits: executable }, afterGrid);
    const indirectEffects = formulaEffects(
      cs,
      executable.map((edit) => edit.id),
      sheet,
      beforeGrid,
      afterGrid,
      beforeResult.effects.recalculated ?? [],
      shadow.effects.recalculated ?? [],
    );
    const partialCount = Object.values(supportByEdit).filter((support) => support !== 'verified').length;
    return {
      shadow,
      supportByEdit,
      indirectEffects,
      expectedTouchedPartsByEdit,
      ...(partialCount ? { unavailableReason: `${partialCount} operation(s) were not fully simulated.` } : {}),
    };
  } catch (error) {
    for (const editId of Object.keys(supportByEdit)) {
      if (supportByEdit[editId] === 'verified') supportByEdit[editId] = 'partial';
    }
    return {
      supportByEdit,
      expectedTouchedPartsByEdit,
      unavailableReason: `Excel simulation failed: ${error instanceof GridSimulationError ? error.code + ': ' : ''}${errorMessage(error)}`,
    };
  }
}

function expectedTouchedParts(cs: ChangeSet): Record<string, readonly string[]> {
  return Object.fromEntries(cs.edits.map((edit) => {
    const anchor = cs.anchors[edit.target];
    const sheet = anchor?.portable.kind === 'grid' ? anchor.portable.sheet : 'unknown';
    const parts = [`worksheet[${sheet}]`];
    if (edit.op.kind === 'setStyle' || edit.op.kind === 'setNumberFormat') parts.push('xl/styles.xml');
    if (edit.op.kind === 'setFormula') {
      parts.push('xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml', 'xl/calcChain.xml');
    }
    return [edit.id, parts];
  }));
}

function bareGridRef(value: string): string {
  return value.replace(/^.*!/, '').replace(/\$/g, '').toUpperCase();
}

function formulaEffects(
  cs: ChangeSet,
  editIds: string[],
  sheet: SheetSnapshot,
  beforeGrid: GridShadow,
  afterGrid: GridShadow,
  beforeRows: CellValue[][],
  afterRows: CellValue[][],
): AdapterPreviewEffect[] {
  const directTargets = new Set(
    cs.edits
      .filter((edit) => editIds.includes(edit.id)
        && (edit.op.kind === 'setValue' || edit.op.kind === 'setFormula' || edit.op.kind === 'deleteRange'))
      .map((edit) => cs.anchors[edit.target])
      .filter((anchor) => anchor?.portable.kind === 'grid')
      .flatMap((anchor) => anchor?.portable.kind === 'grid' ? expandGridRange(anchor.portable.a1).map(bareGridRef) : []),
  );
  const before = recalculatedMap(beforeRows);
  const after = recalculatedMap(afterRows);
  const refs = new Set([...before.keys(), ...after.keys()]);
  const sheetName = sheet.name ?? (/^(.*?)!/.exec(sheet.a1)?.[1]?.replace(/^'|'$/g, ''));
  const effects: AdapterPreviewEffect[] = [];
  for (const ref of refs) {
    if (directTargets.has(ref)) continue;
    const beforeValue = before.get(ref);
    const afterValue = after.get(ref);
    const beforeFormula = beforeGrid.get(ref)?.formula;
    const afterFormula = afterGrid.get(ref)?.formula;
    if (Object.is(beforeValue, afterValue) && beforeFormula === afterFormula) continue;
    const target = sheetName ? `${sheetName}!${ref}` : ref;
    const effect: AdapterPreviewEffect = {
      target,
      kind: 'formula-recalculation',
      summary: `formula recalculated at ${target}`,
      editIds: [...editIds],
    };
    if (before.has(ref)) effect.before = { kind: 'cell', value: beforeValue ?? null, ...(beforeFormula ? { formula: beforeFormula } : {}) };
    if (after.has(ref)) effect.after = { kind: 'cell', value: afterValue ?? null, ...(afterFormula ? { formula: afterFormula } : {}) };
    effects.push(effect);
  }
  return effects;
}

function recalculatedMap(rows: CellValue[][]): Map<string, CellValue> {
  const result = new Map<string, CellValue>();
  for (const row of rows) {
    const ref = row[0];
    if (typeof ref !== 'string') continue;
    result.set(ref.toUpperCase(), row[1] ?? null);
  }
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
