# 核心抽象层接口规格(abstraction-layer.md)

> design.md §4 的展开。格式无关抽象层 = 本产品的核心 IP,坐在异构底座(Univer/ProseMirror/OnlyOffice/PPTist…)之上。
> 由 3 套设计(锚点优先 / 事务内核优先 / 适配器能力优先)评审综合而来。Apache-2.0。
> 设计原则:① 漂移收敛到唯一 `rebase`;② 核心不解释寻址(opaque `ref`);③ 任何来源只产 `ChangeSet`;④ 能力协商是前置总闸门;⑤ 绝不裸 OOXML(唯一例外 `rawHost` 逃生舱)。

---

## 0. 统一数据流(六个接口如何拼成一条线)

```
鼠标圈选(像素)
  │ AnchorService.fromPixels()                      ← 适配器命中 + 注册抗漂移
  ▼
LogicalAnchor(可序列化逻辑位置)
  │ + 自然语言意图 → Agent / 技能(SkillScript)
  ▼
ChangeSet(锚点表寻址的结构化编辑;受 schema 约束)
  │ CapabilityNegotiator.negotiate()               ← 前置总闸门:可执行子集/降级/拒绝
  │ ChangeSetEngine.validate() → shadowApply()      ← headless 影子,绝不触 live
  ▼
DiffView(batch/block/leaf 三级树)
  │ DiffController.setDecision() 逐块接受/拒绝
  │ project() → 重 shadowApply()                    ← "所见即所提交"
  ▼
SuggestionTransaction(状态机)
  │ 若 live rev != baseRev → rebase()(Git 三路合并,复用 AnchorService.rebase)
  │ commit() 经【单写者提交队列】串行化
  ▼
WritebackRouter.commitWithFallback()               ← 逐 edit 路由:外科补丁→模型往返→LibreOffice;verify 不过则不进 committed
  ▼
真实 .xlsx/.docx(高保真)
```

---

## 1. SemanticAnchor —— 抽象层的"位置"货币

身份透明、寻址不透明、漂移单点收敛。`ref` 对核心 opaque(新增底座只换 ref 实现,核心类型零改动);像素是瞬时派生,持久化只存逻辑值。

