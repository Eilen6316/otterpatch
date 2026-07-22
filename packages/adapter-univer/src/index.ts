/**
 * UniverAdapter — Excel adapter (stub). Foundation for the MVP launch.
 *
 * Implementation mapping (to be built):
 *  - anchors():  Univer SelectionService yields {unitId, sheetId, A1} → LogicalAnchor;
 *                register ranges with RefRangeService so row/column insert/delete auto-shifts them → the 'tracked' rebase state.
 *  - changes():  Facade getRange().setValue/setFormula; the Command/Mutation system provides undo/redo;
 *                a Node isomorphic headless instance performs shadowApply (fork snapshot → apply → compute before/after).
 *  - overlay():  mount a custom absolutely-positioned SVG overlay on top of the Univer canvas (lasso selection / red-pen / diff highlight).
 *  - writebacks(): delegated to @otterpatch/writeback-surgical (surgical patching).
 *
 * See .work/abstraction-layer.md §5 and §9 (MVP minimal subset).
 */
import type {
  AdapterRegistration,
  AnchorService,
  ChangeSetEngine,
  CapabilitySet,
  HostAdapter,
  HostMeta,
  WritebackBackend,
} from '@otterpatch/core';
import { SurgicalOoxmlWriteback } from '@otterpatch/writeback-surgical';
import { buildXlsxCompiler } from './xlsx-patch.js';
import { GridChangeSetEngine } from './grid-engine.js';

const TODO = (what: string): never => {
  throw new Error(`UniverAdapter: ${what}() not implemented yet`);
};

export class UniverAdapter implements HostAdapter {
  readonly hostId: string;
  readonly meta: HostMeta = { format: 'excel', engine: 'univer', headless: false };

  constructor(hostId: string) {
    this.hostId = hostId;
  }

  capabilities(): CapabilitySet {
    return TODO('capabilities');
  }
  anchors(): AnchorService {
    return TODO('anchors');
  }
  changes(): ChangeSetEngine {
    return new GridChangeSetEngine();
  }
  writebacks(): readonly WritebackBackend[] {
    // Real write-back: surgical OOXML patch + the xlsx ChangeSet→part compiler.
    return [new SurgicalOoxmlWriteback(buildXlsxCompiler())];
  }
  dispose(): void {
    /* no-op */
  }
  // Optional capabilities (ProjectionCapability / ShadowCapability / LiveDocCapability /
  // OverlayCapability) are intentionally NOT declared: throwing TODO stubs would advertise
  // support the adapter doesn't have. Implement the interface when the feature lands.
}

/** Registration entry: plugs Excel (Univer) into the AdapterRegistry. Call registry.register(univerAdapterRegistration) at app startup. */
export const univerAdapterRegistration: AdapterRegistration = {
  format: 'excel',
  engines: ['univer'],
  create: (hostId) => new UniverAdapter(hostId),
};

export { buildXlsxCompiler } from './xlsx-patch.js';
export {
  GridChangeSetEngine,
  GridSimulationError,
  expandGridRange,
  gridEngineSupports,
  gridShadow,
  type GridCell,
  type GridShadow,
  type GridSimulationCode,
} from './grid-engine.js';
export {
  buildGridVerifier,
  gridShadowFromSnapshot,
  sheetSnapshotContains,
  sheetSnapshotHasCompleteFormulaState,
  sheetSnapshotHasStyleAt,
  type SheetSnapshot,
} from './grid-verify.js';
