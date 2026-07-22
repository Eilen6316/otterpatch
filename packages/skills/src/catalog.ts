/**
 * Built-in skill catalog — only holds general-capability skills (operating on a file format /
 * abilities everyone needs across scenarios). Criterion: if most users editing that format need
 * it → built-in; domain/template/region/industry-specific skills (e.g. academic paper templates,
 * company weekly reports, investment-banking models) → not built-in; users install them from
 * external SKILL.md files (SkillLibrary.install).
 * Security: built-ins are trusted by default; external skills (which may carry L2 scripts)
 * require sandboxing + explicit trust before installation.
 */
import type { SkillCard } from './parse.js';
import { SkillLibrary } from './library.js';
import { PLAYBOOK_SKILLS } from './playbooks.js';

const ANTHROPIC = 'anthropic/skills';

export const BUILTIN_SKILLS: SkillCard[] = [
  {
    name: 'xlsx',
    description: 'Excel 电子表格的读取/创建/编辑/分析:openpyxl、公式、图表、数据透视;保留样式与公式。',
    formats: ['excel', 'xlsx'],
    keywords: ['excel', 'xlsx', '表格', '公式', '透视', 'openpyxl', '图表'],
    source: ANTHROPIC,
    trust: 'builtin',
  },
  {
    name: 'docx',
    description: 'Word 文档的读取/创建/编辑:python-docx + 直接改 OOXML;样式、修订(track changes)、表格、图片。',
    formats: ['word', 'docx'],
    keywords: ['word', 'docx', '文档', '修订', '排版', 'python-docx'],
    source: ANTHROPIC,
    trust: 'builtin',
  },
  {
    name: 'pptx',
    description: 'PowerPoint 的读取/创建/编辑:python-pptx;版式、主题、母版、形状与图表。',
    formats: ['ppt', 'pptx'],
    keywords: ['ppt', 'pptx', '幻灯片', '演示', '母版', 'python-pptx'],
    source: ANTHROPIC,
    trust: 'builtin',
  },
  {
    name: 'pdf',
    description: 'PDF 的读取/文本抽取/表单填写/生成。',
    formats: ['pdf'],
    keywords: ['pdf', '表单', '抽取', '生成'],
    source: ANTHROPIC,
    trust: 'builtin',
  },
  {
    name: 'drawio',
    description: 'drawio/流程图的读取与编辑:按 mxCell id 增删改节点与连线、样式与布局。',
    formats: ['drawio'],
    keywords: ['drawio', '流程图', '图', '节点', '连线', 'diagram'],
    source: 'otterpatch',
    trust: 'builtin',
  },
];

/** Skill library preloaded with the built-in catalog: general-capability cards + domain playbooks (with L1 bodies fetchable via load_skill). Load specialized skills yourself via lib.install(SKILL.md text). */
export function defaultLibrary(): SkillLibrary {
  return new SkillLibrary([...BUILTIN_SKILLS, ...PLAYBOOK_SKILLS]);
}