```typescript
type HostId   = string & { readonly __brand: 'HostId' };   // 一个打开的文档实例(决定哪个适配器有权解析)
type DocRev   = number & { readonly __brand: 'DocRev' };    // 文档单调递增版本(乐观锁 / rebase 基准)
type AnchorId = string & { readonly __brand: 'AnchorId' };  // 锚点身份;diff/op/事务都只引用它

// 寻址族:仅供"能力匹配 / 技能可用性 / diff 归类"。【绝不参与解析】——解析永远回铸造它的适配器。
type AnchorKind = 'grid' | 'flow' | 'object' | 'composite';

/** LogicalAnchor:纯数据、可序列化、可持久化、可跨会话。管线里流通的就是它。 */
interface LogicalAnchor<Ref = unknown> {
  readonly id: AnchorId;
  readonly hostId: HostId;            // 谁铸造 → 谁解析
  readonly kind: AnchorKind;          // 粗粒度寻址族(能力匹配用,不参与解析)
  readonly ref: Ref;                  // 适配器私有寻址载荷(opaque):Univer rangeId / PM RelativePosition / PPTist elementId
  readonly portable: PortableLocator; // ref 失效时的可移植兜底(跨会话还原 / reanchor)
  readonly baseRev: DocRev;           // 铸造/上次确认有效时的版本;!= 当前 rev 则解析前必须 rebase
}

/** 可移植兜底。核心只存不读,失效时消费。专治 Word 无稳定段落 id。 */
type PortableLocator =
  | { kind: 'grid';   sheet: string; a1: string }                              // 'Sheet1!A1:C10'
  | { kind: 'flow';   path: number[];                                          // 结构路径(段落 index/run 偏移)
      quote: { prefix: string; text: string; suffix: string };                 // 文本指纹引用(模糊重锚兜底)
      bias: 'left' | 'right' }                                                  // 端点归属(= ProseMirror mapping assoc)
  | { kind: 'object'; slide: number; elementId: string }
  | { kind: 'composite'; parts: PortableLocator[] };

interface ResolvedAnchor {
  readonly anchor: LogicalAnchor;
  readonly pixelRects: PixelRect[];   // 覆盖层画高亮/气泡用(文本跨行、区域跨页 → 多段)
  readonly nativeHandle: unknown;     // 对核心不透明:Univer Range / PM ResolvedPos / PPTist element
  readonly live: boolean;             // false=已 detached,UI 提示重新圈选
  readonly rev: DocRev;
}
type Unsubscribe = () => void;
type PixelRect = { x: number; y: number; w: number; h: number };
type PixelSelection = { viewportRect: PixelRect; polygon?: Array<{x:number;y:number}>; modifier?: 'add'|'subtract' };
type MutationLog = unknown[];         // 底座 Mutation/Step 序列,rebase 的输入

/** 富 RebaseResult:状态对核心 legible —— 直接驱动 UI:自动跟进 / 软警示 / 转人审 / 提示重圈。 */
type RebaseResult =
  | { status: 'tracked';  anchor: LogicalAnchor }                          // 底座 RefRange/RelPos 自动平移,零成本,语义不变
  | { status: 'remapped'; anchor: LogicalAnchor }                          // 经结构路径精确重锚
  | { status: 'shifted';  anchor: LogicalAnchor; warning: string }         // 平移成功但语义可能变(区域被插行切开)→ 软警示
  | { status: 'fuzzy';    anchor: LogicalAnchor; confidence: number }      // 指纹模糊匹配 → 需人复核
  | { status: 'detached'; reason: 'deleted' | 'rev-gap' | 'unresolvable' };// 锚定目标消亡

/** 锚点生命周期服务:每个适配器实现一份。核心只调这 7 个签名,看不见任何底座坐标。 */
interface AnchorService {
  fromPixels(sel: PixelSelection): Promise<LogicalAnchor>;                  // 像素→锚点(覆盖层圈选交适配器命中+注册抗漂移)
  toPixels(a: LogicalAnchor): Promise<PixelRect[]>;                         // 锚点→像素(mutation 后实时重算 → 高亮天然跟随)
  resolve(a: LogicalAnchor, atRev: DocRev): Promise<ResolvedAnchor | { status: 'detached'; reason: string }>;
  rebase(a: LogicalAnchor, log: MutationLog, target: DocRev): RebaseResult; // ★抗漂移唯一真理来源:底座红利→结构重锚→指纹模糊→detached 分层降级
  track(a: LogicalAnchor, onShift: (next: LogicalAnchor) => void): Unsubscribe;
  rehydrate(a: LogicalAnchor): Promise<LogicalAnchor | { status: 'detached'; reason: string }>; // 跨会话:ref 失效→用 portable 重定位
  serialize(a: LogicalAnchor): string;                                      // 只存逻辑值
  deserialize(s: string): LogicalAnchor;
}
```

**为什么 opaque `ref`**:扩展性是最高约束。若核心持有 `Grid|Text|Object` 寻址联合,每加一个底座就要改核心类型。改为 `ref:unknown + kind 标签` 后,能力匹配/技能可用性仍在 `kind` 上工作,解析/rebase 永远回到铸造它的适配器。代价(核心无法独立推理 rebase)由**富 RebaseResult** + `shadowApply` parity 兜底对冲。

---

## 2. ChangeSet + EditOp —— 唯一的"编辑"货币

任何来源(Agent / 技能脚本 / 示范 / 人工)都**只产 ChangeSet**;通过 `AnchorId` 寻址 → 天然抗漂移、可 rebase、可影子、可逆。**自带锚点表**:rebase 一次迁移锚点表、N 个 op 自动跟随。

