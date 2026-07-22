# 架构

OtterPatch 是位于 LLM Agent 与你的 Office 文档之间的**安全提交层**。可以把它理解为：
针对一个 `.xlsx` / `.docx` / `.drawio` 文件发起一次 Pull Request。

## 流水线

```
 user intent + selection
        │
        ▼
┌─────────────────┐   dialect (per-format tool schema)
│  Agent (LLM)    │◄─ skills (capability cards + playbooks)
│  multi-step loop│◄─ read tools (sheet: read_range/aggregate · doc: read_blocks/find_text/…)
└───────┬─────────┘
        │ propose_changeset (the ONLY mutation exit)
        ▼
┌─────────────────┐
│ ChangeSet       │  format-agnostic: anchors (quote / A1 / cell-id) + edit ops
└───────┬─────────┘
        │ declared check: lint / simulation / output verification
        │   fail → structured report fed back → model repairs (propose→observe→repair, ≤2 rounds)
        │   pass + large changeset → one final semantic self-check round
        ▼
┌─────────────────┐
│ Reviewable diff │  workspace: inline tracked changes / grid replay / board highlight
│                 │  rail: git-style unified diff, per-item accept/reject
└───────┬─────────┘
        │ accepted subset
        ▼
┌─────────────────┐
│ Surgical commit │  OOXML / XML patch — untouched parts byte-identical
│                 │  + fidelity report (touched parts, score)
└─────────────────┘
```

## 包结构一览

| 包 | 职责 |
|---|---|
| `packages/core` | 与格式无关的类型：`Anchor`、`ChangeSet`、`EditOp`、`AbstractStyle`、适配器注册表、回写契约 |
| `packages/agent` | 意图 → 受约束的 `ChangeSet`。与提供商无关的 `ModelClient`（Claude 原生 + OpenAI 兼容 ×8）、多步循环与读取工具 |
| `packages/skills` | 技能中枢：SKILL.md 解析、匹配、渐进式披露，内置能力卡片 + 领域剧本（playbook） |
| `packages/runtime` | 与格式无关的无头编排器。它只通过 `AdapterRegistry` 解析一个 `HostAdapter` 来完成提案校验、预览和回写，再向 MCP、CLI、桌面端发送 JSON 事件 |
| `packages/adapter-*` | 各格式的完整控制面：能力清单、确定性校验、可选影子预览、预期修改部件和有序回写候选。`univer` 与 `drawio` 提供无头影子；Word/PDF/PPTX 会如实声明无渲染预览 |
| `packages/writeback-surgical` | OOXML 外科手术式回写引擎（已验证：在一个真实的 531 KB docx 上，31 个部件中 30 个字节级一致） |
| `apps/desktop` | 座舱 UI（Vite + React + Electron）：工作区（Univer 表格、富文本 Word、drawio 画板）、审阅栏、BYOK 模型面板 |
| `apps/mcp-server` | MCP 服务器（stdio）+ 无头 CLI + 面向座舱的 `otterpatch-serve` 本地 HTTP 桥 |

## 数据流细节

- **上下文是一份投影，而不是文件本身。** 每个工作区为模型组装一份只读上下文：Excel 发送
  工作表概览 + 全表快照（供读取工具使用，不进提示词）；Word 发送逐段落样式摘要 + 样式系统
  摘要，外加全文档块快照（`ProposeRequest.doc`）供读取工具使用。待处理的修订会通过*干净投影*
  被排除（模型始终看到"视为已接受"的文本——不存在上下文污染）。
- **锚点是逻辑性的，而非位置性的。** Word 编辑锚定在 `quote` 上（校验其真实存在且唯一），
  Excel 锚定在 A1 引用上，drawio 锚定在 cell id 上。文档校验器 / 网格校验器 / 拓扑校验器会
  拒绝无法落位的锚点，模型在当轮内自行修复。
- **桌面端乐观预览提案，但不隐式批准任何改动。** 提案呈现为可审阅的标记（修订标记 / 带有捕获前值状态的
  网格值），每项初始状态都是未批准。拒绝时回放捕获的前值状态；接受时才物理落定，提交只接收明确接受的子集。
- **服务端提交是独立的**：ChangeSet 中被接受的子集由外科手术式回写应用到上传的原始文件上——
  应用内预览永远不会碰你的文件。
- **桌面端凭据只留在主进程。** Preload 只暴露有界的提案、取消和审阅提交 IPC，不暴露本地
  服务令牌或通用 fetch；每个 IPC payload 都会先做 schema 与大小校验，再由主进程添加鉴权头。
- **格式路由只有一个所有者。** Runtime 不再维护 backend 或 verifier 格式表；内置及宿主扩展
  Adapter 都由 `AdapterRegistry` 选择，`xlsx`、`docx`、`pptx` 等别名解析到同一份 manifest
  和 Adapter 实现。
