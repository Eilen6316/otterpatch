# OtterPatch

[English](./README.md) · **中文** · [日本語](./README.ja.md) · [Français](./README.fr.md) · [한국어](./README.ko.md)

> 🦦 **O**ffice **T**ransforms · **T**racked · **E**dited & **R**eviewed · surgical **Patch** —— 由 Agent 驱动、可审阅的文档**安全提交层**。
> 圈选区域 → 说出诉求 → 审阅差异 → 高保真写回。
> （可以理解为:给你的 `.xlsx` / `.docx` / `.drawio` 开一个 PR。）

> ⚠️ 早期脚手架,正在积极开发中。

## 为什么

Agent 不该直接改你的文件。在 OtterPatch 里,Agent 只**提议**一份结构化的
`ChangeSet`;系统校验它、应用到影子副本、展示**可审阅的差异**
(逐块接受/拒绝),然后**外科手术式**写回 —— 只有被改动的部分变化,
其余字节保持完全一致。

已在真实的 531 KB `.docx` 上验证:外科式写回保持 **31 个部件中 30 个字节不变**,
而模型整文重写会改写 31 个中的 11 个。详见 `packages/writeback-surgical`。

## 结构

```text
packages/core/                与格式无关的抽象层
                              (Anchor / ChangeSet / Diff / Skill / Adapter / Registry / Transaction / Writeback)
packages/agent/               意图 → 受约束的 ChangeSet;BYOK,8 家模型
                              (Claude 原生 + OpenAI 兼容:DeepSeek/GLM/Kimi/豆包/MiniMax/Gemini/ChatGPT)
packages/adapter-univer/      Excel 适配器(Univer)—— ChangeSet → 工作表 XML 编译器
packages/adapter-drawio/      drawio 适配器 —— mxCell 操作引擎 + 图级外科式写回
packages/writeback-surgical/  外科式 OOXML 写回 —— 已验证 + 有测试
apps/desktop/                 渐进披露驾驶舱 UI + BYOK 模型配置(Vite + React;后续 Electron)
```

## 开发

```bash
npm install
npm run typecheck                  # 跨 packages/* 执行 tsc -b
npm run dev                        # 驾驶舱 UI → http://localhost:5173
npm test -w @otterpatch/core             # 适配器注册表
npm test -w @otterpatch/agent            # 意图 → ChangeSet(mock 模型 + 8 家工厂)
npm test -w @otterpatch/adapter-univer   # 意图 → ChangeSet → 外科式 .xlsx 写回
npm test -w @otterpatch/adapter-drawio   # mxCell 操作 + 跨图外科式写回
npm test -w @otterpatch/writeback-surgical
```

## 状态

- [x] Monorepo 脚手架;core 抽象层 + 适配器注册表
- [x] 外科式 OOXML 写回(已验证 + 有测试)
- [x] Agent 回合:自然语言意图 → 受约束的 `ChangeSet`(BYOK,8 家模型)
- [x] drawio 适配器:mxCell 增/删/改属性/移动 + 图级外科式写回
- [ ] Univer 适配器实时闭环:圈选 → ChangeSet → 影子 → 差异 → 写回
- [ ] 把驾驶舱 UI 接到真实 Agent + 写回后端

## 许可证

[Apache-2.0](./LICENSE)。