```typescript
type ChangeSetId = string; type EditId = string;

interface ChangeSet {
  readonly id: ChangeSetId;
  readonly hostId: HostId;
  readonly baseRev: DocRev;                       // 提交时若 live != baseRev 必须先 rebase
  readonly anchors: Record<AnchorId, LogicalAnchor>; // 锚点表:edits 只引用 id,序列化/rebase 一处处理
  readonly origin: ChangeOrigin;                  // 审计 + 撤销归因
  readonly meta: ChangeMeta;                      // 自然语言意图/计划摘要/风险(给"先报计划")
  readonly edits: Edit[];
}
type ChangeOrigin = { by: 'human' } | { by: 'agent'; sessionId: string } | { by: 'skill'; skill: string; version: string } | { by: 'demonstration'; ref: string };
interface ChangeMeta { intent: string; planSummary?: string; risk?: 'low'|'medium'|'high'; }

interface Edit {
  readonly id: EditId;
  readonly target: AnchorId;       // 所有编辑都经锚点寻址
  readonly op: EditOp;
  readonly inverse?: EditOp;        // 逆操作:Agent 预填,或 shadowApply 时由底座读改前值自动捕获 → 支撑逐块撤销
}

/**
 * EditOp:family/kind 双层判别联合。
 *  family(粗、稳定)= 能力协商 + diff 归类的单位;kind(细)= 真实底座 API 绑定。
 *  【格式无关核心】三底座共有语义;【按格式扩展】需能力协商;rawHost = 逃生舱(守住"绝不裸 OOXML")。
 */
type OpFamily = 'value' | 'text' | 'style' | 'structure' | 'object' | 'raw';
type EditOp =
  // ── 格式无关核心 ──
  | { family: 'value';  kind: 'setValue';    value: CellValue | string }
  | { family: 'text';   kind: 'replaceText'; text: string }
  | { family: 'text';   kind: 'insertText';  text: string; at: 'start'|'end' }
  | { family: 'value';  kind: 'deleteRange' }
  | { family: 'style';  kind: 'setStyle';    style: AbstractStyle }       // 抽象样式,适配器各自翻译
  // ── Excel(grid)扩展 ──
  | { family: 'value';     kind: 'setFormula';      formula: string }     // OnlyOffice 不支持 → 协商降级为 setValue(算好的常量)
  | { family: 'style';     kind: 'setNumberFormat'; pattern: string }
  | { family: 'structure'; kind: 'insertRows';      count: number; before: boolean } // RefRange 漂移测试必需触发器
  | { family: 'structure'; kind: 'deleteRows' }
  | { family: 'structure'; kind: 'sortRange';       by: number; asc: boolean }
  // ── Word(flow)扩展 ──
  | { family: 'style'; kind: 'setMark';           mark: MarkSpec }        // bold/italic/comment/highlight
  | { family: 'style'; kind: 'setParagraphStyle'; styleName: string }
  // ── PPT(object)扩展(后续)──
  | { family: 'object'; kind: 'moveObject';    box: Partial<BoxRect> }
  | { family: 'object'; kind: 'setObjectProps'; props: Record<string, unknown> }
  // ── 逃生舱:能力受限/一次性场景,携带某底座原生 op,必须 CapabilitySet 显式放行 + 强制随附 inverse ──
  | { family: 'raw'; kind: 'rawHost'; hostId: HostId; payload: unknown };

type EditOpKind = EditOp['kind'];
interface AbstractStyle { bold?: boolean; italic?: boolean; color?: string; bgColor?: string; align?: 'left'|'center'|'right'; numberFormat?: string;
  conditional?: { rule: string; format: AbstractStyle }; }  // 条件格式等高层意图,适配器决定原生 or 降级模拟
interface MarkSpec { type: 'bold'|'italic'|'comment'|'highlight'; value?: unknown; }
interface BoxRect { left: number; top: number; width: number; height: number; rotate: number; }
type CellValue = string | number | boolean | null;

/** ChangeSetEngine:每个适配器实现 —— 校验/影子/反演/rebase。不直接碰 live 文档。 */
interface ChangeSetEngine {
  validate(cs: ChangeSet, caps: CapabilitySet): ValidationReport;          // schema + 能力 + 业务三重校验
  shadowApply(cs: ChangeSet, shadow: ShadowDoc): Promise<ShadowResult>;    // headless 同构(Univer Node / PM 内存)apply + 捕获 inverse + 算 before/after
  invert(cs: ChangeSet, applied: ShadowResult): ChangeSet;                 // 整批反向
  rebase(cs: ChangeSet, log: MutationLog, target: DocRev): { cs: ChangeSet; broken: EditId[] }; // 逐个迁移锚点表,复用 AnchorService.rebase
}
interface ValidationReport { ok: boolean; issues: Array<{ editId: EditId; code: 'schema'|'unsupported'|'anchor-broken'; downgrade?: EditOp }>; }
interface ShadowResult { afterRev: DocRev; diff: DiffView; capturedInverse: Record<EditId, EditOp>; effects: EffectPreview; }
interface EffectPreview { recalculated?: CellValue[][]; reflowed?: boolean; } // 公式重算/重排预览
type ShadowDoc = unknown;
```

---

