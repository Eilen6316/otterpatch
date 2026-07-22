/**
 * @otterpatch/adapter-pptx — PowerPoint adapter (initial scope: surgical write-back of slide body text).
 * ChangeSet replaceText → <a:t> text in ppt/slides/slideN.xml; only the matched slide is modified, all other bytes stay untouched.
 * Future work: anchor resolution for shapes/layouts/masters, chart data sources.
 */
export * from './pptx-patch.js';
export * from './pptx-text.js';
