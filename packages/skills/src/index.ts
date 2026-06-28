/**
 * @otterpatch/skills —— SKILL.md 兼容的技能中枢。
 * 解析 SKILL.md → 按格式/意图匹配 → 注入 Agent 系统提示(渐进披露 L0)/ 导出 MCP 工具。
 * 内置 Anthropic 的 docx/xlsx/pptx/pdf/frontend-design + 用户的 academic-paper-docx。
 */
export * from './parse.js';
export * from './library.js';
export * from './catalog.js';
