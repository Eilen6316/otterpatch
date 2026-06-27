/**
 * 技能 Skill —— SKILL.md 兼容 + 渐进披露(L0/L1/L2)。
 * requires 能力闸门 = 跨底座复用;脚本/示范一律产 ChangeSet;asMcpTools = 技能即基础设施。
 * 详见 ../../../abstraction-layer.md §4。
 */
import type { AnchorKind, DocRev, LogicalAnchor } from './anchor.js';
import type {
  AbstractStyle,
  CellValue,
  ChangeMeta,
  ChangeSet,
  EditOp,
  MarkSpec,
} from './changeset.js';
import type { CapabilityQuery, CapabilitySet, DocProjection, ProjectionQuery } from './adapter.js';

export interface SkillTrigger {
  intent?: string;
  anchorKind?: AnchorKind;
}

export interface SkillManifest {
  readonly name: string; // L0(默认进上下文)
  readonly description: string; // L0(Agent 据此匹配意图)
  readonly version: string;
  readonly requires?: CapabilityQuery[]; // 不满足者 list() 不返回
  readonly anchorKinds?: AnchorKind[];
  readonly triggers?: SkillTrigger[];
  load(): Promise<SkillBody>; // L1:命中后才拉正文 + 脚本/资源声明
}

export interface SkillBody {
  readonly instructions: string; // L1:SKILL.md 正文(Markdown)
  readonly scripts?: SkillScript[]; // L2:捆绑确定性脚本
  readonly demonstrations?: Demonstration[];
  readonly resources?: Array<{ id: string; load: () => Promise<Uint8Array> }>;
}

export interface ChangeSetBuilder {
  anchorOf(a: LogicalAnchor): string;
  setValue(a: string, v: CellValue): void;
  setFormula(a: string, f: string): void;
  setStyle(a: string, s: AbstractStyle): void;
  replaceText(a: string, t: string): void;
  setMark(a: string, m: MarkSpec, on: boolean): void;
  raw(a: string, hostId: string, payload: unknown): void; // 需 caps 放行
  build(meta: ChangeMeta): ChangeSet;
}

export interface SkillContext {
  readonly hostId: string;
  readonly anchors: readonly LogicalAnchor[]; // 用户圈选(像素已转锚点)
  readonly params: Record<string, unknown>;
  readonly caps: CapabilitySet; // 脚本据此自我降级
  readonly baseRev: DocRev;
  project(q: ProjectionQuery): Promise<DocProjection>; // 只读结构化投影
  readonly emit: ChangeSetBuilder; // 安全构造:产出即合法
}

/** 确定性脚本入口:纯函数,可沙箱、可单测。 */
export type SkillScript = (ctx: SkillContext) => Promise<ChangeSet>;

/** 示范即技能:录制已提交 ChangeSet 序列 → 锚点相对化 + 值参数化 → 可回放技能。 */
export interface ParameterizedEdit {
  anchorSlot: { fromSelection: number; transform?: string };
  opTemplate: EditOp;
}
export interface Demonstration {
  readonly recordedEdits: ParameterizedEdit[];
  synthesize(ctx: SkillContext): ChangeSet;
}
export interface SkillRecorder {
  start(hostId: string): void;
  observe(cs: ChangeSet): void;
  finish(meta: { name: string; description: string }): SkillManifest;
}

export interface SkillRegistry {
  list(caps: CapabilitySet): Promise<Array<Pick<SkillManifest, 'name' | 'description'>>>;
  load(name: string): Promise<SkillBody>;
  invoke(name: string, ctx: SkillContext): Promise<ChangeSet | { promptOnly: string }>;
  distill(rec: SkillRecorder): SkillManifest; // "示范即技能"飞轮
  asMcpTools(
    caps: CapabilitySet,
  ): Array<{ name: string; description: string; inputSchema: object }>;
}
