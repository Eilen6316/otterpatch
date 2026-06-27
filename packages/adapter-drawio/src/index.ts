/**
 * DrawioAdapter —— drawio 图形适配器(桩)。下一个格式,接入抽象层。
 *
 * 落地映射(待实现):
 *  - 左侧用 react-drawio 嵌入自托管 drawio(Apache-2.0),postMessage load/merge/export 远控;
 *  - anchors():  get-selected-cell 语义 → mxCell id 作 LogicalAnchor(portable.kind='object',
 *                slide=diagram 序号, elementId=cell id);id 跨编辑稳定。
 *  - changes():  ChangeSet 的 object 族 add/delete/setObjectProps/move → mxgraph.applyEditsToModel。
 *  - writebacks(): DrawioSurgicalWriteback(单 XML、只改目标 <diagram>)。
 *
 * 详见 .work/references.md(高星仓库调研:drawio 接入方案)。
 */
import type {
  AdapterRegistration,
  AnchorService,
  CapabilitySet,
  ChangeSetEngine,
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
} from '@office-agent/core';
import { DrawioSurgicalWriteback } from './writeback.js';

const TODO = (what: string): never => {
  throw new Error(`DrawioAdapter: ${what}() not implemented yet`);
};

export class DrawioAdapter implements HostAdapter {
  readonly hostId: string;
  readonly meta: HostMeta = { format: 'drawio', engine: 'drawio', headless: true };

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
    return [new DrawioSurgicalWriteback()];
  }
  overlay(): OverlayPort {
    return TODO('overlay');
  }
  createShadow(_scope: PartRef): Promise<ShadowDoc> {
    return TODO('createShadow');
  }
  observeMutations(_scope: PartRef, _cb: (log: MutationLog, rev: DocRev) => void): Unsubscribe {
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

/** 注册项:把 drawio 接入 AdapterRegistry。app 启动时 registry.register(drawioAdapterRegistration)。 */
export const drawioAdapterRegistration: AdapterRegistration = {
  format: 'drawio',
  engines: ['drawio'],
  create: (hostId) => new DrawioAdapter(hostId),
};

export { DrawioSurgicalWriteback } from './writeback.js';
export * from './mxgraph.js';
