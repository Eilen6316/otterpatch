/**
 * @otterpatch/agent · prompts —— 所有提示词集中在此目录,按场景分文件,与逻辑解耦。
 * 调提示/加场景只动这里;dialects 与对话循环从这里 import,绝不在逻辑代码里写死字符串。
 */
export * from './agent-loop.js';
export * from './sheet.js';
export * from './excel.js';
export * from './drawio.js';
export * from './word.js';
export * from './pdf.js';
export * from './ppt.js';
