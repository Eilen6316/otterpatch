/**
 * SurgicalOoxmlWriteback —— 外科手术写回(首选后端)。
 * 只重写被编辑命中的部件,其余字节级原样透传。算法已用真实 .docx 实测(30/31 部件不变)。
 *
 * 分工:
 *  - 本模块负责【已验证的 repack + 完整性 verify】(格式无关);
 *  - "ChangeSet → 哪些部件、改成什么 XML" 的知识由格式适配器以 OoxmlPatchCompiler 注入
 *    (Univer 知道 setValue 落到 xl/worksheets/sheetN.xml 的哪个 cell;Word 适配器知道 run 怎么改)。
 *
 * 详见 .work/abstraction-layer.md §7。
 */
import type {
  ChangeSet,
  DocHandle,
  EditOpKind,
  FidelityReport,
  OoxmlPart,
  WritebackBackend,
  WritebackId,
  WritebackKind,
  WritebackResult,
} from '@otterpatch/core';
import { comparePartsIntegrity, repackOoxml, type OoxmlParts } from './ooxml.js';

/** 把 ChangeSet 编译成"部件 → 新字节";由格式适配器提供。 */
export type OoxmlPatchCompiler = (cs: ChangeSet, original: Uint8Array) => Promise<OoxmlParts>;

export class SurgicalOoxmlWriteback implements WritebackBackend {
  readonly id = 'surgical-ooxml' as WritebackId;
  readonly strategy: WritebackKind = 'surgical-ooxml';

  constructor(private readonly compile: OoxmlPatchCompiler) {}

  /** 跨部件大重排(插行联动公式引用/图表数据源/透视缓存)超出外科补丁 → 交路由降级。 */
  canHandle(cs: ChangeSet): { ok: boolean; reason?: string } {
    const structural = cs.edits.some((e) => e.op.family === 'structure');
    if (structural) {
      return { ok: false, reason: 'structural reflow needs model-roundtrip / libreoffice-headless' };
    }
    return { ok: true };
  }

  supports(_op: EditOpKind, _part: OoxmlPart): boolean {
    return true; // MVP 宽松;细粒度由 compiler 决定
  }

  /** 只重写目标部件、其余字节原样,重新打包,并自检完整性。 */
  async commit(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult> {
    const original = doc.bytes;
    if (!original) throw new Error('SurgicalOoxmlWriteback.commit: DocHandle.bytes required');
    const patches = await this.compile(cs, original);
    const bytes = repackOoxml(original, patches);

    const integrity = comparePartsIntegrity(original, bytes);
    const expected = new Set(Object.keys(patches));
    const drift = integrity.changed
      .filter((c) => !(c.startsWith('~') && expected.has(c.slice(1)))) // 预期内的改动不算 drift
      .map((c) => ({ part: c.slice(1), kind: 'content' as const, note: `unexpected: ${c}` }));

    const fidelity: FidelityReport = {
      score: integrity.total === 0 ? 1 : integrity.identical / integrity.total,
      drift,
    };
    return { ok: drift.length === 0, bytes, touchedParts: Object.keys(patches), fidelity };
  }

  /** 回读比对(防毁容);校验不过则事务不进入 committed。 */
  async verify(before: DocHandle, after: DocHandle, _cs: ChangeSet): Promise<FidelityReport> {
    if (!before.bytes || !after.bytes) {
      throw new Error('SurgicalOoxmlWriteback.verify: before/after bytes required');
    }
    const integrity = comparePartsIntegrity(before.bytes, after.bytes);
    return {
      score: integrity.total === 0 ? 1 : integrity.identical / integrity.total,
      drift: integrity.changed.map((c) => ({ part: c.slice(1), kind: 'content' as const, note: `changed: ${c}` })),
    };
  }
}

export { comparePartsIntegrity, readOoxmlParts, repackOoxml } from './ooxml.js';
export type { OoxmlParts, PartsIntegrity } from './ooxml.js';
