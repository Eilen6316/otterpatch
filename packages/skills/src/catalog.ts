/**
 * 内置技能目录。Anthropic Agent Skills(读改/生成 Office)+ 用户的 academic-paper-docx。
 * 这些是 L0 卡片(name/description/formats/keywords);完整 SKILL.md 正文(L1)可由
 * parseSkillMd 从对应仓库/本地目录加载后 add 进来(instructions 字段)。
 */
import type { SkillCard } from './parse.js';
import { SkillLibrary } from './library.js';

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
    name: 'frontend-design',
    description: '生成有辨识度、非模板化的前端 UI 设计(排版/配色/动效;避免 AI 千篇一律的“slop”观感)。',
    formats: ['ui'],
    keywords: ['前端', 'ui', '设计', '页面', 'frontend', 'design'],
    source: ANTHROPIC,
  },
  {
    name: 'academic-paper-docx',
    description:
      '把中文学术论文(摘要/多级标题/三线表/图/参考文献/封皮)程序化生成为排版规范的 Word(.docx)再转 PDF;' +
      '附 python-docx 工具箱(eastAsia 宋体、固定行距、三线表、统计输出转图、docx→pdf)。适合课程论文/期末大作业/实证报告。',
    formats: ['word', 'docx'],
    keywords: ['论文', '学术', '三线表', '宋体', 'eastasia', 'python-docx', 'docx', 'pdf', '实证', '大作业'],
    source: 'user:SKILL_HUB/academic-paper-docx',
  },
];

/** 带内置目录的技能库。 */
export function defaultLibrary(): SkillLibrary {
  return new SkillLibrary(BUILTIN_SKILLS);
}
