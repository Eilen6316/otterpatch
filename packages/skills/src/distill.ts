/**
 * 示范即技能:把一次"已审阅提交"(意图 + ChangeSet)蒸馏成可复用的外部技能卡。
 *
 * 这是 design.md 创新点②的闭环——做一遍 → 自动沉淀成技能,下次同类请求自动命中。
 * 蒸馏是纯函数、确定性的、零模型调用:技能的检索面(description/keywords/triggers)
 * 取自用户原话,操作面(allowed_ops + 打法)取自 ChangeSet 本身。产出的 SKILL.md 经
 * parseSkillMd 校验后才能安装——外部技能永远是不可信数据,不得进入系统提示词。
 */
import { parseSkillMd, type SkillCard } from './parse.js';

/**
 * 结构化的最小输入形态(@otterpatch/core 的 ChangeSet/Edit 天然满足,但 skills 包刻意
 * 不依赖 core——保持叶子包与依赖图不变)。
 */
export interface DistillEditOp { kind: string; [key: string]: unknown }
export interface DistillEdit { id: string; target: string; op: DistillEditOp }
export interface DistillAnchorPortable {
  kind: string;
  sheet?: string;
  a1?: string;
  quote?: { text: string };
  path?: readonly number[];
  slide?: number;
  elementId?: string;
  [key: string]: unknown;
}
export interface DistillAnchor { portable: DistillAnchorPortable }
export interface DistillChangeSet {
  edits: readonly DistillEdit[];
  anchors: Record<string, DistillAnchor>;
}

export interface DistillInput {
  /** 用户当时的原始指令(技能检索面的来源)。 */
  intent: string;
  /** 提交时的格式(excel/word/drawio…)。 */
  format: string;
  /** 已审阅并提交的 ChangeSet(技能操作面的来源)。 */
  changeSet: DistillChangeSet;
  /** 用户指定的技能标识(可选);缺省时从意图派生。 */
  name?: string;
}

export interface DistilledSkillDraft {
  name: string;
  description: string;
  formats: string[];
  keywords: string[];
  triggers: string[];
  allowedOps: string[];
  instructions: string;
}

const FORMAT_ALIASES: Readonly<Record<string, string[]>> = Object.freeze({
  excel: ['excel', 'xlsx'],
  word: ['word', 'docx'],
  drawio: ['drawio'],
  ppt: ['ppt', 'pptx'],
});

const MAX_NAME_CHARS = 64;
const MAX_INTENT_CHARS = 300;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** 标识符:ASCII 词优先;纯中文意图退化为 demo-<hash8>(标识符只作 ID,检索靠 keywords/triggers)。 */
export function slugifySkillName(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_CHARS);
  if (ascii) return ascii;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `demo-${hash.toString(16).padStart(8, '0').slice(0, 8)}`;
}

/** 检索触发器:意图按标点切段,保留 2-24 字的短语(中文按子串匹配,英文按词干)。 */
export function extractTriggers(intent: string): string[] {
  const segments = intent
    .split(/[。;；,，、!！?？\n\r\t]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 2 && segment.length <= 24);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(segment);
    if (unique.length >= 8) break;
  }
  return unique;
}

function asciiWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []);
}

/** 每条编辑的一句话明细:锚点形态 + 操作 + 载荷摘要。 */
function summarizeEdit(cs: DistillChangeSet, edit: DistillEdit): string {
  const anchor = cs.anchors[edit.target];
  const portable = anchor?.portable;
  let anchorText = '(无锚点)';
  if (portable?.kind === 'grid') anchorText = `${portable.sheet}!${portable.a1}`;
  else if (portable?.kind === 'flow') {
    const quote = portable.quote?.text ?? '';
    const paraIdx = portable.path?.[0];
    anchorText = paraIdx !== undefined
      ? `第${paraIdx + 1}段${quote ? `("${quote.slice(0, 20)}")` : ''}`
      : quote ? `"${quote.slice(0, 20)}"` : '(空锚点)';
  } else if (portable?.kind === 'object') anchorText = `${portable.slide ?? '?'}#${portable.elementId ?? '?'}`;
  const op = edit.op;
  switch (op.kind) {
    case 'setValue': return `${edit.id} [${anchorText}] setValue ${JSON.stringify((op as { value?: unknown }).value)}`;
    case 'setFormula': return `${edit.id} [${anchorText}] setFormula ${String((op as { formula?: unknown }).formula ?? '')}`;
    case 'replaceText': return `${edit.id} [${anchorText}] replaceText → "${String((op as { text?: unknown }).text ?? '').slice(0, 30)}"`;
    case 'deleteRange': return `${edit.id} [${anchorText}] deleteRange`;
    case 'setStyle': return `${edit.id} [${anchorText}] setStyle scope=${String((op as { scope?: unknown }).scope ?? '')} {${Object.keys((op as { style?: object }).style ?? {}).join(',')}}`;
    case 'setNumberFormat': return `${edit.id} [${anchorText}] setNumberFormat ${String((op as { pattern?: unknown }).pattern ?? '')}`;
    case 'insertTable': { const rows = (op as { rows?: string[][]; at?: unknown }).rows ?? []; return `${edit.id} [${anchorText}] insertTable ${rows.length}×${rows[0]?.length ?? 0} at=${String((op as { at?: unknown }).at ?? '')}`; }
    case 'setObjectProps': return `${edit.id} [${anchorText}] setObjectProps {${Object.keys((op as { props?: object }).props ?? {}).join(',')}}`;
    case 'moveObject': return `${edit.id} [${anchorText}] moveObject`;
    case 'addObject': return `${edit.id} [${anchorText}] addObject`;
    case 'deleteObject': return `${edit.id} [${anchorText}] deleteObject`;
    default: return `${edit.id} [${anchorText}] ${op.kind}`;
  }
}

