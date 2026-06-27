/**
 * @opal/core —— 格式无关抽象层(核心 IP)。
 * 坐在异构底座(Univer/ProseMirror/LibreOffice…)之上的"可审阅安全执行层"内核。
 * 数据流:圈选→Anchor→Agent/技能→ChangeSet→能力协商→影子→Diff→裁决→事务rebase→单写者提交→写回verify。
 */
export * from './anchor.js';
export * from './changeset.js';
export * from './diff.js';
export * from './adapter.js';
export * from './transaction.js';
export * from './writeback.js';
export * from './skill.js';
export * from './registry.js';
export * from './resolve-flow.js';
