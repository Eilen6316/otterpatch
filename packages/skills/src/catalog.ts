/**
 * Built-in skill catalog — only holds general-capability skills (operating on a file format /
 * abilities everyone needs across scenarios). Criterion: if most users editing that format need
 * it → built-in; domain/template/region/industry-specific skills (e.g. academic paper templates,
 * company weekly reports, investment-banking models) → not built-in; users install them from
 * external SKILL.md files (SkillLibrary.install).
 * Security: built-ins are trusted by default; external skills (which may carry L2 scripts)
 * require sandboxing + explicit trust before installation.
 */
import { defineBuiltinSkill, type SkillCard } from './parse.js';
import { SkillLibrary } from './library.js';
import { PLAYBOOK_SKILLS } from './playbooks.js';

const ANTHROPIC = 'anthropic/skills';

const PPTX_CAPABILITY_SKILL = defineBuiltinSkill({
  name: 'pptx',
  description: 'PowerPoint 冻结能力:仅替换页内唯一且位于单个文本 run 的原文。',
  formats: ['ppt', 'pptx'],
  keywords: ['ppt', 'pptx', '幻灯片', '演示', '母版', 'python-pptx'],
  triggers: ['powerpoint', 'presentation'],
  allowedOps: ['replaceText'],
  locale: 'und',
  source: ANTHROPIC,
});

export const BUILTIN_SKILLS: readonly SkillCard[] = Object.freeze([
  defineBuiltinSkill({
    name: 'xlsx',
    description: 'Excel 电子表格分析与受约束编辑:读取快照,写入值、公式、基础样式和数字格式,或清空内容。',
    formats: ['excel', 'xlsx'],
    keywords: ['excel', 'xlsx', '表格', '公式', '透视', 'openpyxl', '图表'],
    triggers: ['电子表格', 'spreadsheet'],
    allowedOps: ['setValue', 'setFormula', 'setStyle', 'setNumberFormat', 'deleteRange'],
    locale: 'und',
    source: ANTHROPIC,
  }),
  defineBuiltinSkill({
    name: 'docx',
    description: 'Word 文档受约束编辑:文字修订、局部格式、页面设置、文末表格及段内图片操作。',
    formats: ['word', 'docx'],
    keywords: ['word', 'docx', '文档', '修订', '排版', 'python-docx'],
    triggers: ['文字处理', 'word document'],
    allowedOps: ['replaceText', 'setStyle', 'deleteRange', 'setObjectProps', 'insertTable'],
    locale: 'und',
    source: ANTHROPIC,
  }),
  defineBuiltinSkill({
    name: 'drawio',
    description: 'drawio/流程图的读取与编辑:按 mxCell id 增删改节点与连线、样式与布局。',
    formats: ['drawio'],
    keywords: ['drawio', '流程图', '图', '节点', '连线', 'diagram'],
    triggers: ['mxgraph', 'diagram'],
    allowedOps: ['setValue', 'setObjectProps', 'moveObject', 'addObject', 'deleteObject'],
    locale: 'und',
    source: 'otterpatch',
  }),
]);

const isPptxSkill = (skill: SkillCard): boolean => skill.formats.some((format) => format === 'ppt' || format === 'pptx');
const DEFAULT_PLAYBOOK_SKILLS: readonly SkillCard[] = Object.freeze(PLAYBOOK_SKILLS.filter((skill) => !isPptxSkill(skill)));

/** Frozen PowerPoint metadata retained for hosts that explicitly register the PPTX adapter. */
export const PPTX_OPT_IN_SKILLS: readonly SkillCard[] = Object.freeze([
  PPTX_CAPABILITY_SKILL,
  ...PLAYBOOK_SKILLS.filter(isPptxSkill),
]);

/** Skill library preloaded with the built-in catalog: general-capability cards + domain playbooks (with L1 bodies fetchable via load_skill). Load specialized skills yourself via lib.install(SKILL.md text). */
export function defaultLibrary(): SkillLibrary {
  return new SkillLibrary([...BUILTIN_SKILLS, ...DEFAULT_PLAYBOOK_SKILLS]);
}
