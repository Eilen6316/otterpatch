/**
 * @otterpatch/core — format-agnostic abstraction layer (core IP).
 * The "reviewable safe-execution layer" kernel that sits on top of heterogeneous backends (Univer/ProseMirror/LibreOffice...).
 * Data flow: selection → Anchor → Agent/skill → ChangeSet → capability negotiation → shadow copy → Diff → adjudication → transaction rebase → single-writer commit → write-back verify.
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
export * from './risk.js';
export * from './validate.js';
export * from './capabilities.js';
