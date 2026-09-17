/**
 * @otterpatch/runtime — headless orchestration kernel: propose → diff → commit + JSON event stream.
 * Shared by the MCP server, CLI, and desktop app.
 */
export * from './events.js';
export * from './diff.js';
export * from './review.js';
export * from './review-store.js';
export * from './audit.js';
export * from './safe-write.js';
export * from './runtime.js';
