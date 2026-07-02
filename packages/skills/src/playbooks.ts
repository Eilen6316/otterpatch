/**
 * 领域打法手册(playbook)加载器 —— 唯一事实源是 packages/skills/skills/<name>/SKILL.md
 * (Anthropic Agent Skills 目录约定:一技能一目录一 SKILL.md,frontmatter + markdown 正文)。
 * 这里只负责在 Node 侧读文件并经 parseSkillMd 解析成卡片;要新增/修改手册,改 md 文件即可,
 * 不碰代码 —— 用户自己的行业手册也用同一格式 install()。
 * L0=frontmatter(进系统提示技能列表),L1=正文(模型命中后经 load_skill 工具按需拉取)。
 */
import { readFileSync } from 'node:fs';
import { parseSkillMd, type SkillCard } from './parse.js';

const PLAYBOOK_NAMES = ['docx-gongwen', 'docx-conventions', 'docx-coauthoring', 'xlsx-financial', 'xlsx-authoring', 'chart-selection', 'pptx-design'] as const;

function loadPlaybook(name: string): SkillCard {
  // src/ 与 dist/ 同深度,../skills 都指向包根下的 skills/ 目录(随包一起分发)
  const url = new URL(`../skills/${name}/SKILL.md`, import.meta.url);
  return parseSkillMd(readFileSync(url, 'utf8'), 'otterpatch/playbooks');
}

export const PLAYBOOK_SKILLS: SkillCard[] = PLAYBOOK_NAMES.map(loadPlaybook);
