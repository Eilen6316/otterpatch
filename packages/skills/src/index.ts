/**
 * @otterpatch/skills — SKILL.md-compatible skill hub.
 * Parses SKILL.md → matches by format/intent → injects into the Agent system prompt (progressive disclosure L0) / exports MCP tools.
 * Bundles Anthropic's docx/xlsx/pptx/pdf/frontend-design plus the user's academic-paper-docx.
 */
export { MAX_SKILL_MD_BYTES, assertSkillCard, parseSkillMd, skillId } from './parse.js';
export type { SkillCard } from './parse.js';
export * from './library.js';
export * from './catalog.js';
export * from './playbooks.js';