function anchorKinds(cs: DistillChangeSet): string[] {
  const kinds = new Set<string>();
  for (const anchor of Object.values(cs.anchors)) kinds.add(anchor.portable.kind);
  return [...kinds];
}

export function distillSkillDraft(input: DistillInput): DistilledSkillDraft {
  const intent = input.intent.trim().slice(0, 2_000);
  if (!intent) throw new Error('distill: intent is required');
  const format = input.format.trim().toLowerCase();
  if (!format) throw new Error('distill: format is required');
  const cs = input.changeSet;
  if (!cs.edits.length) throw new Error('distill: the demonstration ChangeSet has no edits');

  const allowedOps: string[] = [];
  for (const edit of cs.edits) if (!allowedOps.includes(edit.op.kind)) allowedOps.push(edit.op.kind);

  const name = slugifySkillName(input.name?.trim() || intent);
  const kinds = anchorKinds(cs);
  const editLines = cs.edits.map((edit) => summarizeEdit(cs, edit)).join('\n');

  const instructions = [
    `# ${intent.split('\n')[0]!.slice(0, 60)}`,
    '',
    `> 由一次已审阅提交蒸馏:格式 ${format},${cs.edits.length} 条编辑,锚点形态 ${kinds.join('/') || '(none)'}。`,
    '',
    '## 何时使用',
    `用户提出与「${intent.slice(0, MAX_INTENT_CHARS)}」类似的请求时,按下面的做法提出可审阅的 ChangeSet。`,
    '',
    '## 做法',
    '1. 先定位:锚点必须唯一落地(网格用 sheet!A1;文本用唯一定位 quote 或 para 段号),重复命中必须先澄清或扩大引用。',
    `2. 操作面:${allowedOps.join(' / ')}——与本技能的 allowed_ops 一致,清单外操作不要生成。`,
    '3. 提出前自检:这组改动作为整体是否覆盖意图;各条锚点能否唯一落地;多条改动有无冲突或重复命中。',
    '4. 一次给一句话 plan,逐条编辑交用户审阅;大批量改动分批,每批都要真的产出编辑。',
    '',
    '## 演示编辑明细(参考形态,具体值按当前文档实际取)',
    editLines,
    '',
  ].join('\n');

  return {
    name,
    description: intent.slice(0, 2_000),
    formats: FORMAT_ALIASES[format] ?? [format],
    keywords: [...new Set([...asciiWords(intent).slice(0, 12)])],
    triggers: extractTriggers(intent),
    allowedOps,
    instructions,
  };
}

/** 渲染为外部 SKILL.md(namespace 固定 user;外部技能不得占用保留命名空间)。 */
export function renderSkillMd(draft: DistilledSkillDraft): string {
  const locale = CJK.test(draft.description) ? 'zh' : 'und';
  const frontmatter = [
    '---',
    `name: ${draft.name}`,
    'namespace: user',
    'version: 1.0.0',
    `locale: ${locale}`,
    `description: ${draft.description.split('\n')[0]!.slice(0, 300)}`,
    `formats: ${draft.formats.join(', ')}`,
    ...(draft.keywords.length ? [`keywords: ${draft.keywords.join(', ')}`] : []),
    ...(draft.triggers.length ? [`triggers: ${draft.triggers.join(', ')}`] : []),
    `allowed_ops: ${draft.allowedOps.join(', ')}`,
    '---',
    '',
  ];
  return `${frontmatter.join('\n')}${draft.instructions}`;
}

/** 蒸馏并直接安装进库(经 parseSkillMd 校验——非法产物会抛错,不会污染库)。 */
export function distillAndInstall(input: DistillInput, install: (md: string) => SkillCard): SkillCard {
  const draft = distillSkillDraft(input);
  const md = renderSkillMd(draft);
  return install(md);
}

export { parseSkillMd };
