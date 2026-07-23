# OtterPatch 文档

这些文档描述当前 `main` 实现，面向贡献者与集成者。能力声明以版本化 manifest 为准；
安全声明同时列出已执行控制与宿主职责。

| 文档 | 内容 |
|---|---|
| [architecture.md](./architecture.md) | 带信任边界的 propose、review、commit、verification 流水线；包职责；宿主职责 |
| [security.md](./security.md) | 威胁模型、prompt/skill 隔离、provenance、签名审阅权限、资源/Provider/HTTP/Electron 控制与限制 |
| [agent.md](./agent.md) | 路由、prompt 边界、只读工具、Provider 预算、提案检查、provenance、分批 |
| [skills.md](./skills.md) | 内置/生成 playbook、能力感知披露、外部技能 trust 规则 |
| [review-ux.md](./review-ux.md) | 工作区预览、逐 edit 决策、Word/Excel/drawio 回放、源绑定 commit 流程 |
| [testing.md](./testing.md) | 当前 CI 基线、workspace/adversarial 测试、真实写回、Playwright 与打包桌面冒烟 |
| [ooxml-redline-notes.md](./ooxml-redline-notes.md) | Word 原生修订语义、已覆盖行为和剩余 OOXML backlog |
| [bench.md](./bench.md) | 历史能力 bench 校准记录；当前任务集见 `test/expert-bench.mjs` |

## 不变量

1. **单一变更出口：** 模型驱动的文档修改必须成为结构化 ChangeSet。
2. **不可信数据始终是数据：** 文档和外部技能内容永远不能获得 system 权限。
3. **能力失败关闭：** 同一 manifest 约束 propose、preview、verify 和 write-back。
4. **身份保持绑定：** Agent provenance、源 SHA-256、派生 revision、ChangeSet hash、策略与格式
   通过 proposal/receipt 全链路绑定。
5. **审批必须显式：** 默认情况下，每个提交 edit ID 都来自签名且会过期的 review receipt。
6. **Commit 串行且强制验证：** Runtime 按文档加锁，不重放已开始的后端，并要求输出回读。
7. **宿主负责持久化：** 已验证字节仍需嵌入应用以备份友好的原子方式保存，并处理长期审计。
