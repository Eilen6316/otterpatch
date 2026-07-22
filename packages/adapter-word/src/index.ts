/**
 * @otterpatch/adapter-word — Word adapter (early stage). Currently ships the core "redline writeback" feature:
 * word-level diff → native Word tracked changes (w:ins/w:del), so per-block accept/reject from a ChangeSet compiles into reviewable revisions.
 * Later: ProseMirror flow selections (flow anchors) + paragraph-level surgical writeback of word/document.xml (reusing writeback-surgical).
 */
export * from './redline.js';
export * from './document.js';
export * from './writeback.js';
export * from './sect.js';
export * from './verify.js';
export * from './adapter.js';
