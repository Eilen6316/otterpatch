/**
 * 预加载:contextBridge 暴露最小安全 API。
 * 预留 otterpatch.* —— 后续在此桥接本地 @otterpatch/runtime(propose/diff/commit + 事件流),
 * 让桌面壳脱离浏览器 CORS 直接跑端到端实链路(IPC → 主进程 runtime)。
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('otterpatch', {
  version: '0.0.1',
  platform: process.platform,
});
