/**
 * @otterpatch/adapter-word —— Word 适配器(起步)。当前先落地最出彩的"红线写回"精华:
 * 词级 diff → Word 原生修订(w:ins/w:del),供 ChangeSet 的逐块 accept/reject 编译成可审阅修订。
 * 后续:ProseMirror 流式选区(flow 锚点)+ word/document.xml 段落级外科写回(复用 writeback-surgical)。
 */
export * from './redline.js';
export * from './document.js';
export * from './writeback.js';
