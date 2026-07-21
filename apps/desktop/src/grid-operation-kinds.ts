const GRID_STRUCTURE_KINDS = new Set([
  'insertRows',
  'deleteRows',
  'insertCols',
  'deleteCols',
  'mergeCells',
  'unmergeCells',
  'freezePanes',
  'sortRange',
  'deleteRange',
  'conditionalFormat',
  'dataValidation',
  'autoFilter',
  'insertChart',
  'addSheet',
  'copyRange',
]);

export const isGridStructureKind = (kind: string): boolean => GRID_STRUCTURE_KINDS.has(kind);
