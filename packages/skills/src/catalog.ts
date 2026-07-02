/**
 * 内置技能目录 —— 只放【通用能力技能】(操作某格式 / 跨场景人人都要的能力)。
 * 判定:编辑该格式的用户多数都需要 → 内置;领域/模板/地区/行业特定(如学术论文模板、
 * 公司周报、投行模型)→ 不内置,由用户从外部 SKILL.md 安装(SkillLibrary.install)。
 * 安全:内置默认可信;外部技能(可能带 L2 脚本)需沙箱 + 安装前显式信任。
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
  },
  {
    name: 'docx',
    description: 'Word 文档的读取/创建/编辑:python-docx + 直接改 OOXML;样式、修订(track changes)、表格、图片。',
    formats: ['word', 'docx'],
    keywords: ['word', 'docx', '文档', '修订', '排版', 'python-docx'],
    source: ANTHROPIC,
  },
  {
    name: 'pptx',
    description: 'PowerPoint 的读取/创建/编辑:python-pptx;版式、主题、母版、形状与图表。',
    formats: ['ppt', 'pptx'],
    keywords: ['ppt', 'pptx', '幻灯片', '演示', '母版', 'python-pptx'],
    source: ANTHROPIC,
  },
  {
    name: 'pdf',
    description: 'PDF 的读取/文本抽取/表单填写/生成。',
    formats: ['pdf'],
    keywords: ['pdf', '表单', '抽取', '生成'],
    source: ANTHROPIC,
  },
  {
    name: 'drawio',
    description: 'drawio/流程图的读取与编辑:按 mxCell id 增删改节点与连线、样式与布局。',
    formats: ['drawio'],
    keywords: ['drawio', '流程图', '图', '节点', '连线', 'diagram'],
    source: 'otterpatch',
  },
];

/** 带内置目录的技能库:通用能力卡片 + 领域打法手册(playbook,带 L1 正文供 load_skill 拉取)。专用技能请 lib.install(SKILL.md 文本) 自行加载。 */
export function defaultLibrary(): SkillLibrary {
  return new SkillLibrary([...BUILTIN_SKILLS, ...PLAYBOOK_SKILLS]);
}