## 3. Diff —— 三级粒度可审阅结构(batch / block / leaf)

`shadowApply` 产出一棵 `DiffNode` 树;每节点可独立接受/拒绝/回滚;接受子集 **`project()` 成新的部分 ChangeSet 再走 validate→提交**(所见即所提交)。渲染提示喂给**自建覆盖层**,像素盒恒由 `anchor.toPixels()` 给 → diff 高亮随 mutation 自动跟随不漂移。

```typescript
type DiffLevel = 'batch' | 'block' | 'leaf';
type DiffDecision = 'pending' | 'accepted' | 'rejected';
type DiffNodeId = string & { readonly __brand: 'DiffNodeId' };

interface DiffView { readonly changeSetId: ChangeSetId; readonly hostId: HostId; readonly root: DiffNode; readonly conflicts: readonly MergeConflict[]; }

interface DiffNode {
  readonly id: DiffNodeId;
  readonly level: DiffLevel;            // batch=整集 / block=一段·一表区·一页 / leaf=单格·单 inline range·单对象
  readonly anchor: LogicalAnchor;       // 覆盖层定位高亮 = toPixels(anchor)
  readonly editIds: readonly EditId[];  // 关联的 edits(project 时据此挑选)
  readonly before: PreviewValue;
  readonly after: PreviewValue;         // 含公式重算/重排结果
  readonly children: readonly DiffNode[];
  readonly render: DiffRenderHint;
  state: DiffDecision;                  // 可变:用户逐块决策
}
type PreviewValue =
  | { kind: 'cell'; value: CellValue; formula?: string }
  | { kind: 'text'; runs: Array<{ text: string; marks?: MarkSpec[] }> }
  | { kind: 'object'; box: BoxRect; props?: Record<string, unknown> };
interface DiffRenderHint {
  badge: 'add'|'remove'|'modify'|'move'|'conflict'; color?: string; label?: string; // 例:"=SUM 公式" / "改为粗体"
  inlineSpans?: Array<{ from: number; to: number; op: 'ins'|'del' }>;                // flow 文本字符级
}

interface DiffController {
  view(): DiffView;
  setDecision(node: DiffNodeId, d: DiffDecision): void; // 向上/下传播:父 reject→子全 reject;子全 accept→父 accept
  acceptAll(): void; rejectAll(): void;
  project(): ChangeSet;                                 // 取已接受叶子的 edits 重组(再走 validate→shadowApply)
  rollback(node: DiffNodeId): Promise<void>;            // 已提交后单块撤销:用对应 inverse 局部回滚
}
```

---

## 4. 技能 Skill —— SKILL.md 兼容 + 渐进披露(L0/L1/L2)

`requires` 能力闸门 = 跨底座复用;脚本/示范一律产 ChangeSet;`asMcpTools` = 技能即基础设施。

