/**
 * SurgicalOoxmlWriteback —— 外科手术写回(首选后端)。
 *
 * 核心算法(已用真实 .docx 实测验证,见 experiments/exp1_surgical_test.py):
 *   把 .xlsx/.docx 当 zip,只重写被编辑命中的部件(如 word/document.xml、
 *   xl/worksheets/sheetN.xml),其余部件【字节级原样透传】,重新打包。
 *   实测:30/31 部件字节级不变(只改目标部件);模型往返却重写 11/31。
 *
 * 待实现:用 zip 库(建议 fflate,MIT,无 node 依赖)解包→改目标部件→重打包;
 *   canHandle() 对"跨部件大重排(插行联动公式引用/图表数据源/透视缓存)"返回 no → 由
 *   WritebackRouter 自动降级到 model-roundtrip / libreoffice-headless。
 *
 * 详见 ../../../abstraction-layer.md §7。
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
} from '@office-agent/core';

const TODO = (what: string): never => {
  throw new Error(`SurgicalOoxmlWriteback: ${what} not implemented yet`);
};

export class SurgicalOoxmlWriteback implements WritebackBackend {
  readonly id = 'surgical-ooxml' as WritebackId;
  readonly strategy: WritebackKind = 'surgical-ooxml';

  /** 跨部件大重排(插行联动公式/图表/透视)→ 返回 no,触发路由降级。 */
  canHandle(_cs: ChangeSet): { ok: boolean; reason?: string } {
    return TODO('canHandle');
  }

  supports(_op: EditOpKind, _part: OoxmlPart): boolean {
    return TODO('supports');
  }

  /** 只重写目标部件 XML、其余字节原样,重新打包。 */
  commit(_cs: ChangeSet, _doc: DocHandle): Promise<WritebackResult> {
    return TODO('commit');
  }

  /** 回读重算比对(公式/版式),防毁容;不达标则 tx 不进 committed。 */
  verify(_before: DocHandle, _after: DocHandle, _cs: ChangeSet): Promise<FidelityReport> {
    return TODO('verify');
  }
}
