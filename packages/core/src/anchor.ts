/**
 * SemanticAnchor —— 抽象层的"位置"货币。
 * 身份透明、寻址不透明(opaque ref)、漂移单点收敛(唯一 rebase)。
 * 详见 ../../../abstraction-layer.md §1。
 */

export type HostId = string & { readonly __brand: 'HostId' };
export type DocRev = number & { readonly __brand: 'DocRev' };
export type AnchorId = string & { readonly __brand: 'AnchorId' };

/** 寻址族:仅供能力匹配 / 技能可用性 / diff 归类。【绝不参与解析】。 */
export type AnchorKind = 'grid' | 'flow' | 'object' | 'composite';

/** 可移植兜底。核心只存不读,ref 失效或跨会话时消费。专治 Word 无稳定段落 id。 */
export type PortableLocator =
  | { kind: 'grid'; sheet: string; a1: string }
  | {
      kind: 'flow';
      path: number[];
      quote: { prefix: string; text: string; suffix: string };
      bias: 'left' | 'right';
    }
  | { kind: 'object'; slide: number; elementId: string }
  | { kind: 'composite'; parts: PortableLocator[] };

/** 纯数据、可序列化、可持久化、可跨会话。管线里流通的就是它。 */
export interface LogicalAnchor<Ref = unknown> {
  readonly id: AnchorId;
  readonly hostId: HostId; // 谁铸造 → 谁解析
  readonly kind: AnchorKind; // 粗粒度寻址族(能力匹配用,不参与解析)
  readonly ref: Ref; // 适配器私有寻址载荷(opaque)
  readonly portable: PortableLocator; // ref 失效时兜底
  readonly baseRev: DocRev; // != 当前 rev 则解析前必须 rebase
}

export type PixelRect = { x: number; y: number; w: number; h: number };
export type PixelSelection = {
  viewportRect: PixelRect;
  polygon?: Array<{ x: number; y: number }>;
  modifier?: 'add' | 'subtract';
};
/** 底座 Mutation/Step 序列,rebase 的输入。 */
export type MutationLog = unknown[];
export type Unsubscribe = () => void;

export interface ResolvedAnchor {
  readonly anchor: LogicalAnchor;
  readonly pixelRects: PixelRect[]; // 文本跨行、区域跨页 → 多段
  readonly nativeHandle: unknown; // 对核心不透明
  readonly live: boolean; // false=已 detached,UI 提示重新圈选
  readonly rev: DocRev;
}

/** 富 RebaseResult:状态对核心 legible —— 直接驱动 UI。抗漂移唯一真理来源的产物。 */
export type RebaseResult =
  | { status: 'tracked'; anchor: LogicalAnchor } // 底座自动平移,零成本,语义不变
  | { status: 'remapped'; anchor: LogicalAnchor } // 经结构路径精确重锚
  | { status: 'shifted'; anchor: LogicalAnchor; warning: string } // 平移成功但语义可能变 → 软警示
  | { status: 'fuzzy'; anchor: LogicalAnchor; confidence: number } // 指纹模糊匹配 → 需人复核
  | { status: 'detached'; reason: 'deleted' | 'rev-gap' | 'unresolvable' };

/** 锚点生命周期服务:每个适配器实现一份。核心只调这 7 个签名。 */
export interface AnchorService {
  fromPixels(sel: PixelSelection): Promise<LogicalAnchor>;
  toPixels(a: LogicalAnchor): Promise<PixelRect[]>;
  resolve(
    a: LogicalAnchor,
    atRev: DocRev,
  ): Promise<ResolvedAnchor | { status: 'detached'; reason: string }>;
  /** ★抗漂移唯一真理来源:底座红利→结构重锚→指纹模糊→detached 分层降级。 */
  rebase(a: LogicalAnchor, log: MutationLog, target: DocRev): RebaseResult;
  track(a: LogicalAnchor, onShift: (next: LogicalAnchor) => void): Unsubscribe;
  rehydrate(
    a: LogicalAnchor,
  ): Promise<LogicalAnchor | { status: 'detached'; reason: string }>;
  serialize(a: LogicalAnchor): string;
  deserialize(s: string): LogicalAnchor;
}