```typescript
interface SkillManifest {
  readonly name: string;                   // L0(默认进上下文)
  readonly description: string;            // L0(Agent 据此匹配意图)
  readonly version: string;
  readonly requires?: CapabilityQuery[];   // 不满足者 list() 不返回(渐进披露 × 能力协商)
  readonly anchorKinds?: AnchorKind[];
  readonly triggers?: Array<{ intent?: string; anchorKind?: AnchorKind }>;
  load(): Promise<SkillBody>;              // L1:命中后才拉正文 + 脚本/资源声明
}
interface SkillBody {
  readonly instructions: string;           // L1:SKILL.md 正文(Markdown)
  readonly scripts?: SkillScript[];        // L2:捆绑确定性脚本
  readonly demonstrations?: Demonstration[];
  readonly resources?: Array<{ id: string; load: () => Promise<Uint8Array> }>;
}
interface SkillContext {
  readonly hostId: HostId;
  readonly anchors: readonly LogicalAnchor[];  // 用户圈选(像素已转锚点)
  readonly params: Record<string, unknown>;
  readonly caps: CapabilitySet;                // 脚本据此自我降级(不支持公式→产静态值)
  readonly baseRev: DocRev;
  project(q: ProjectionQuery): Promise<DocProjection>; // 只读结构化投影,绝不暴露底座原生对象
  readonly emit: ChangeSetBuilder;             // 安全构造:自动绑 baseRev/schema/锚点 → 产出即合法
}
type SkillScript = (ctx: SkillContext) => Promise<ChangeSet>;   // 纯函数,可沙箱、可单测

interface ChangeSetBuilder {
  anchorOf(a: LogicalAnchor): AnchorId;
  setValue(a: AnchorId, v: CellValue): void; setFormula(a: AnchorId, f: string): void;
  setStyle(a: AnchorId, s: AbstractStyle): void; replaceText(a: AnchorId, t: string): void;
  setMark(a: AnchorId, m: MarkSpec, on: boolean): void;
  raw(a: AnchorId, hostId: HostId, payload: unknown): void;     // 需 caps 放行
  build(meta: ChangeMeta): ChangeSet;
}

/** 示范即技能:录制已提交 ChangeSet 序列 → 锚点相对化 + 值参数化 → 可回放技能。 */
interface Demonstration { readonly recordedEdits: ParameterizedEdit[]; synthesize(ctx: SkillContext): ChangeSet; }
interface ParameterizedEdit { anchorSlot: { fromSelection: number; transform?: string }; opTemplate: EditOp; } // 字面量可含 ${slot}
interface SkillRecorder { start(hostId: HostId): void; observe(cs: ChangeSet): void; finish(meta: { name: string; description: string }): SkillManifest; }

interface SkillRegistry {
  list(caps: CapabilitySet): Promise<Array<Pick<SkillManifest, 'name'|'description'>>>; // 渐进披露 L0 + 能力过滤
  load(name: string): Promise<SkillBody>;
  invoke(name: string, ctx: SkillContext): Promise<ChangeSet | { promptOnly: string }>;
  distill(rec: SkillRecorder): SkillManifest;                                           // "示范即技能"飞轮
  asMcpTools(caps: CapabilitySet): Array<{ name: string; description: string; inputSchema: object }>; // 技能即基础设施
}
```

---

## 5. 适配器契约 + 能力协商 —— 唯一"窄腰"

新增底座/格式 = 只实现一个 `HostAdapter`。**能力协商前置到 list()/validate(总闸门)**,Agent 必须能力驱动地决定"产哪些 op"。

```typescript
interface HostAdapter {
  readonly hostId: HostId; readonly meta: HostMeta;
  capabilities(): CapabilitySet;                       // ① 能力清单
  anchors(): AnchorService;                            // ② 位置服务
  changes(): ChangeSetEngine;                          // ③ 编辑引擎
  project(q: ProjectionQuery): Promise<DocProjection>; // ④ 只读投影(绝不泄底座原生对象)
  writebacks(): readonly WritebackBackend[];           // ⑤ 写回保真后端
  overlay(): OverlayPort;                              // ⑥ 自建 markup 覆盖层挂载口
  createShadow(scope: PartRef): Promise<ShadowDoc>;    // headless 影子:Univer=Node 同构;OnlyOffice 免费受限→回退 PM/LibreOffice
  observeMutations(scope: PartRef, cb: (log: MutationLog, rev: DocRev) => void): Unsubscribe; // mutation 流喂 rebase
  rev(scope: PartRef): DocRev; onAdvance(cb: (rev: DocRev) => void): Unsubscribe; dispose(): void;
}
interface HostMeta { format: 'excel'|'word'|'ppt'|'csv'|'db'|(string&{}); engine: 'univer'|'onlyoffice'|'prosemirror'|'pptist'|(string&{}); headless: boolean; }
interface PartRef { hostId: HostId; sub?: string; }  // sheet / slide;Word 恒单文档流
type ProjectionQuery = unknown; type DocProjection = unknown;
interface OverlayPort { mount(d: unknown): { dispose(): void }; }

interface CapabilitySet {
  readonly anchorKinds: readonly AnchorKind[];
  readonly diffGranularity: readonly DiffLevel[];      // Univer:leaf;OnlyOffice 免费:可能止于 block
  readonly ops: Readonly<Record<EditOpKind, OpCapability>>;
  readonly features: {
    shadowApply: boolean;       // Univer headless:true;OnlyOffice 免费:false
    nativeUndo: boolean;        // Univer/PM:true;OnlyOffice:false(靠快照逆)
    antiDrift: 'auto'|'reanchor'|'none'; // Univer RefRange/PM RelPos=auto;OnlyOffice=reanchor
    formulaRecalc: boolean; headless: boolean;
  };
  supports(q: CapabilityQuery): CapabilityVerdict;     // 协商入口
}
interface OpCapability { level: 'native'|'downgrade'|'unsupported'; downgradeTo?: EditOpKind; limits?: { maxCells?: number; maxTextLen?: number; maxBatchEdits?: number }; }
type CapabilityQuery = { op: EditOpKind } | { feature: keyof CapabilitySet['features'] } | { anchorKind: AnchorKind };
type CapabilityVerdict = { ok: true } | { ok: false; downgrade: EditOpKind; reason: string } | { ok: false; reason: string };

/** 能力协商器:validate 阶段把抽象 ChangeSet 投影到目标底座,产可执行子集 + 降级 + 拒绝。 */
interface CapabilityNegotiator {
  negotiate(cs: ChangeSet, caps: CapabilitySet): {
    runnable: ChangeSet;
    downgraded: Array<{ editId: EditId; from: EditOpKind; to: EditOpKind; reason: string }>;
    rejected: Array<{ editId: EditId; reason: string }>;
  };
}
```

