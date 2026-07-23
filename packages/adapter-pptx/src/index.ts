/**
 * @otterpatch/adapter-pptx — frozen, opt-in PowerPoint adapter for surgical slide-text write-back.
 * ChangeSet replaceText → <a:t> text in ppt/slides/slideN.xml; only the matched slide is modified, all other bytes stay untouched.
 * This adapter is intentionally excluded from the stock runtime and receives no feature expansion.
 */
export * from './pptx-patch.js';
export * from './pptx-text.js';
export * from './adapter.js';
