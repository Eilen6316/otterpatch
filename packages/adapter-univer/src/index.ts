/**
 * UniverAdapter —— Excel 适配器(桩)。MVP 首发底座。
 *
 * 落地映射(待实现):
 *  - anchors():  Univer SelectionService 产出 {unitId, sheetId, A1} → LogicalAnchor;
 *                RefRangeService 注册区域,插行/删列自动平移 → rebase 的 'tracked' 态。
 *  - changes():  Facade getRange().setValue/setFormula;Command/Mutation 系统给 undo/redo;
 *                Node 同构 headless 实例做 shadowApply(fork 快照→应用→算 before/after)。
 *  - overlay():  在 Univer canvas 之上挂自建绝对定位 SVG 覆盖层(圈选/红笔/diff 高亮)。
 *  - writebacks(): 交给 @opal/writeback-surgical(外科补丁)。
 *
 * 详见 .work/abstraction-layer.md §5、§9(MVP 最小子集)。
 */
import type {
  AdapterRegistration,
  AnchorService,
  ChangeSetEngine,
  CapabilitySet,
  DocProjection,
  DocRev,
  HostAdapter,
  HostMeta,
  MutationLog,
  OverlayPort,
  PartRef,
  ProjectionQuery,
  ShadowDoc,
  Unsubscribe,
  WritebackBackend,
} from '@opal/core';
import { SurgicalOoxmlWriteback } from '@opal/writeback-surgical';
import { buildXlsxCompiler } from './xlsx-patch.js';

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
    return TODO('changes');
  }
  project(_q: ProjectionQuery): Promise<DocProjection> {
    return TODO('project');
  }
  writebacks(): readonly WritebackBackend[] {
    // 真实写回:外科补丁 + Excel(xlsx)的 ChangeSet→部件编译器
    return [new SurgicalOoxmlWriteback(buildXlsxCompiler())];
  }
  overlay(): OverlayPort {
    return TODO('overlay');
  }
  createShadow(_scope: PartRef): Promise<ShadowDoc> {
    return TODO('createShadow');
  }
  observeMutations(
    _scope: PartRef,
    _cb: (log: MutationLog, rev: DocRev) => void,
  ): Unsubscribe {
    return TODO('observeMutations');
  }
  rev(_scope: PartRef): DocRev {
    return TODO('rev');
  }
  onAdvance(_cb: (rev: DocRev) => void): Unsubscribe {
    return TODO('onAdvance');
  }
  dispose(): void {
    /* no-op */
  }
}

/** 注册项:把 Excel(Univer)接入 AdapterRegistry。app 启动时 registry.register(univerAdapterRegistration)。 */
export const univerAdapterRegistration: AdapterRegistration = {
  format: 'excel',
  engines: ['univer'],
  create: (hostId) => new UniverAdapter(hostId),
};

export { buildXlsxCompiler } from './xlsx-patch.js';