---

## 6. 并发内核 —— SuggestionTransaction 状态机 + Git 三路 rebase + 单写者提交队列

人↔Agent 协作是产品核心价值,"过期 base / 建议间 rebase / 冲突人审"需要 Git 级严谨语义;并发模块**直接复用统一的 `AnchorService.rebase`**,自身几乎不持状态。

```typescript
type TxId = string & { readonly __brand: 'TxId' };

interface SuggestionTransaction {
  readonly id: TxId; readonly state: TxState;
  readonly changeSet: ChangeSet;                    // rebase 后被迁移版替换
  readonly baseRev: DocRev;
  readonly shadow?: ShadowResult; readonly diff?: DiffView;
  readonly decisions: ReadonlyMap<DiffNodeId, DiffDecision>;
  readonly origin: ChangeOrigin;
  readonly dependsOn?: readonly TxId[];             // 建议间依赖(B 锚定区依赖 A)
  readonly history: readonly { at: number; kind: string; detail?: unknown }[]; // 审计 + 可回放
}
type TxState =
  | 'draft'             // Agent 报计划阶段,未影子
  | 'proposed'          // 已 shadowApply + diff 就绪,待审
  | 'partiallyAccepted' | 'staged' // 投影子集已在当前 rev 重校验通过,待提交
  | 'committing' | 'committed' | 'rejected' | 'rolledBack'
  | 'stale'             // base 落后,需 rebase
  | 'rebasing' | 'conflicted' | 'abandoned';

interface TransactionManager {
  begin(origin: ChangeOrigin, baseRev: DocRev): SuggestionTransaction;
  appendOps(tx: TxId, edits: Edit[]): SuggestionTransaction;
  propose(tx: TxId): Promise<SuggestionTransaction>;           // → proposed:shadowApply + diff
  decide(tx: TxId, node: DiffNodeId, d: 'accepted'|'rejected'): SuggestionTransaction;
  stage(tx: TxId): Promise<SuggestionTransaction>;             // → staged:project + 当前 rev 重校验/重影子
  commit(tx: TxId): Promise<{ rev: DocRev }>;                  // 经单写者队列串行化,推进 rev
  reject(tx: TxId): SuggestionTransaction; rollback(tx: TxId): Promise<SuggestionTransaction>;
  onDocumentAdvanced(from: DocRev, to: DocRev, incoming: MutationLog): TxId[]; // 主动标受影响事务 stale
  rebase(tx: TxId, onto: DocRev, incoming: MutationLog): RebaseOutcome;        // 核心并发原语(三路合并作用在结构化 op 上)
  rebaseOnto(txB: TxId, txA: TxId): RebaseOutcome;            // 建议间:把 txA apply 结果当 mutation 再 rebase txB
  merge(a: TxId, b: TxId): MergePlan;
}
type RebaseOutcome = { ok: true; tx: SuggestionTransaction } | { ok: false; tx: SuggestionTransaction; conflicts: MergeConflict[] };
interface MergeConflict { anchor: AnchorId; reason: 'detached'|'overlap'; base?: PreviewValue; ours?: PreviewValue; theirs?: PreviewValue; resolution?: 'ours'|'theirs'|'manual'; otherTxn?: TxId; }
interface MergePlan { overlaps: Array<{ node: DiffNodeId; choices: ('ours'|'theirs'|'both'|'none')[] }>; }
```

