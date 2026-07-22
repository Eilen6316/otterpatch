/**
 * Domain playbook loader — the single source of truth is packages/skills/skills/<name>/SKILL.md
 * (Anthropic Agent Skills directory convention: one skill = one directory = one SKILL.md,
 * frontmatter + markdown body). This module only reads files on the Node side and parses them
 * into cards via parseSkillMd; to add/modify a playbook, edit the md file — no code changes
 * needed. Users' own industry playbooks use the same format via install().
 * L0 = frontmatter (goes into the system-prompt skill list); L1 = body (fetched on demand via
 * the load_skill tool once the model matches a skill).
 */
import { readFileSync } from 'node:fs';
import { parseBuiltinSkillMd, type SkillCard } from './parse.js';

const PLAYBOOK_NAMES = ['docx-gongwen', 'docx-conventions', 'docx-coauthoring', 'xlsx-financial', 'xlsx-authoring', 'chart-selection', 'pptx-design'] as const;

function loadPlaybook(name: string): SkillCard {
  // src/ and dist/ sit at the same depth, so ../skills resolves to the skills/ dir at the package root (shipped with the package) from either
  const url = new URL(`../skills/${name}/SKILL.md`, import.meta.url);
  return parseBuiltinSkillMd(readFileSync(url, 'utf8'), 'otterpatch/playbooks');
}

export const PLAYBOOK_SKILLS: readonly SkillCard[] = Object.freeze(PLAYBOOK_NAMES.map(loadPlaybook));