**rebase(R0→R1) 算法**(incoming=已落地"ours",本事务="theirs"):① 迁移锚点表(`AnchorService.rebase`,tracked/remapped 平移、shifted 软警示、fuzzy 待复核、detached 丢弃并审计);② 用迁移后锚点重写 op(公式随 RefRange 自动改引用);③ 三路合并检测(同一 leaf 两边都改且不等 → `MergeConflict`,不相交 → 自动通过);④ 重 shadowApply → 新 diff;⑤ 旧 decisions 按 (anchorId+editId) 迁移;⑥ 无冲突回 proposed,有冲突进 conflicted 待人审。
**提交串行化**:每个部件一个单写者队列。commit 拿锁→apply→rev+1→广播 `onDocumentAdvanced`→其余挂起事务 stale→自动尝试 rebase。

---

## 7. 写回保真 —— 可插拔后端 + 逐 edit 路由 + 自动降级 + verify

```typescript
type WritebackId = string & { readonly __brand: 'WritebackId' };
type WritebackKind = 'surgical-ooxml' | 'model-roundtrip' | 'libreoffice-headless' | 'native-command';
interface OoxmlPart { path: string; xpath?: string; }  // xl/worksheets/sheet1.xml、word/document.xml、ppt/slides/slideN.xml

interface WritebackBackend {
  readonly id: WritebackId; readonly strategy: WritebackKind;
  canHandle(cs: ChangeSet): { ok: boolean; reason?: string };          // surgical 对跨部件大重排返回 no → 触发降级
  supports(op: EditOpKind, part: OoxmlPart): boolean;                  // 声明能精确改写哪些"部件×op"
  commit(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult>;     // surgical 只重写目标部件 XML、余字节原样
  verify(before: DocHandle, after: DocHandle, cs: ChangeSet): Promise<FidelityReport>; // 回读重算比对,防毁容
}
interface WritebackRouter {
  route(cs: ChangeSet, backends: readonly WritebackBackend[]): Array<{ editIds: EditId[]; backend: WritebackBackend }>; // 逐 edit 按 op×part 选最优
  commitWithFallback(cs: ChangeSet, doc: DocHandle): Promise<WritebackResult>; // route→commit;verify 不达标→自动降级下一后端;校验不过则 tx 不进 committed
}
interface DocHandle { readonly hostId: HostId; readonly bytes?: Uint8Array; readonly rev: DocRev; }
interface WritebackResult { ok: boolean; bytes: Uint8Array; touchedParts: string[]; fidelity: FidelityReport; fallbackUsed?: WritebackKind; }
interface FidelityReport { score: number; drift: Array<{ part: string; kind: 'style'|'layout'|'content'|'formula'; note: string }>; }
```

`verify` 与并发状态机的 `committing→committed` 对齐:**校验不过则事务不进入 committed**。

---

## 8. 关键取舍(为什么这样)

1. **Anchor 用 opaque `ref`** 而非把寻址联合暴露给核心 → 扩展性最高;代价由富 RebaseResult + shadowApply parity 对冲。
2. **ChangeSet 自带锚点表** 而非 op 内联锚点 → rebase 一次迁移、N op 跟随;序列化集中一处。
3. **并发整体采事务内核**(完整状态机 + Git 三路合并 + 单写者队列)→ 人↔Agent 协作需 Git 级严谨;且复用统一 rebase,无并发特例。
4. **能力协商是前置总闸门** → Agent 能力驱动地决定"产哪些 op",而非事后降级,省 token、语义可控。
5. **family/kind 双层算子** → family 做能力协商/diff 归类(粗稳),kind 做 API 绑定(细);守住"格式无关核心 vs 按格式扩展"分界 + rawHost 逃生舱(绝不裸 OOXML)。
6. **脚本/示范一律产 ChangeSet** → 可靠性是生死线,任何来源同走 validate→shadowApply→可审阅 diff→可逆→rebase 管线。

---

## 9. Excel(Univer)+ Word 第一版最小实现子集

- **Anchor**:只 `kind ∈ {grid, flow}`。Grid 走 Univer RefRangeService(`antiDrift:'auto'`);Flow 主路 ProseMirror RelativePosition(`antiDrift:'auto'`),`portable.flow.quote` 指纹兜底。`object/composite`、PPT、`rehydrate`、`fuzzy/remapped` 推 v2;RebaseResult 先落 `tracked/shifted/detached`。
- **EditOp 子集**:核心 `setValue/replaceText/insertText/deleteRange/setStyle` + grid `setFormula/insertRows/deleteRows`(后两者是漂移测试必需触发器)+ flow `setMark`(bold/comment)。其余推迟或仅 `unsupported` 占位。
- **Engine**:`validate + shadowApply(Univer Node 同构 + PM 内存)+ invert + rebase + apply`。
- **Diff**:全三级 + setDecision 传播 + project(含重 shadowApply)+ rollback;hint 只 `cell` + `inline-text`。
- **Skill**:Manifest L0 + load L1 + `SkillScript→ChangeSet` + ChangeSetBuilder + requires 过滤。Demonstration/Recorder/distill/asMcpTools 推 v2。
- **Adapter**:UniverAdapter + WordAdapter。**关键决策(已与 Apache-2.0 选型对齐):ProseMirror 同时做编辑器 + 影子(内存 EditorState)+ 抗漂移(RelativePosition)——三者 PM 原生具备;LibreOffice headless(子进程)做 .docx 高保真导入/渲染/写回 + 外科 OOXML 补丁。不用 AGPL 的 OnlyOffice。**
- **Concurrency(不可砍)**:状态机 `draft/proposed/partiallyAccepted/staged/committed/rejected/stale/rebasing/conflicted` + 单写者队列 + onDocumentAdvanced + rebase + 三路合并 + merge 人审。`rebaseOnto`(建议间)推 v2。**不可降级为"最后写赢"**。
- **Writeback**:surgical-ooxml(单格改值/样式、run 文本/mark)+ model-roundtrip 兜底 + libreoffice verify;v1 整集 pick+fallback,逐 edit route 推 v2。

---

## 10. 待杀手实验定死的接口空白

- `EditOp` 完整 kind 枚举(尤其 structural 类与按格式扩展)→ 由**实验二 DSL 清单**定死。
- `OpFamily` 意图族最终划分(能力协商 + diff 归类粒度)。
- `CapabilitySet.ops` 矩阵的降级路径(`downgradeTo`)与 `limits` → 取决于哪些算子在 DSL 存活。
- `AbstractStyle.conditional` 等高层意图是否进核心 DSL,还是统一逐格 setStyle 降级模拟。
- Writeback 必须强制走 model-roundtrip/LibreOffice 的算子边界(插行重排联动 sheet XML+公式引用+图表数据源+透视缓存)→ 由**实验一"特性×策略×存活"表**反向确定。
- `rawHost` 逃生舱白名单及沙箱边界;`DocRev` 选单调时钟 vs 向量钟;`RebaseResult.fuzzy` 置信度阈值;`ChangeSetBuilder` 暴露的 op 构造方法集合。

---

## 11. 主要风险

1. **Word 双表示一致性**:ProseMirror 文档模型(编辑/影子/抗漂移)与 .docx OOXML(LibreOffice 渲染 + 外科补丁写回)是两套表示,其映射(PM 节点 ↔ OOXML run/段落)的保真一致性是最大落地风险,需 parity 测试集标定。(注:选 ProseMirror 后,工作流原先担心的"OnlyOffice 无 headless / 无 RelativePosition"硬伤**已消除**——PM 两者原生具备。)
2. **opaque ref 让核心无法独立校验 rebase** → 某适配器 rebase 有 bug 时核心无从发现,只能靠 RebaseResult 状态 + shadowApply parity 兜底。
3. **锚点表 + 每次 rebase 起同构实例的成本** → 大文件/高频产出下 shadowApply/rebase 是性能瓶颈,需基准对比"RefRange 离线平移 vs Node 同构重放"。
4. **三路合并在 Word 相邻重叠 run 上的冲突粒度** → leaf 级可能过度报/漏报,或需字符级 OT。
5. **能力降级的语义保真** → setFormula→setValue 丢公式活性、条件格式→逐格 setStyle 丢规则可维护性;默认降级 vs 强制人审需按 op 风险分级。
6. **覆盖层 toPixels 高频重算** → 滚动/缩放/重排下大文件性能,需像素缓存 + observeMutations 失效订阅。
7. **示范即技能的锚点泛化在流式文本歧义易过拟合**;**跨部件/跨文档原子提交需两阶段提交,MVP 不覆盖**;**rawHost 破坏不变量,需强制 inverse 且禁止参与 rebase/跨底座技能**。
